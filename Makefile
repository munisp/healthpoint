# HealthPoint IDR — developer task runner
# Requires: pnpm 10.x, Node 22, docker (for integration), k6 (for perf).

SHELL := /bin/bash
.SHELLFLAGS := -euo pipefail -c

COMPOSE_TEST := docker compose -f server/tests/integration/docker-compose.test.yml
# Throwaway local-only credentials for the ephemeral test stack (not secrets).
TEST_DATABASE_URL := postgresql://healthpoint_test:healthpoint_test@localhost:54329/healthpoint_test
TEST_REDIS_URL := redis://localhost:56379

.PHONY: dev build test test-integration perf perf-smoke backup restore-drill lint migrate-test

## dev: run the dev server with watch mode (requires docker-compose.yml stack for full functionality)
dev:
	pnpm dev

## build: client bundle + server bundle (what CI runs)
build:
	pnpm build

## test: unit + contract tests (live-infra suites excluded; see integration job)
test:
	pnpm vitest run \
		--exclude server/redis-connectivity.test.ts \
		--exclude server/kafka-connectivity.test.ts \
		--exclude server/permify-connectivity.test.ts \
		--exclude server/tigerbeetle-connectivity.test.ts \
		--exclude server/temporal-operations.test.ts \
		--exclude server/provider-onboarding-simulation.test.ts

## test-integration: payment → ledger → outbox against a throwaway Postgres+Redis
test-integration:
	$(COMPOSE_TEST) up -d --wait
	trap '$(COMPOSE_TEST) down -v' EXIT; \
	RUN_INTEGRATION=1 DATABASE_URL=$(TEST_DATABASE_URL) REDIS_URL=$(TEST_REDIS_URL) \
		pnpm vitest run server/tests/integration

## perf: full k6 budget suites (auth, payments, search). Env: BASE_URL, ACCESS_TOKEN, LOAD_DISPUTE_ID, ...
perf:
	k6 run -e BASE_URL="$(BASE_URL)" perf/auth.js
	k6 run -e BASE_URL="$(BASE_URL)" -e ACCESS_TOKEN="$(ACCESS_TOKEN)" -e LOAD_DISPUTE_ID="$(LOAD_DISPUTE_ID)" perf/payments.js
	k6 run -e BASE_URL="$(BASE_URL)" -e ACCESS_TOKEN="$(ACCESS_TOKEN)" perf/search.js

## perf-smoke: 10-second 1-RPS sanity pass before a full perf run
perf-smoke:
	k6 run -e RPS=1 -e DURATION=10s -e BASE_URL="$(BASE_URL)" perf/auth.js
	k6 run -e RPS=1 -e DURATION=10s -e BASE_URL="$(BASE_URL)" -e ACCESS_TOKEN="$(ACCESS_TOKEN)" -e LOAD_DISPUTE_ID="$(LOAD_DISPUTE_ID)" perf/payments.js
	k6 run -e RPS=1 -e DURATION=10s -e BASE_URL="$(BASE_URL)" -e ACCESS_TOKEN="$(ACCESS_TOKEN)" perf/search.js

## backup: encrypted pg_dump + manifest (env: DATABASE_URL, BACKUP_ENCRYPTION_PASSPHRASE)
backup:
	./scripts/db-backup.sh

## restore-drill: backup → restore into isolated DB → row-count verification
## (env: DATABASE_URL, RESTORE_DATABASE_URL, BACKUP_ENCRYPTION_PASSPHRASE)
restore-drill:
	./scripts/db-recovery-drill.sh

## lint: TypeScript typecheck + prettier check (mirrors CI gate)
lint:
	pnpm check
	pnpm exec prettier --check .

## migrate-test: apply drizzle migrations to the throwaway test database
migrate-test:
	DATABASE_URL=$(TEST_DATABASE_URL) pnpm exec drizzle-kit migrate
