# REGISTER: idr-compliance router + scheduled endpoint

**Status: DONE (barrel registration).** `server/routers.ts` is owned by another
workstream on this branch and was too large to edit through API-based merges,
so registration went through the barrel module instead of editing routers.ts:

- **tRPC router** — `server/app-router.ts` (new):
  `rootRouter = mergeRouters(appRouter, router({ idrCompliance: idrComplianceRouter }))`.
  `mergeRouters` is re-exported from `server/_core/trpc.ts`.
  `server/_core/index.ts` mounts `rootRouter` at `/api/trpc`.
  Type compatibility: the client's `import type { AppRouter } from "../../../server/routers"`
  keeps working (rootRouter is a superset of appRouter's type); the superset
  type is also exported from `server/app-router.ts` as `AppRouter`/`RootRouter`.

- **Scheduled endpoint** — `server/_core/index.ts`:
  `app.post("/api/scheduled/idr-deadline-check", scheduledAuth, idrDeadlineCheckHandler)`
  next to the other scheduled endpoints (same `scheduledAuth` guard; the
  scheduled routes intentionally have no Redis rate limiter, matching the
  existing pattern). Handler: `server/scheduled/idrDeadlineCheck.ts`.
  Recommended schedule: daily, 08:30 UTC (matches deadline-check cadence).
  The handler is idempotent (per-tier sentAt columns + deterministic outbox
  idempotency keys), so daily re-runs and overlapping instances are safe.

- **Drizzle schema re-exports** — PENDING OWNER STEP: `drizzle/schema.ts` is
  >40KB on this branch and was NOT edited. Optional, only affects future
  `drizzle-kit generate` (the tables are applied by
  `drizzle/migrations/0028_idr_compliance_tables.sql`). When editable, append:
  ```ts
  export * from "./schema-idr-compliance";
  export * from "./schema-reconciliation";
  ```

This exposes:
- `idrCompliance.deadlines.computeForDispute` / `.listForDispute` / `.markMet`
- `idrCompliance.fees.listSchedules` / `.createSchedule` / `.seedFromEnv` /
  `.assessOnIdrInitiation` / `.assessIdreFee` / `.listAssessments` / `.updatePaymentStatus`
- `idrCompliance.attestations.attest` / `.listForDispute`
- `idrCompliance.reporting.volumeSummaryCsv` / `.determinationRecord`

## Configuration (environment; all optional)

Deadline policy (statutory defaults, subject to rulemaking change —
see `server/idr/deadlines.ts` header):
- `IDR_OPEN_NEGOTIATION_BUSINESS_DAYS` (default 30)
- `IDR_INITIATION_WINDOW_BUSINESS_DAYS` (default 4)
- `IDR_IDRE_SELECTION_BUSINESS_DAYS` (default 3)
- `IDR_OFFER_SUBMISSION_BUSINESS_DAYS` (default 10)
- `IDR_DETERMINATION_BUSINESS_DAYS` (default 30)
- `IDR_PAYMENT_CALENDAR_DAYS` (default 30)
- `IDR_BUSINESS_DAY_EXTRA_CLOSURES` (comma-separated ISO dates)
- `IDR_USE_FEDERAL_HOLIDAYS` (default true)

Fee schedule seed (integer cents; amounts come from current HHS guidance under
45 CFR § 149.510(d) — the platform never hardcodes them):
- `IDR_ADMIN_FEE_CENTS`
- `IDR_IDRE_FEE_SINGLE_MIN_CENTS` / `IDR_IDRE_FEE_SINGLE_MAX_CENTS`
- `IDR_IDRE_FEE_BATCHED_MIN_CENTS` / `IDR_IDRE_FEE_BATCHED_MAX_CENTS`
- `IDR_BATCHING_MAX_LINE_ITEMS`
- `IDR_FEE_SCHEDULE_EFFECTIVE_FROM` (ISO date)
