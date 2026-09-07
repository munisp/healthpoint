# CI — typecheck-and-test

**Move `ci/typecheck-and-test.yml` to `.github/workflows/` — the automation
token used by the remediation pipeline lacks the `workflow` scope, so pushes
to `.github/workflows/` are rejected with 403.** Until a maintainer with a
full-scope token moves the file, this pipeline does not run automatically.

After moving, the workflow runs on push/PR:

1. `actions/checkout@v4`
2. `actions/setup-node@v4` (Node 20, npm cache)
3. `npm ci --legacy-peer-deps`
4. `npx tsc --noEmit`
5. `npx vitest run` (service-free only; Kafka/Redis-backed tests are skipped
   — no compose profile is started in this job)

## Warn-only start (intentional)

Both `tsc --noEmit` and `vitest run` run with `continue-on-error: true`
(with TODO comments to tighten) because the gate would otherwise block on
**pre-existing** errors that predate this pipeline. Known pre-existing
TypeScript errors as of 2026-09-05 include:

- **portal-rpa** (`server/portal-rpa/` / `client` portal RPA pages):
  - `TS2802` — `Map`/iterator iteration requires `--downlevelIteration` or a
    `target`/`lib` of ES2015+ (spread of a `Map` / iteration over Map
    iterators in the portal-rpa code paths)
  - `TS2322` — type assignment errors in the dispute registry mapping
    (`server/idr/` registry types assigned to the portal-rpa view models
    with mismatched optional/nullable fields)

(Symptom labels from the 2026-09-05 audit; exact file/line list should be
captured from the first `npx tsc --noEmit` CI run and pasted here so the
warn-only list is evidence-based, not from memory.)

Once those are fixed, remove `continue-on-error: true` from both steps so
the gate becomes blocking.

## Service-dependent tests

Tests that need Postgres/Redis/Kafka are out of scope for this job. When
integration coverage is added, start the data stores with the compose
services (e.g. `docker compose up -d postgres redis kafka` + health gating)
in a dedicated job rather than extending this one.
