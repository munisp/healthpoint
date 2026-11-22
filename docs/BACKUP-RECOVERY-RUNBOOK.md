# Backup & Recovery Runbook — Postgres (ransomware-grade)

Scope: the primary Postgres cluster (`postgres` service in
`middleware/docker-compose.production.yml`). This runbook covers the
**physical backup layer** (`middleware/backups/`: WAL archiving +
`pg_basebackup` + PITR). The logical `pg_dump` layer
(`scripts/backup.sh`, `scripts/db-backup.sh`, `docs/RUNBOOK.md` §3–4)
remains in place for portable per-database restore and cross-version
migration; use PITR for disaster/ransomware recovery and logical dumps for
surgical single-database restores.

## 1. Objectives

| Metric | Target | Mechanism |
|---|---|---|
| RPO (data loss) | **≤ 5 minutes** | Continuous WAL archiving (`archive_mode=on`, `archive_timeout=300`) to a local archive **and** an offsite/immutable copy (`BACKUP_OFFSITE_DIR`). Worst-case loss = one `archive_timeout` window. |
| RTO (restore time) | **≤ 1 hour** | Nightly verified base backup + WAL replay. Measured drill restores complete in seconds-to-minutes for sandbox-scale data; the 1h budget covers provisioning replacement infra + replay for production volumes. |

Both targets are validated by the automated drill (`restore-drill.sh`),
not asserted on faith.

## 2. Architecture

```
postgres ──archive_command──> wal-archive/ (local, fsynced)
        └─archive_command──> offsite/      (immutable copy: S3 Object Lock /
                                             offline mount; same script call)
cron ──> base-backup.sh ──> backups/base_<ts>/ (+ .verified marker)
                            └─> offsite mirror (rsync -a)
cron ──> backup-age-check.sh ──> alertmanager/Nagios (staleness alarm)
quarterly ──> restore-drill.sh ──> PASS/FAIL report (proof, not hope)
```

Key properties:

- **`archive-command.sh` fails loudly.** Any copy/verify error exits
  non-zero, so Postgres keeps the segment in `pg_wal` and retries. WAL is
  never dropped because archiving hiccupped.
- **Every base backup is verified** with `pg_verifybackup` against the
  server-generated manifest before it counts (`.verified` marker). Retention
  prunes verified backups only.
- **Restores never happen in place.** `restore-pitr.sh` stages into a
  scratch dir and refuses to clobber existing paths; the (possibly
  compromised) original stays untouched for forensics.

## 3. Point-in-time recovery procedure (planned event)

When you need to roll the database back to a known-good time `T`
(e.g. just before a bad migration or a detonation):

1. **Freeze the target time.** Use UTC, second precision:
   `T = 2026-09-05 14:22:31` (server runs `timezone='UTC'`).
2. **Pick the newest verified base backup created before T**:
   `ls -d /backups/base/base_* | sort` and confirm `.verified` exists.
3. **Restore on new infrastructure** (never in place):
   ```bash
   bash ./middleware/backups/restore-pitr.sh \
     --backup /backups/base/base_20260905T021500Z \
     --archive-dir /backups/wal-archive \
     --restore-dir /var/lib/postgresql/pitr-restore \
     --target-time "2026-09-05 14:22:31" \
     --port 5433 --start
   ```
   (Scripts ship mode 0644 in git — invoke via `bash`, or `chmod +x` once.
   The script rejects target times at/before the backup's START TIME and
   targets in the future.)
   The script writes `recovery.signal`, sets
   `restore_command`/`recovery_target_time`/`recovery_target_action=promote`,
   replays WAL, and waits for promotion.
4. **Verify** row-level expectations before cutover (canary queries, app
   smoke checks, counts on `disputes`, `ledger_entries`, `event_log`).
5. **Cut over**: repoint the app (or swap ports/volumes), then take a fresh
   base backup of the restored cluster immediately — the old archive's
   timeline ends at T.
6. **Preserve evidence**: keep the old data dir, WAL archive, and logs
   untouched for forensics.

## 4. Ransomware playbook

> **Deployment prerequisite (pre-existing repo gap):**
> `middleware/docker-compose.production.yml` bind-mounts host paths that
> are **absent from this repository** and must be provided at deploy time:
> `middleware/postgres/` (`postgresql.conf`, `pg_hba.conf`, `init/`),
> `middleware/vault/` (`config.hcl`, `policies/`), `middleware/monitoring/`
> (prometheus/grafana config), `middleware/keycloak/realm-export.json`, and
> now `middleware/backups/` (present in-repo, mode 0644). A compose stack
> started without provisioning those host paths will not come up. This
> predates the backup work and is documented here so the recovery plan
> isn't blocked by it during an incident.

