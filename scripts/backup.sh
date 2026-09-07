#!/usr/bin/env bash
# backup.sh — HealthPoint backup orchestrator.
#
# Runs inside the `backup-cron` compose service (docker-compose.prod.yml) or
# manually on any host with pg_dump / redis-cli / mc on PATH and network
# access to the datastores. Real, idempotent, safe to re-run:
#   same-day re-runs overwrite that day's artifacts (pg_dump -Fc output and
#   RDB snapshot are content-complete snapshots).
#
# Artifacts (under BACKUP_DIR, default ./backups):
#   postgres/daily/YYYY-MM-DD.dump[.gpg]   pg_dump custom format
#   postgres/weekly/YYYY-Www.dump[.gpg]    copied from the Sunday daily run
#   redis/daily/YYYY-MM-DD.rdb             RDB snapshot via redis-cli --rdb (SYNC)
#   minio/                                 `mc mirror` of all buckets (additive;
#                                          nothing is deleted from the mirror)
#
# Retention: BACKUP_RETENTION_DAILY (7) daily + BACKUP_RETENTION_WEEKLY (4)
# weekly Postgres dumps; Redis RDB snapshots follow the daily retention.
# MinIO mirror is a live replica — retention is managed by bucket versioning.
#
# TigerBeetle: no online-backup API exists; the 3-replica cluster is the
# availability mechanism. Cold backup procedure is documented in
# docs/RUNBOOK.md ("TigerBeetle cold backup").
#
# Never logs credentials. Fails loudly (non-zero exit) on any step error.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAILY="${BACKUP_RETENTION_DAILY:-7}"
RETENTION_WEEKLY="${BACKUP_RETENTION_WEEKLY:-4}"
GPG_RECIPIENT="${BACKUP_GPG_RECIPIENT:-}"          # empty => store unencrypted (dev only)
MINIO_BACKUP_ENABLED="${MINIO_BACKUP_ENABLED:-true}"

# ── Required Postgres settings ───────────────────────────────────────────────
: "${PGHOST:?set PGHOST}" "${PGUSER:?set PGUSER}" "${PGDATABASE:?set PGDATABASE}" \
  "${PGPASSWORD:?set PGPASSWORD}"
PGPORT="${PGPORT:-5432}"
export PGPASSWORD

TODAY="$(date +%F)"          # YYYY-MM-DD
WEEK="$(date +%Y-W%V)"       # ISO week, for weekly retention
DOW="$(date +%u)"            # 1=Mon .. 7=Sun

log() { printf '[backup %s] %s\n' "$(date -u +%FT%TZ)" "$*"; }

mkdir -p "${BACKUP_DIR}/postgres/daily" "${BACKUP_DIR}/postgres/weekly" "${BACKUP_DIR}/redis/daily"

# ── 1. PostgreSQL logical backup (custom format) ─────────────────────────────
PG_OUT="${BACKUP_DIR}/postgres/daily/${TODAY}.dump"
log "pg_dump ${PGDATABASE} from ${PGHOST}:${PGPORT} -> ${PG_OUT}"
pg_dump --host="${PGHOST}" --port="${PGPORT}" --username="${PGUSER}" \
        --dbname="${PGDATABASE}" --format=custom --compress=6 \
        --file="${PG_OUT}.tmp"
if [ -n "${GPG_RECIPIENT}" ]; then
  gpg --batch --yes --trust-model always --encrypt --recipient "${GPG_RECIPIENT}" \
      --output "${PG_OUT}.gpg" "${PG_OUT}.tmp"
  rm -f "${PG_OUT}.tmp"
  PG_OUT="${PG_OUT}.gpg"
else
  mv "${PG_OUT}.tmp" "${PG_OUT}"
  log "WARNING: BACKUP_GPG_RECIPIENT unset — dump stored unencrypted (not acceptable for PHI in production)"
fi

# Weekly snapshot: Sunday's daily run is promoted to the weekly tier.
if [ "${DOW}" = "7" ]; then
  cp -f "${PG_OUT}" "${BACKUP_DIR}/postgres/weekly/${WEEK}.${PG_OUT##*.}"
  log "weekly snapshot stored as ${WEEK}.${PG_OUT##*.}"
fi

# ── 2. Redis RDB snapshot ────────────────────────────────────────────────────
if [ -n "${REDIS_HOST:-}" ]; then
  REDIS_PORT="${REDIS_PORT:-6379}"
  RDB_OUT="${BACKUP_DIR}/redis/daily/${TODAY}.rdb"
  log "redis RDB snapshot from ${REDIS_HOST}:${REDIS_PORT} -> ${RDB_OUT}"
  REDISCLI_AUTH="${REDIS_PASSWORD:-}" redis-cli -h "${REDIS_HOST}" -p "${REDIS_PORT}" \
      --rdb "${RDB_OUT}.tmp" >/dev/null
  mv "${RDB_OUT}.tmp" "${RDB_OUT}"
else
  log "REDIS_HOST unset — skipping Redis snapshot"
fi

# ── 3. MinIO mirror ──────────────────────────────────────────────────────────
if [ "${MINIO_BACKUP_ENABLED}" = "true" ]; then
  : "${MINIO_ENDPOINT:?set MINIO_ENDPOINT (e.g. http://minio:9000)}" \
    "${MINIO_ACCESS_KEY:?set MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY:?set MINIO_SECRET_KEY}"
  command -v mc >/dev/null 2>&1 || { log "ERROR: mc not on PATH but MINIO_BACKUP_ENABLED=true"; exit 1; }
  log "mc mirror ${MINIO_ENDPOINT} -> ${BACKUP_DIR}/minio"
  mc --no-color alias set bkup "${MINIO_ENDPOINT}" "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}" >/dev/null
  mc --no-color mirror --overwrite bkup "${BACKUP_DIR}/minio"
else
  log "MINIO_BACKUP_ENABLED=false — skipping MinIO mirror"
fi

# ── 4. Retention pruning ─────────────────────────────────────────────────────
prune() { # prune <dir> <keep>
  local dir="$1" keep="$2"
  [ -d "${dir}" ] || return 0
  # shellcheck disable=SC2012
  ls -1t "${dir}" | tail -n "+$((keep + 1))" | while read -r f; do
    log "prune: removing ${dir}/${f}"
    rm -f "${dir}/${f}"
  done
}
prune "${BACKUP_DIR}/postgres/daily"  "${RETENTION_DAILY}"
prune "${BACKUP_DIR}/postgres/weekly" "${RETENTION_WEEKLY}"
prune "${BACKUP_DIR}/redis/daily"     "${RETENTION_DAILY}"

# ── 5. Success marker (consumed by the backup-cron container healthcheck) ────
date +%s > "${BACKUP_DIR}/.last_success"
log "backup complete"
