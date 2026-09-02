#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env.integration}"
COMPOSE=(docker compose -f "$ROOT/docker-compose.integration.yml" --env-file "$ENV_FILE")
ARTIFACT_DIR="${ARTIFACT_DIR:-$ROOT/artifacts/ci-integration}"
MIGRATION_DATABASE_NAME="${MIGRATION_DATABASE_NAME:-healthpoint_migration_ci}"
mkdir -p "$ARTIFACT_DIR"

cleanup() {
  status=$?
  trap - EXIT
  set +e
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    "${COMPOSE[@]}" logs --no-color > "$ARTIFACT_DIR/compose.log" 2>&1
    "${COMPOSE[@]}" ps > "$ARTIFACT_DIR/compose-ps.txt" 2>&1
    "${COMPOSE[@]}" down -v --remove-orphans > "$ARTIFACT_DIR/compose-down.log" 2>&1
  else
    printf '%s\n' 'Docker or Docker Compose v2 is unavailable; no container diagnostics were collected.' > "$ARTIFACT_DIR/compose.log"
    printf '%s\n' 'Docker or Docker Compose v2 is unavailable.' > "$ARTIFACT_DIR/compose-ps.txt"
    printf '%s\n' 'No containers were started; teardown skipped.' > "$ARTIFACT_DIR/compose-down.log"
  fi
  printf '{"exitCode":%s,"completedAt":"%s"}\n' "$status" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$ARTIFACT_DIR/result.json"
  exit "$status"
}
trap cleanup EXIT

command -v docker >/dev/null || { echo "Docker is required" >&2; exit 2; }
docker compose version >/dev/null || { echo "Docker Compose v2 is required" >&2; exit 2; }
command -v psql >/dev/null || { echo "psql is required for PostgreSQL migration verification" >&2; exit 2; }
if [[ ! "$MIGRATION_DATABASE_NAME" =~ ^[a-z][a-z0-9_]{0,62}$ ]]; then
  echo "MIGRATION_DATABASE_NAME must be a lowercase PostgreSQL identifier" >&2
  exit 2
fi

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ROOT/.env.integration.example" "$ENV_FILE"
fi
set -a
source "$ENV_FILE"
set +a

"${COMPOSE[@]}" config > "$ARTIFACT_DIR/compose-rendered.yaml"
"${COMPOSE[@]}" up -d --wait --wait-timeout 180
"${COMPOSE[@]}" exec -T postgres pg_isready -U healthpoint -d healthpoint_test
"${COMPOSE[@]}" exec -T redis redis-cli -a healthpoint-redis-integration ping | grep -q PONG
curl --fail --silent --show-error http://127.0.0.1:13476/healthz | grep -q '"status":"SERVING"'
"${COMPOSE[@]}" exec -T temporal sh -lc 'IP=$(hostname -i | awk "{print \$1}"); temporal operator cluster health --address "${IP}:7233" | grep -qx SERVING'

# The migration proof database is separate from healthpoint_test, which is used
# by the live service suite and Temporal. Both verifier scripts intentionally
# drop its public and drizzle schemas, so this isolation is mandatory.
"${COMPOSE[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U healthpoint -d postgres -c "DROP DATABASE IF EXISTS ${MIGRATION_DATABASE_NAME};"
"${COMPOSE[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U healthpoint -d postgres -c "CREATE DATABASE ${MIGRATION_DATABASE_NAME};"
export MIGRATION_TEST_DATABASE_URL="postgresql://healthpoint:healthpoint-integration-only@127.0.0.1:15432/${MIGRATION_DATABASE_NAME}?sslmode=disable"
export HEALTHPOINT_ALLOW_CLEAN_MIGRATION_TEST=true
"$ROOT/scripts/verify-clean-postgresql-migrations.sh" > "$ARTIFACT_DIR/clean-migration-verification.log" 2>&1
"$ROOT/scripts/verify-postgresql-upgrade-migrations.sh" > "$ARTIFACT_DIR/upgrade-migration-verification.log" 2>&1

# Run the selected service tests against the healthy local PostgreSQL, Redis,
# Kafka, Permify, and Temporal endpoints. The runner explicitly disables
# infrastructure fallbacks and applies the canonical Drizzle migration journal.
KEEP_STACK=true ENV_FILE="$ENV_FILE" "$ROOT/scripts/run-integration-stack.sh" > "$ARTIFACT_DIR/live-service-suite.log" 2>&1

# The wider unit/regression suite remains hermetic by design. Its fallback
# behavior is explicitly test-only and never supplies production evidence.
TEST_INFRA_FALLBACK_MOCKS=true \
ALLOW_MOCK_FIXTURES=true \
PAYMENT_EXECUTION_MODE=disabled \
TEMPORAL_EXECUTION_ENABLED=false \
pnpm test > "$ARTIFACT_DIR/full-hermetic-suite.log" 2>&1
