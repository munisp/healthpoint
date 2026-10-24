#!/usr/bin/env bash
# restore-drill.sh — quarterly (and on-demand) restore verification drill.
#
# Restores the LATEST Postgres backup into a throwaway container on an
# isolated Docker network (project prefix hp-restore-drill), runs a
# verification query set (row counts + ledger double-entry invariant),
# prints PASS/FAIL, and tears everything down. Never touches the running
# dev/prod compose project: dedicated network, dedicated container name,
# no published ports.
#
# Idempotent: existing drill containers/networks are removed/reused first.
#
# Usage:
#   scripts/restore-drill.sh                 # restore newest dump in BACKUP_DIR
#   BACKUP_FILE=/path/to/x.dump scripts/restore-drill.sh   # specific artifact
#
# Env:
#   BACKUP_DIR            default ./backups
#   BACKUP_GPG_RECIPIENT  if dumps are .gpg, the private key for this
#                         recipient must be in the local GPG keyring
#   DRILL_PG_IMAGE        default postgres:16.4-alpine (must match the
#                         dump's server major version)
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
DRILL_PG_IMAGE="${DRILL_PG_IMAGE:-postgres:16.4-alpine}"
NET="hp-restore-drill-net"
PGC="hp-restore-drill-pg"
DRILL_DB="idr_drill"
DRILL_USER="drill"
DRILL_PASS="drill-pass-not-a-secret"   # throwaway container, deleted by this script

log()  { printf '[restore-drill %s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
fail() { log "FAIL: $*"; exit 1; }

cleanup() {
  log "teardown: removing drill container and network"
  docker rm -f "${PGC}" >/dev/null 2>&1 || true
  docker network rm "${NET}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# ── 1. Locate the backup artifact ────────────────────────────────────────────
BACKUP_FILE="${BACKUP_FILE:-}"
if [ -z "${BACKUP_FILE}" ]; then
  BACKUP_FILE="$(ls -1t "${BACKUP_DIR}"/postgres/daily/*.dump "${BACKUP_DIR}"/postgres/daily/*.dump.gpg 2>/dev/null | head -n 1 || true)"
fi
[ -n "${BACKUP_FILE}" ] || fail "no backup found under ${BACKUP_DIR}/postgres/daily"
[ -f "${BACKUP_FILE}" ] || fail "backup file not found: ${BACKUP_FILE}"
log "using backup: ${BACKUP_FILE}"

# ── 2. Stage a plaintext dump (decrypt in a temp dir if needed) ──────────────
STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "${STAGE_DIR}"; cleanup' EXIT
case "${BACKUP_FILE}" in
  *.gpg)
    log "decrypting $(basename "${BACKUP_FILE}") with local GPG keyring"
    gpg --batch --yes --decrypt --output "${STAGE_DIR}/restore.dump" "${BACKUP_FILE}" \
      || fail "GPG decryption failed (is the BACKUP_GPG_RECIPIENT private key imported?)"
    ;;
  *)
    cp "${BACKUP_FILE}" "${STAGE_DIR}/restore.dump"
    ;;
esac

# ── 3. Start throwaway Postgres on an isolated network ───────────────────────
docker network inspect "${NET}" >/dev/null 2>&1 || docker network create "${NET}" >/dev/null
docker rm -f "${PGC}" >/dev/null 2>&1 || true
docker run -d --name "${PGC}" --network "${NET}" \
  -e POSTGRES_USER="${DRILL_USER}" -e POSTGRES_PASSWORD="${DRILL_PASS}" -e POSTGRES_DB="${DRILL_DB}" \
  "${DRILL_PG_IMAGE}" >/dev/null

log "waiting for drill postgres to accept connections"
for i in $(seq 1 45); do
  if docker exec "${PGC}" pg_isready -U "${DRILL_USER}" -d "${DRILL_DB}" -q; then break; fi
  [ "${i}" -lt 45 ] || fail "drill postgres did not become ready in 90s"
  sleep 2
done

# ── 4. Restore ───────────────────────────────────────────────────────────────
log "pg_restore into throwaway instance"
docker run --rm --network "${NET}" \
  -v "${STAGE_DIR}:/restore:ro" \
  -e PGPASSWORD="${DRILL_PASS}" \
  "${DRILL_PG_IMAGE}" \
  pg_restore --host="${PGC}" --username="${DRILL_USER}" --dbname="${DRILL_DB}" \
             --no-owner --no-privileges --exit-on-error /restore/restore.dump \
  || fail "pg_restore exited non-zero"

# ── 5. Verification query set ────────────────────────────────────────────────
psqlq() {
  docker exec -e PGPASSWORD="${DRILL_PASS}" "${PGC}" \
    psql -U "${DRILL_USER}" -d "${DRILL_DB}" -tA -c "$1"
}

FAILED=0
check() { # check <description> <sql-that-returns-t-or-f>
  local desc="$1" result
  result="$(psqlq "$2")" || { log "FAIL(query error): ${desc}"; FAILED=1; return; }
  if [ "${result}" = "t" ]; then log "PASS: ${desc}"; else log "FAIL: ${desc}"; FAILED=1; fi
}

log "verification: row counts"
for tbl in disputes ledger_entries settlement_callbacks event_log; do
  check "table ${tbl} exists and is non-empty" \
        "SELECT COUNT(*) > 0 FROM ${tbl};"
  log "  ${tbl}: $(psqlq "SELECT COUNT(*) FROM ${tbl};") rows"
done

log "verification: ledger double-entry invariants"
check "every ledger entry moves a positive amount" \
      "SELECT COUNT(*) = 0 FROM ledger_entries WHERE \"amountCents\" <= 0;"
check "no ledger entry debits and credits the same account" \
      "SELECT COUNT(*) = 0 FROM ledger_entries WHERE \"debitAccountId\" = \"creditAccountId\";"
check "ledger debit legs == credit legs (global conservation)" \
      "SELECT (SELECT COALESCE(SUM(d.total),0) FROM (SELECT SUM(\"amountCents\") AS total FROM ledger_entries GROUP BY \"debitAccountId\") d) = (SELECT COALESCE(SUM(c.total),0) FROM (SELECT SUM(\"amountCents\") AS total FROM ledger_entries GROUP BY \"creditAccountId\") c);"
check "every ledger entry references an existing dispute" \
      "SELECT COUNT(*) = 0 FROM ledger_entries le LEFT JOIN disputes d2 ON d2.id = le.\"disputeId\" WHERE d2.id IS NULL;"

if [ "${FAILED}" -eq 0 ]; then
  log "RESULT: PASS — backup restored and all verification queries passed"
else
  fail "RESULT: FAIL — see failed checks above"
fi
