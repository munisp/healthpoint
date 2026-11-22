# Stakeholder Journeys — HealthPoint

20 reusable, parameterized end-to-end stakeholder journeys that exercise the
**real** tRPC routers (`rootRouter.createCaller`, never raw SQL on business
paths) against a live Postgres.

## Run

```bash
export DATABASE_URL=postgresql://...
npx tsx scripts/run-journeys.mts            # all 20, sequential
npx tsx scripts/run-journeys.mts --only J04 # a single journey
npx tsx scripts/run-journeys.mts --clean    # wipe prior journey-run data first
```

Exit code is non-zero if any journey fails. A per-journey PASS/FAIL table with
per-step evidence is printed.

## Layout

- `server/journeys/framework.ts` — `Journey`/`JourneyStep` interfaces,
  `JourneyContext` (fixture callers + runId namespacing `ns()`/idem() +
  hard assertions that throw), `runJourney()` runner producing structured
  `{journeyId, step, status, durationMs, evidence}` reports.
- `server/journeys/catalog/*.ts` — the 20 journeys (J01–J20), grouped:
  `provider.ts` (J01–J06), `fsm-cases.ts` (J07–J11), `cross.ts` (J12–J15),
  `patient.ts` (J16–J17), `admin.ts` (J18–J20).
- `scripts/run-journeys.mts` — CLI runner; `scripts/journeys-env.mts` — env
  defaults (imported first; real env always wins).

## Re-runnability

- Every run gets a unique `runId`; all created entities are namespaced
  (`ctx.ns(label)`), all idempotency keys are derived deterministically from
  `runId` (`ctx.idem(label)`) so an in-run replay hits idempotency paths and
  separate runs never collide.
- `--clean` deletes prior journey data: all disputes (plus child rows) created
  by the fixture users, fixture-user notifications/drafts/apiKeys/emailPrefs/
  orgSettings/TOTP/webhooks, all FSM cases under tenant `jrn`, submission
  automation rows, and fixture EMR connections.

## Fixture users (seed-min)

`jrn-user-provider`, `jrn-user-admin` (role=admin), `jrn-user-patient`,
`jrn-user-reviewer` — upserted by the runner; journeys do NOT depend on the big
demo seed script.

## LLM stub

LLM-dependent procedures (`predictions.generate`, `docIntelligence.analyze`)
are exercised end-to-end via a deterministic OpenAI-compatible stub the runner
starts on `127.0.0.1:11434` (the default ollama backend address). Set
`JOURNEYS_NO_LLM_STUB=1` to disable it and verify the honest fail-closed
behavior instead — both modes are asserted.

## Notes / sandbox limitations

- J11 (portal RPA): the sandbox has no CMS-portal credentials, so
  `startRun` is asserted to fail closed (FAILED/BLOCKED with evidence) and the
  checkpoint-resolve path is exercised negatively (unknown checkpoint →
  BAD_REQUEST). A full browser dry-run requires the Playwright fake-portal
  harness plus `PORTAL_MAP_JSON` override.
- J20 (fhirCapability): asserted fail-closed against an unreachable EMR
  endpoint (SERVICE_UNAVAILABLE, nothing fabricated).
