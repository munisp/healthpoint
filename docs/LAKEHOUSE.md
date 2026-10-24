# Lakehouse Architecture (phase17-lh)

Honest status-first documentation for the PG → lakehouse → analytics path.
Labels: **EXECUTED-VERIFIED** (ran against real infra in CI/sandbox),
**MOCK-VERIFIED** (ran against stubs/mocks), **STATIC-ONLY** (code reviewed
and type-checked but never executed against the real dependency).

## Architecture

```
                 ┌─────────────────────────── HealthPoint ───────────────────────────┐
                 │                                                                   │
  Postgres ──────┼─► server/lakehouse/export.ts   (incremental, watermarked)         │
  (disputes,     │        │  cursor cols: disputes.updatedAt,                         │
   dispute_docs, │        │              dispute_documents.createdAt,                 │
   audit_log)    │        │              audit_log.createdAt                          │
                 │        ▼                                                           │
                 │   NDJSON → S3  lakehouse-exports/incremental/<dataset>/<run>.ndjson│
                 │        │                                                           │
                 │   bookkeeping tables (runtime-created, NO migration — see below):  │
                 │     lakehouse_export_watermarks(dataset, last_exported_at)          │
                 │     lakehouse_export_runs(run_id, dataset, status, row_count)      │
                 │                                                                   │
                 │   Scheduling (CANONICAL): Temporal Schedule                        │
                 │     server/temporal/lakehouse-schedule.ts                          │
                 │     → lakehouseExportWorkflow (server/temporal/lakehouse.workflows)│
                 │     → activities (server/temporal/lakehouse.activities)            │
                 │     Fallback: cron-lite in-process interval when Temporal          │
                 │     is NOT configured (honestly logged, NOT durable).              │
                 └───────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼  (out of scope for this repo: Spark side)
                 ┌─────────────────────────────────────────────────────┐
                 │  services/lakehouse/pipeline.py  (PySpark → Iceberg) │
                 │  services/lakehouse/scheduler.py — LEGACY/DEV only   │
                 │  Spark query service exposing LAKEHOUSE_QUERY_URL    │
                 └─────────────────────────────────────────────────────┘
                                      │
                                      ▼
                 server/routers/lakehouse-analytics.ts  (tRPC: lakehouseAnalytics.*)
                   source: 'lakehouse' when the query endpoint answers,
                   'postgres_fallback' otherwise — NEVER fabricated.
```

## Schedulers — pick ONE

**Canonical: Temporal** (`server/temporal/lakehouse-schedule.ts`).
`registerLakehouseExportSchedule()` is invoked from the Temporal worker
bootstrap (`server/temporal/worker.ts`). Server-bootstrap wiring for the
interval fallback (when Temporal is not deployed) is the integration point
for the server/** owners: call `registerLakehouseExportSchedule()` during
startup.

- `LAKEHOUSE_EXPORT_ENABLED=true` + `TEMPORAL_EXECUTION_ENABLED=true` →
  Temporal Schedule `lakehouse-export` with `LAKEHOUSE_EXPORT_CRON`
  (full cron syntax) on task queue `healthpoint-journeys`.
- `LAKEHOUSE_EXPORT_ENABLED=true`, Temporal unconfigured → cron-lite
  interval fallback. Supported cron subset: `@hourly`, `@daily`, `@weekly`,
  `*/N * * * *`. Anything else logs an unsupported-cron warning and falls
  back to hourly. The fallback is NOT durable across restarts and logs so.
- Unset/disabled → no runs, honest log line.

`services/lakehouse/scheduler.py` is **legacy/dev**: a one-shot runner for
`pipeline.py` during local Spark development. Do not use it for production
scheduling.

## Export data contract (PG → S3 → Iceberg)

- Format: NDJSON, one object per line, keys:
  `_table` (dataset), `_exported_at` (ISO-8601), plus the raw table columns.
- Key layout: `lakehouse-exports/incremental/<dataset>/<runId>.ndjson`.
- Incremental semantics: rows with cursor > watermark; watermark advances to
  `MAX(cursor)` of the pending set computed **in SQL at full microsecond
  precision** (JS `Date` truncation to ms would re-export boundary rows).
  When a page is full (≥ per-table cap), the JS-side max of exported rows is
  used instead — may duplicate boundary rows, NEVER skips rows.
- Caps per run: disputes/documents 50k, audit 100k rows.
- Iceberg ingestion should treat `(_table, primary key)` merges as
  idempotent-upsert; duplicates at watermark boundaries are possible by
  design (at-least-once).

### Bookkeeping tables — deliberate no-migration choice

`lakehouse_export_watermarks` and `lakehouse_export_runs` are created
**idempotently at runtime** (`CREATE TABLE IF NOT EXISTS`,
`server/lakehouse/bookkeeping.ts`). `drizzle/` and its migration journal are
owned by other workstreams on this branch; a journal entry here would race
their concurrent migrations. These tables are internal ops bookkeeping (no
PHI/business entities). A future phase may promote them to a proper Drizzle
migration once journal ownership is serialized.

## Query endpoint contract (Spark side)

`lakehouseAnalytics.*` procedures POST to `LAKEHOUSE_QUERY_URL`:

```json
POST {LAKEHOUSE_QUERY_URL}
{ "query": "payerBehaviorSummary" | "qpaTrends" | "claimVolumeStats" | "disputeDensityByState",
  "params": { "orgId": "...", "code": null|"99285", "state": null|"TX" } }
