# HealthPoint Operations Runbook

Scope: Docker Compose deployment of the HealthPoint IDR platform.
Files: `docker-compose.yml` (dev/integration), `docker-compose.prod.yml`
(production HA overlay), `scripts/db-backup.sh`, `scripts/backup.sh`,
`scripts/db-restore-verify.sh`, `scripts/db-recovery-drill.sh`,
`scripts/restore-drill.sh`.

```bash
# Dev / integration
docker compose up -d

# Production (HA overlay; requires Docker Compose >= 2.24)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

## 1. Startup order

`depends_on: condition: service_healthy` enforces this; the tiers are:

1. **Datastores**: `postgres` (primary) → `postgres-replica`; `redis` →
   `redis-replica` → `redis-sentinel-{1,2,3}`; `kafka`, `kafka-2`, `kafka-3`
   (KRaft quorum, no ZooKeeper); `tigerbeetle`, `tigerbeetle-1`,
   `tigerbeetle-2`; `minio`; `opensearch` → `opensearch-node2`; `etcd`.
2. **Init jobs** (one-shot): `kafka-init` (topics, RF=3 in prod),
   `minio-init` (buckets), `migrate` (Drizzle migrations).
3. **Platform**: `temporal`, `keycloak`, `permify`.
4. **Edge**: `apisix` → `openappsec` → `caddy`.
5. **Apps**: `app`, `go-services`, `rust-services`, `ai-service`,
   `lakehouse-worker`, `temporal-worker`, `backup-cron` (prod).

First prod boot notes:

- `postgres` runs `infra/postgres/02-replication-init.sh` once (creates the
  replication role + `keycloak` database). `postgres-replica` then clones the
  primary via `pg_basebackup` on an empty volume only.
- TigerBeetle replicas run `tigerbeetle format` once per data file
  (guarded by file-exists check in the command). To reformat a replica
  intentionally: stop it, remove its volume, start it.
- Kafka brokers self-format their KRaft storage from `KAFKA_CLUSTER_ID` on
  first boot. Never change `KAFKA_CLUSTER_ID` against existing volumes.

## 2. Health verification

Compose surfaces health via `docker compose ps`. Equivalent manual probes:

```bash
docker compose exec postgres pg_isready -U "$POSTGRES_USER"
docker compose exec postgres-replica psql -U "$POSTGRES_USER" -d postgres -tAc 'SELECT pg_is_in_recovery()'   # expect t
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" ping                                                # PONG
docker compose exec redis-sentinel-1 redis-cli -p 26379 sentinel master idr-master                           # current primary
docker compose exec kafka /opt/kafka/bin/kafka-broker-api-versions.sh --bootstrap-server kafka:9092 | head
docker compose exec temporal tctl --address temporal:7233 cluster health                                     # SERVING
docker compose exec keycloak bash -c 'exec 3<>/dev/tcp/localhost/9000 && printf "GET /health/ready HTTP/1.0\r\n\r\n" >&3 && head -c 400 <&3'
docker compose exec opensearch curl -s http://localhost:9200/_cluster/health?pretty                          # green|yellow
docker compose exec minio curl -sf http://localhost:9000/minio/health/live
docker compose exec apisix curl -s http://localhost:9080/apisix/status
docker compose exec tigerbeetle nc -z localhost 3000 && echo tb-ok
curl -fsS http://localhost:3000/healthz      # app liveness (dev port)
curl -fsS http://localhost:3000/readyz       # app readiness: postgres+redis, 503 on failure
curl -fsS http://localhost:8001/internal/health   # go-services (distroless: external check only)
curl -fsS http://localhost:8000/health            # ai-service
```

Notes:

- `go-services` is a distroless image; Docker cannot exec a probe inside it.
  Monitor it externally via `/internal/health` (e.g. blackbox exporter).
- `temporal-ui` and `opensearch-dashboards` are convenience dashboards with
  no reliable in-image probe tooling; check them via the browser.
- `backup-cron` is healthy iff `/backups/.last_success` is newer than
  1.5x the backup interval.

## 3. Backups

Production scheduling: the `backup-cron` service (prod overlay) runs
`scripts/backup.sh` immediately at start and then every
`BACKUP_INTERVAL_SECONDS` (default 86400 = daily). No host cron is required;
to run from host cron instead, use:

```cron
0 2 * * *  cd /opt/healthpoint && docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T backup-cron sh /scripts/backup.sh
```

What each run produces (volume `backup_data`, mount `/backups`):

| Artifact | Producer | Location |
|---|---|---|
| Postgres custom-format dump | `pg_dump -Fc` (GPG-encrypted when `BACKUP_GPG_RECIPIENT` is set) | `postgres/daily/YYYY-MM-DD.dump[.gpg]` |
| Weekly Postgres snapshot | copy of Sunday's daily | `postgres/weekly/YYYY-Www.dump[.gpg]` |
| Redis RDB snapshot | `redis-cli --rdb` (replication SYNC) | `redis/daily/YYYY-MM-DD.rdb` |
| MinIO object mirror | `mc mirror --overwrite` (additive) | `minio/` |
| TigerBeetle | none — see cold backup below | — |

Retention: 7 daily + 4 weekly Postgres dumps; Redis follows daily retention;
pruning is built into `scripts/backup.sh`.

`scripts/db-backup.sh` is the single-purpose Postgres variant (same dump
format, GPG recipient, retention env vars) for ad-hoc/manual runs.

Manual run: `docker compose -f docker-compose.yml -f docker-compose.prod.yml exec backup-cron sh /scripts/backup.sh`.

### TigerBeetle cold backup

TigerBeetle has no online-backup API; the 3-replica cluster is the HA
mechanism. For a cold backup of one replica:

```bash
docker compose stop tigerbeetle-2
docker run --rm -v healthpoint_tigerbeetle_data_2:/data:ro -v "$PWD/backups/tigerbeetle:/out" \
  alpine:3.20 sh -c 'cp /data/0_2.tigerbeetle /out/0_2.$(date +%F).tigerbeetle'