### 4.1 Design guarantees (defense in depth)

- **Immutable/offsite copy.** `BACKUP_OFFSITE_DIR` stands in for an
  S3 Object Lock (compliance mode) bucket or an offline/append-only mount.
  Deploy with Object Lock retention ≥ 2× backup retention; the database and
  backup hosts must hold **no credentials that can delete or version-overwrite
  the offsite objects**. In the sandbox the offsite copy is a second local
  directory (simulation); the Object Lock/bucket policy is deployment-side —
  see residual notes in the phase report.
- **Credential separation.** The Postgres replication user used by
  `base-backup.sh` can read data but has no rights over the offsite bucket.
  The backup-writer identity (IAM role / service account) can only `PutObject`;
  deletion requires a separate, MFA-gated break-glass identity stored in
  Vault (`middleware/vault`), never on the DB host.
- **Restore drill** (§6) proves quarterly that backups are restorable, not
  merely present.

### 4.2 First 60 minutes of a detonation

1. **Isolate, don't reboot.** Sever network access to the DB host (security
   group / switch ACL / pull the virtual NIC). Do **not** power off or
   reboot: volatile evidence (processes, keys in memory) and un-archived WAL
   in `pg_wal` may still be recoverable.
2. **Protect the backups.** Verify the offsite/immutable copy is out of the
   attacker's blast radius. Rotate DB, backup-writer, and storage credentials
   (assume all host-resident secrets are burned).
3. **Preserve WAL.** If the archiver was still running, copy `pg_wal/` off
   the box read-only; un-archived segments shrink data loss below the
   `archive_timeout` window.
4. **Identify last-good time T.** Use detonation indicators (ransom note
   mtime, SIEM first-alert, canary-file trip time). Choose T a safety margin
   *before* the earliest indicator. `recovery_target_time` is inclusive of
   commits ≤ T.
5. **Restore to NEW infrastructure only** (§3). Never trust the compromised
   host, its binaries, or its volumes again.
6. **Verify before reconnecting anything**: canary/row-count checks,
   `pg_verifybackup` on the backup you restored from, app smoke tests on an
   isolated network.
7. **Declare, then cut over.** Comms per incident policy (HHS/State
   breach-notification clocks may be running — PHI). Only reconnect after
   the restored cluster passes checks and the old environment is contained
   for forensics.

### 4.3 What not to do

- Don't `pg_resetwal` a production cluster to "make it start" — you will
  destroy recoverability.
- Don't restore in place over the compromised data dir.
- Don't pay/decrypt as a recovery strategy; the drill-proven PITR path is
  the recovery strategy.

## 5. Monitoring & alerting

`backup-age-check.sh` (cron/alertmanager) pages when:

- newest **verified** base backup older than `BACKUP_MAX_AGE_MINUTES`
  (default 1440 = 24h), or
- newest archived WAL segment older than `WAL_MAX_AGE_MINUTES`
  (default 10), or
- either is missing entirely.

A WAL-archive stall of >10 min means RPO is actively degrading — treat as
SEV-2.

## 6. Quarterly restore drill checklist

`middleware/backups/restore-drill.sh` automates the technical core;
the checklist covers the human loop:

- [ ] Run `bash middleware/backups/restore-drill.sh` (or the staged
      equivalent against production backups) — record PASS/FAIL + report path.
- [ ] Confirm the report shows: `pg_verifybackup` pass; canary-before rows
      present; canary-after rows absent; exit 0.
- [ ] Time the restore end-to-end against the RTO ≤ 1h budget; file the
      measurement.
- [ ] Spot-restore the **offsite** copy (not just the local archive) to
      prove the immutable tier is usable.
- [ ] Verify credential separation still holds (backup-writer cannot delete
      offsite objects — attempt and expect denial).
- [ ] Review `backup-age-check.sh` alert routing fired in the last quarter.
- [ ] Update this runbook for any infra drift; sign off in the change log.

## 7. Downtime procedures note

During any restore window the platform is read-only/down for writes.
Announce maintenance per `docs/production-deployment-runbook.md`, hold
claim/dispute intake at the queue layer (Kafka retains), and communicate the
RPO window honestly: any writes made between T and the detonation are lost
by definition — re-entry procedures for that window belong to the business
continuity plan, not this runbook.
