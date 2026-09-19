# Temporal Journey Orchestrator

Drives the 20 reusable stakeholder journeys (`server/journeys/`) through the
platform's existing services (rootRouter tRPC callers + live Postgres) under
Temporal, on a dedicated task queue. Journeys stay exactly reusable — the same
`runJourney()` + context-builder pattern powers both the direct runner
(`scripts/run-journeys.mts`) and the Temporal activities.

## Layout

| File | Role |
|---|---|
| `server/temporal/journeys.shared.ts` | Pure types/constants (safe for workflow bundles): task queue, default journey order, input/summary shapes. |
| `server/temporal/journeys.workflows.ts` | `journeyOrchestratorWorkflow` (sequential journeys, per-journey results, `allPassed` summary) and `singleJourneyWorkflow`. |
| `server/temporal/journeys.activities.ts` | `seedBaselineActivity`, `runJourneyActivity`, `reportActivity` (summary → existing `audit_log` table, no new schema). |
| `server/temporal/worker.ts` | Worker bootstrap for task queue `healthpoint-journeys`. |
| `server/temporal/journeys.test.ts` | Vitest against `@temporalio/testing` TestWorkflowEnvironment (in-memory time-skipping server) with stub activities. |
| `scripts/run-journeys-temporal.mts` | CLI: start + poll an orchestration, prints the same PASS/FAIL table as `run-journeys.mts`. |
| `server/journeys/context.ts` | Shared runner environment (LLM stub, fixture-user seed, `--clean` wipe, one-stop `buildRunContext`) extracted from `run-journeys.mts` and reused by the activities. |

## Run it

1. **Postgres** with all migrations applied (`npx drizzle-kit migrate`) and a
   seeded baseline (`npx tsx scripts/seed-all.mts --scale small` — needed by
   J06's QPA benchmark assertions).
2. **Temporal dev server** (repo compose already has one):
   `docker compose up temporal` → gRPC on `127.0.0.1:7233`, namespace
   `default`.
3. **Worker**:
   `DATABASE_URL=postgres://... npx tsx server/temporal/worker.ts`
   (also starts the deterministic LLM stub on 127.0.0.1:11434).
4. **CLI**:
   ```
   DATABASE_URL=postgres://... npx tsx scripts/run-journeys-temporal.mts [--only J04] [--clean] [--run-id X]
   ```
   Prints the identical journey table; exit 0 all-pass / 1 failures / 2
   Temporal unreachable (clean message, no crash).

Env conventions mirror `server/temporal.ts`: `TEMPORAL_ADDRESS`
(default 127.0.0.1:7233), `TEMPORAL_NAMESPACE` (default `default`),
`TEMPORAL_AUTH_TOKEN`, `TEMPORAL_CA_PATH`/`TEMPORAL_TLS_SERVER_NAME` for mTLS
(absent CA → plaintext local dev), plus `TEMPORAL_JOURNEYS_TASK_QUEUE`
(default `healthpoint-journeys`). Set `JOURNEYS_SEED_ALL=1` on the worker to
have `seedBaselineActivity` invoke `scripts/seed-all.mts --scale small` first.

## Reusability & determinism contract

- **runId namespacing**: every workflow execution takes a `runId`; journeys
  derive every entity id/idempotency key from it (`ctx.ns()`/`ctx.idem()`), so
  concurrent or repeated orchestrations never collide. `--clean` wipes prior
  journey data via `cleanPriorRuns` before a run.
- **Workflow determinism**: workflow code performs no I/O, no wall-clock, no
  randomness; it only sequences activities via `proxyActivities`
  (startToClose 10m, heartbeat 2m, 3 attempts with 5s→exponential backoff,
  `JourneyAssertionError` non-retryable). Only the pure `journeys.shared.ts`
  module plus type-only activity signatures are imported, so the workflow
  bundle is side-effect-free.
- **Assertion failures are verdicts, not infra errors**: activities return
  per-journey `PASS`/`FAIL` reports as data; the orchestrator always runs all
  requested journeys and aggregates `allPassed`.
- **Reporting**: `reportActivity` writes one `audit_log` row per run
  (`action=temporal.journey_run.completed`, `entityId=<runId>`), reusing the
  existing audit table — no new schema.
- No `routers.ts` change: orchestration is started via the CLI (or any
  Temporal client) rather than a new tRPC procedure, per delivery constraint.
