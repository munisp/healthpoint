#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT/docker-compose.integration.yml"
ENV_FILE="${ENV_FILE:-$ROOT/.env.integration}"
KEEP_STACK="${KEEP_STACK:-false}"
WAIT_SECONDS="${INTEGRATION_STACK_WAIT_SECONDS:-180}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker Engine or Docker Desktop, then rerun this script." >&2
  exit 2
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required." >&2
  exit 2
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for canonical PostgreSQL migration application." >&2
  exit 2
fi

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ROOT/.env.integration.example" "$ENV_FILE"
  echo "Created $ENV_FILE from the example. Review it before running in a shared environment."
fi

set -a
source "$ENV_FILE"
set +a

cleanup() {
  if [[ "$KEEP_STACK" != "true" ]]; then
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" down -v --remove-orphans
  else
    echo "KEEP_STACK=true; leaving integration containers running."
  fi
}
trap cleanup EXIT

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --wait --wait-timeout "$WAIT_SECONDS"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T postgres pg_isready -U healthpoint -d healthpoint_test
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T redis redis-cli -a healthpoint-redis-integration ping | grep -q PONG
curl --fail --silent --show-error http://127.0.0.1:13476/healthz | grep -q '"status":"SERVING"'
timeout 10 bash -c 'until (echo > /dev/tcp/127.0.0.1/17233) >/dev/null 2>&1; do sleep 1; done'
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T temporal sh -lc 'IP=$(hostname -i | awk "{print \$1}"); temporal operator cluster health --address "${IP}:7233" | grep -qx SERVING'

PERMIFY_URL="${PERMIFY_URL:-http://127.0.0.1:13476}" \
PERMIFY_TENANT="${PERMIFY_TENANT:-t1}" \
PERMIFY_AUTH_TOKEN="${PERMIFY_AUTH_TOKEN:-local-integration-token}" \
  "$ROOT/scripts/bootstrap-permify-schema.sh"

# Apply the canonical checked-in Drizzle journal to the disposable PostgreSQL
# database. Drizzle's own migration metadata is the only migration ledger.
export DATABASE_URL
pnpm exec drizzle-kit migrate
EXPECTED_MIGRATION_COUNT="$(node -e 'const j=require("./drizzle/migrations/meta/_journal.json"); console.log(j.entries.length)')"
MIGRATION_COUNT="$(psql "$DATABASE_URL" --tuples-only --no-align -c 'SELECT count(*) FROM drizzle.__drizzle_migrations')"
if [[ "$MIGRATION_COUNT" != "$EXPECTED_MIGRATION_COUNT" ]]; then
  echo "Expected $EXPECTED_MIGRATION_COUNT canonical Drizzle migrations; found $MIGRATION_COUNT" >&2
  exit 1
fi

# The selected tests must exercise the live local services. Never enable the
# test infrastructure fallback on this path.
export TEST_INFRA_FALLBACK_MOCKS=false
export ALLOW_MOCK_FIXTURES=false
export CMS_SIMULATOR_ENABLED=false
export DOCUMENT_ANALYSIS_SIMULATOR_ENABLED=false
export GEORGETOWN_SIMULATOR_ENABLED=false
export FRAUD_SIMULATOR_ENABLED=false
export PAYMENT_EXECUTION_MODE=disabled
export TEMPORAL_EXECUTION_ENABLED=false

pnpm exec vitest run \
  server/kafka-connectivity.test.ts \
  server/redis-connectivity.test.ts \
  server/permify-connectivity.test.ts \
  server/provider-onboarding-simulation.test.ts \
  server/temporal-operations.test.ts \
  server/services/document-validation-evidence-contract.test.ts \
  server/services/model-governance.test.ts \
  server/services/model-governance-workflow.test.ts \
  server/services/model-governance-persistence.test.ts \
  server/workflow/idr-workflow-guards.test.ts
