#!/usr/bin/env bash
# replica-entrypoint.sh — entrypoint for the PostgreSQL streaming replica in
# docker-compose.prod.yml (official postgres:16 image family).
#
# Behaviour:
#   - Waits for the primary to accept connections.
#   - On an EMPTY data directory only: clones the primary with pg_basebackup
#     (-R writes standby.signal + primary_conninfo into postgresql.auto.conf).
#   - On a populated data directory: starts PostgreSQL as-is (idempotent
#     restarts, no re-clone).
#
# Required env: POSTGRES_REPLICATION_PASSWORD (replication role created by
# 02-replication-init.sh on the primary), POSTGRES_PASSWORD (superuser
# password — must match the primary's, it is embedded in the base backup).
set -euo pipefail

PRIMARY_HOST="${PRIMARY_HOST:-postgres}"
PRIMARY_PORT="${PRIMARY_PORT:-5432}"
REPL_USER="${POSTGRES_REPLICATION_USER:-replicator}"
PGDATA="${PGDATA:-/var/lib/postgresql/data}"

: "${POSTGRES_REPLICATION_PASSWORD:?POSTGRES_REPLICATION_PASSWORD is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required (must match the primary superuser password)}"

echo "replica-entrypoint: waiting for primary ${PRIMARY_HOST}:${PRIMARY_PORT}..." >&2
until pg_isready -h "${PRIMARY_HOST}" -p "${PRIMARY_PORT}" -q; do
  sleep 2
done

if [ -z "$(ls -A "${PGDATA}" 2>/dev/null)" ]; then
  echo "replica-entrypoint: empty data directory — cloning primary with pg_basebackup" >&2
  # The connection string (incl. password) is stored by -R in
  # postgresql.auto.conf as primary_conninfo, so the replica re-authenticates
  # on every restart without further configuration.
  pg_basebackup \
    -d "host=${PRIMARY_HOST} port=${PRIMARY_PORT} user=${REPL_USER} password=${POSTGRES_REPLICATION_PASSWORD}" \
    -D "${PGDATA}" -Fp -Xs -P -R
  chmod 0700 "${PGDATA}"
  echo "replica-entrypoint: base backup complete" >&2
else
  echo "replica-entrypoint: existing data directory found — starting in place" >&2
fi

exec docker-entrypoint.sh postgres -c hot_standby=on
