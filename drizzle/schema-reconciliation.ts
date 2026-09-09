/**
 * drizzle/schema-reconciliation.ts
 *
 * Ledger reconciliation run ledger (Postgres operational ledger vs. the
 * authoritative TigerBeetle ledger, compared by server/reconciliation.ts).
 *
 * Defined in a separate module (not appended to drizzle/schema.ts) to avoid
 * concurrent-edit conflicts on the shared schema file — same convention as
 * drizzle/schema-idr-compliance.ts. Applied by the hand-written migration
 * drizzle/migrations/0027_complete_lily_hollister.sql.
 *
 * NOTE for drizzle-kit users: drizzle.config.ts points at ./drizzle/schema.ts
 * only. To include this table in future `drizzle-kit generate` output, add
 * `export * from "./schema-reconciliation";` to drizzle/schema.ts.
 *
 * server/reconciliation.ts accesses this table with RAW SQL (single-query
 * idempotent insert); keep the column list in sync with the migration.
 */

import {
  pgTable,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// One row per reconciliation run, idempotent per runKey (default: one row per
// UTC hour, see defaultReconciliationRunKey in server/reconciliation.ts).
// status: passed | drift | error | skipped (ledger integration disabled).
// drifts: JSONB array of LedgerAccountDrift (see server/reconciliation-diff.ts).
export const reconciliationRuns = pgTable(
  "reconciliation_runs",
  {
    id: varchar("id", { length: 64 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
    runKey: varchar("runKey", { length: 128 }).notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    tigerBeetleEnabled: boolean("tigerBeetleEnabled").notNull(),
    accountsCompared: integer("accountsCompared").default(0).notNull(),
    driftCount: integer("driftCount").default(0).notNull(),
    drifts: jsonb("drifts").notNull(),
    errorMessage: text("errorMessage"),
    triggeredBy: varchar("triggeredBy", { length: 64 }).notNull(),
    startedAt: timestamp("startedAt").notNull(),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("reconciliation_runs_runKey_idx").on(t.runKey),
    index("reconciliation_runs_status_idx").on(t.status),
    index("reconciliation_runs_createdAt_idx").on(t.createdAt),
  ]
);
export type ReconciliationRunRow = typeof reconciliationRuns.$inferSelect;
export type InsertReconciliationRunRow = typeof reconciliationRuns.$inferInsert;
