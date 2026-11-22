#!/usr/bin/env bash
# 02-replication-init.sh — runs ONCE on first init of the PostgreSQL primary
# (official postgres image, docker-entrypoint-initdb.d). Mounted only by
# docker-compose.prod.yml. Idempotent by construction: initdb scripts run on
# an empty data directory only.
#
# Does three things:
#   1. Creates the streaming-replication role (env-configurable name/password).
#   2. Authorizes replication connections from the overlay network in pg_hba.
#   3. Provisions the Keycloak database (prod overlay switches KC_DB to
#      postgres; dev Keycloak uses dev-mem and never needs this).
set -euo pipefail

REPL_USER="${POSTGRES_REPLICATION_USER:-replicator}"
: "${POSTGRES_REPLICATION_PASSWORD:?POSTGRES_REPLICATION_PASSWORD is required for the prod HA overlay}"
REPL_NET="${POSTGRES_REPLICATION_NETWORK:-0.0.0.0/0}"

psql -v ON_ERROR_STOP=1 \
     -v repl_user="${REPL_USER}" \
     -v repl_pass="${POSTGRES_REPLICATION_PASSWORD}" \
     --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" <<'SQL'
CREATE ROLE :repl_user WITH REPLICATION LOGIN PASSWORD :'repl_pass';
SELECT 'CREATE DATABASE keycloak'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'keycloak')\gexec
SQL

# Allow replication connections from the overlay network (primary_conninfo
# authenticates with scram-sha-256).
printf 'host replication %s %s scram-sha-256\n' "${REPL_USER}" "${REPL_NET}" >> "${PGDATA}/pg_hba.conf"

echo "replication-init: role '${REPL_USER}' created, pg_hba updated, keycloak db ensured" >&2
