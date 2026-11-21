# Postgres ransomware-grade backups: WAL archiving + PITR

Physical backup layer for HealthPoint Postgres (PG16). Complements — does
not replace — the logical `pg_dump` layer in `scripts/backup.sh` /
`scripts/db-backup.sh` (those give portable, per-database restore; this
layer gives **point-in-time recovery** with an RPO of minutes).

| Script | Purpose |
|---|---|
| `archive-command.sh` | WAL `archive_command` wrapper: fsync-safe local archive + optional offsite second copy. Never exits 0 unless every copy landed, so Postgres retains WAL on failure. |
| `base-backup.sh` | `pg_basebackup` wrapper: labeled backup, `pg_verifybackup` manifest verification gate, `.verified` success marker, optional offsite mirror, retention pruning (verified backups only). |
| `restore-pitr.sh` | Restore a base backup to a scratch dir, write `recovery.signal` + `recovery_target_time`, replay archived WAL, promote. |
| `restore-drill.sh` | Fully automated backup → destroy → PITR-restore drill with canary rows and a PASS/FAIL report. Safe: only touches `DRILL_ROOT`. |
| `backup-age-check.sh` | Monitoring hook: exits non-zero when the newest verified base backup or archived WAL segment is older than its threshold. |

## Configuration reference (env vars)

### `archive-command.sh`
| Var | Default | Meaning |
|---|---|---|
| `ARCHIVE_DIR` | **required** | Local WAL archive directory (fsynced after every segment). |
| `BACKUP_OFFSITE_DIR` | unset | Optional second copy — simulate/stand-in for an S3 Object Lock bucket. Point at an off-host mount or an `rclone`/`aws sync` target in real deployments. |

Wired into Postgres as `archive_command = '/opt/healthpoint/backups/archive-command.sh %p %f'`
(see `middleware/docker-compose.production.yml`).

### `base-backup.sh`
| Var | Default | Meaning |
|---|---|---|
| `PGHOST` `PGPORT` `PGUSER` `PGPASSWORD` | libpq defaults / `5432` | Connection for the replication-protocol backup. The role needs `REPLICATION` (or superuser). |
| `BACKUP_DIR` | **required** | Base backup root. One subdir per backup: `<LABEL>_<UTC-timestamp>`. |
| `BACKUP_LABEL` | `base` | Directory/label prefix. |
| `BACKUP_RETENTION_DAYS` | `7` | Prune **verified** backups older than this. `0` disables pruning. Unverified backups are never pruned automatically (forensics). |
| `BACKUP_OFFSITE_DIR` | unset | `rsync -a --delete` mirror of each new backup. |
| `PGBIN` | PATH | Directory containing `pg_basebackup` / `pg_verifybackup`. |

Success marker: `<backup>/.verified` (mtime = verification time) — consumed
by `backup-age-check.sh`. Stdout emits `BACKUP_PATH=<dir>`.

### `restore-pitr.sh`
Arguments, not env: `--backup` `--archive-dir` `--restore-dir`
`--target-time` `[--port N --start]`. `PGBIN` env locates `pg_ctl`.
Refuses to clobber an existing `--restore-dir`.

### `restore-drill.sh`
| Var | Default | Meaning |
|---|---|---|
| `DRILL_ROOT` | `/tmp/hp-pitr-drill` | Scratch root. Wiped and recreated each run (idempotent). Nothing outside it is touched. |
| `DRILL_SOURCE_PORT` / `DRILL_RESTORE_PORT` | `55441` / `55442` | Throwaway cluster ports; the drill refuses ports already serving Postgres. |
| `PGBIN` | auto-detect | PG16 bin dir (pgserver install, `/usr/lib/postgresql/*/bin`, …). |
| `DRILL_KEEP` | unset | `1` keeps scratch dirs + report after the run. |

Exit 0 = PASS. Report at `$DRILL_ROOT/drill-report.txt`.

### `backup-age-check.sh`
| Var | Default | Meaning |
|---|---|---|
| `BACKUP_DIR` / `ARCHIVE_DIR` | **required** | Same roots as above. |
| `BACKUP_LABEL` | `base` | Label prefix to look for. |
| `BACKUP_MAX_AGE_MINUTES` | `1440` | Alert if newest verified base backup is older (24h). |
| `WAL_MAX_AGE_MINUTES` | `10` | Alert if newest archived WAL segment is older. |

Exit 0 = fresh, 1 = stale/missing (single scrape-friendly status line on
stdout), 2 = usage error.

## Cron examples

```cron
# Nightly verified base backup, 7-day retention
15 2 * * *  postgres  PGHOST=/var/run/postgresql PGUSER=replicator \
  BACKUP_DIR=/backups/base BACKUP_OFFSITE_DIR=/mnt/offsite/base \
  /opt/healthpoint/middleware/backups/base-backup.sh >> /var/log/hp-base-backup.log 2>&1

# Freshness monitor every 5 minutes -> alertmanager/Nagios
*/5 * * * *  postgres  BACKUP_DIR=/backups/base ARCHIVE_DIR=/backups/wal-archive \
  /opt/healthpoint/middleware/backups/backup-age-check.sh \
  || /opt/healthpoint/scripts/alert.sh "postgres backup freshness breached"

# Quarterly automated restore drill (see docs/BACKUP-RECOVERY-RUNBOOK.md §6)
0 4 1 */3 *  ops  PGBIN=/usr/lib/postgresql/16/bin \
  /opt/healthpoint/middleware/backups/restore-drill.sh >> /var/log/hp-restore-drill.log 2>&1
```

## Verification status

`restore-drill.sh` has been executed for real (PG 16.2, scratch clusters):
verified base backup → canary rows → WAL switch → target time → post-target
rows → `pg_ctl -m immediate` + `rm -rf` of the data dir → PITR to target →
pre-target rows present, post-target rows absent → PASS, exit 0. See
`docs/BACKUP-RECOVERY-RUNBOOK.md`.
