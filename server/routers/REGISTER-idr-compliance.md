# REGISTER: idr-compliance router + scheduled endpoint

**Status: TODO (one-line registrations).** `server/routers.ts` is owned by another
workstream on this branch and must not be edited by the IDR-compliance change set.
Apply the following registrations when merging:

## 1. tRPC router — `server/routers.ts`

Follow the existing `hermesRouter` pattern:

```ts
// top of server/routers.ts, with the other router imports:
import { idrComplianceRouter } from "./routers/idr-compliance";

// inside appRouter = router({ ... }):
idrCompliance: idrComplianceRouter,
```

This exposes:
- `idrCompliance.deadlines.computeForDispute` / `.listForDispute` / `.markMet`
- `idrCompliance.fees.listSchedules` / `.createSchedule` / `.seedFromEnv` /
  `.assessOnIdrInitiation` / `.assessIdreFee` / `.listAssessments` / `.updatePaymentStatus`
- `idrCompliance.attestations.attest` / `.listForDispute`
- `idrCompliance.reporting.volumeSummaryCsv` / `.determinationRecord`

## 2. Scheduled endpoint — `server/_core/index.ts`

Next to the other scheduled heartbeat registrations (~line with
`app.post("/api/scheduled/deadline-check", ...)`):

```ts
import { idrDeadlineCheckHandler } from "../scheduled/idrDeadlineCheck";
// ...
app.post("/api/scheduled/idr-deadline-check", scheduledAuth, idrDeadlineCheckHandler);
```

Recommended schedule: daily, 08:30 UTC (matches the existing deadline-check cadence).
The handler is idempotent (per-tier sentAt columns + deterministic outbox
idempotency keys), so daily re-runs and overlapping instances are safe.

## 3. Drizzle schema visibility (optional, for future `drizzle-kit generate`)

`drizzle.config.ts` points at `./drizzle/schema.ts` only. The compliance tables
live in `drizzle/schema-idr-compliance.ts` and are applied by
`drizzle/migrations/0028_idr_compliance_tables.sql`. To include them in future
generated migrations, add to `drizzle/schema.ts`:

```ts
export * from "./schema-idr-compliance";
```

## 4. Configuration (environment; all optional)

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