docker compose start tigerbeetle-2   # replica catches up from the cluster
```

## 4. Restore

### 4a. Full Postgres restore (production outage)

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml stop app migrate temporal-worker
# latest daily dump (decrypt first if .gpg: gpg -d file.dump.gpg > file.dump)
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner \
  < backups/postgres/daily/YYYY-MM-DD.dump
docker compose -f docker-compose.yml -f docker-compose.prod.yml start app temporal-worker
```

The streaming replica re-syncs automatically. If the replica fell too far
behind, recreate it: `docker compose rm -sf postgres-replica &&
docker volume rm healthpoint_postgres_replica_data && up -d postgres-replica`.

`scripts/db-restore-verify.sh` validates row counts + table inventory after a
restore; `scripts/db-recovery-drill.sh` automates the same against a
throwaway instance.

### 4b. Restore drill (quarterly, and after every schema-affecting release)

```bash
bash scripts/restore-drill.sh      # restores newest dump into throwaway
                                    # containers (project hp-restore-drill-*),
                                    # verifies row counts and the ledger
                                    # debit==credit conservation invariant,
                                    # prints PASS/FAIL, tears down
BACKUP_FILE=backups/postgres/weekly/2026-W36.dump.gpg scripts/restore-drill.sh
```

Schedule: **quarterly**, calendar-driven (first Monday of each quarter), plus
after any Drizzle migration that alters `ledger_entries`, `disputes`,
`settlement_callbacks`, or `event_log`. Record PASS/FAIL output in the ops
log. A FAIL blocks the next release until backups are fixed.

## 5. DLQ inspection

Poison Kafka messages are routed to `idr.dlq` by the server consumer
(`server/events/kafka-consumer.ts`).

```bash
# dev
docker compose exec kafka kafka-topics --bootstrap-server localhost:9092 --describe --topic idr.dlq
docker compose exec kafka kafka-console-consumer --bootstrap-server localhost:9092 \
  --topic idr.dlq --from-beginning --max-messages 20

# prod (3-broker)
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec kafka \
  /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server kafka:9092,kafka-2:9092,kafka-3:9092 \
  --topic idr.dlq --from-beginning --max-messages 20
```

Triage: inspect the payload + headers, fix the root cause, then republish to
the original topic (or let the upstream retry). Do not purge the DLQ without
an incident record.

## 6. Rollback

- **App code**: redeploy the previous image/build:
  `git checkout <previous-sha> -- Dockerfile server/ client/` then
  `docker compose up -d --build app`. Database migrations are forward-only;
  coordinate with 4a if a migration must be undone (restore pre-migration
  dump).
- **Kafka KRaft rollback to the ZooKeeper-based single broker (dev only)**:
  the dev stack remains ZooKeeper-based; in the prod overlay the parked
  service can be started with `--profile legacy-zk`, but prod data does not
  migrate back — treat KRaft as one-way.
- **Compose config rollback**: `git checkout <sha> -- docker-compose.yml
  docker-compose.prod.yml && docker compose ... up -d` (compose recreates
  only changed services).
- **Keycloak realm**: re-import is idempotent at boot (`--import-realm`);
  remove `./keycloak` overrides to roll back realm config.

## 7. HA summary

| Component | Topology in prod overlay |
|---|---|
| PostgreSQL | primary + streaming replica (manual promote; document `pg_ctl promote` on the replica) |
| Redis | master + replica + 3 Sentinels (quorum 2); app follows failover via `REDIS_SENTINELS` |
| Kafka | 3-broker KRaft, topics RF=3, min ISR 2 |
| TigerBeetle | 3-replica cluster (quorum consensus) |
| OpenSearch | 2 nodes (one primary shard copy + replica) |
| MinIO | single node + additive mirror backup; distributed 4-node expansion documented in `docker-compose.prod.yml` header |
| Keycloak | stateless, backed by Postgres primary (start, not start-dev) |
| app | stateless; scale with `--scale app=N` behind APISIX |
| backups | `backup-cron` daily + restore drill quarterly |

Planned-but-external options (not in this overlay): managed PostgreSQL
(RDS/Cloud SQL) instead of the self-hosted pair; managed object storage
instead of MinIO.