```

Expected response: `200 { "rows": [ { ... } ] }` — row shapes match the
Postgres fallback column names (see router source). Timeout: 5s
(`LAKEHOUSE_QUERY_TIMEOUT_MS`). On timeout / non-2xx / malformed body /
unset URL, the router computes the SAME aggregates over Postgres and returns
them with `source: "postgres_fallback"`. The `source` field is the honesty
contract: lakehouse results are never fabricated.

## Procedures

| Procedure | Scope | Description |
|---|---|---|
| `lakehouseAnalytics.payerBehaviorSummary` | org member | Per-payer dispute counts, determination outcomes, cumulative verified underpayment evidence (`billed − paid`; never a payment instruction) |
| `lakehouseAnalytics.qpaTrends` | org member | QPA/billed averages by CPT × state × month |
| `lakehouseAnalytics.claimVolumeStats` | org member | Dispute volume by month × status |
| `lakehouseAnalytics.disputeDensityByState` | authenticated | State-level density (same Postgres-native aggregation as `lakehouse.spatialQuery`, plus the `source` contract field). `lakehouse.spatialQuery` in server/routers.ts is owned by another workstream and was NOT modified. |

## Verification status

| Component | Label | Evidence |
|---|---|---|
| Watermark + incremental export logic (PG read, bookkeeping) | EXECUTED-VERIFIED | `server/lakehouse/export.test.ts` vs embedded PG |
| S3 write leg | STATIC-ONLY here (fails closed when storage env unset); exercised via injected sink in tests | no S3 in sandbox |
| `lakehouseExportWorkflow` wiring (fan-out, partial failure, summary) | MOCK-VERIFIED | `server/temporal/lakehouse.test.ts` on `@temporalio/testing` time-skipping server with stub activities |
| Temporal Schedule registration | STATIC-ONLY | no Temporal server in sandbox |
| Cron-lite fallback gate/parsing | EXECUTED-VERIFIED | unit tests |
| `lakehouseAnalytics` Postgres fallback aggregates + `source` honesty | EXECUTED-VERIFIED | `server/routers/lakehouse-analytics.test.ts` vs embedded PG |
| Lakehouse query path (`source: 'lakehouse'`) | STATIC-ONLY (contract exercised via injected fetch stubs) | no Spark endpoint in sandbox |
| `services/lakehouse/pipeline.py` Spark/Iceberg | env-blocked (requires Spark + MinIO) | unchanged from 15-FB |
