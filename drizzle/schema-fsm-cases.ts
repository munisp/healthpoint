/**
 * drizzle/schema-fsm-cases.ts
 *
 * Generic persisted FSM case tables for server/fsm-store (used by
 * server/notice-consent, server/priorauth, server/gfe-ppdr). These modules
 * previously accepted the ENTIRE case object (state + event history) from the
 * client and returned new state without persisting anything server-side,
 * letting a client forge states such as CONSENT_SIGNED. These tables make the
 * server authoritative, mirroring the submission-automation pattern
 * (drizzle/schema-submission-automation.ts):
 *
 * - fsm_cases: one row per FSM case, addressed by (tenantId, caseType, caseId),
 *   carrying an optimistic-locking `version` integer. Every transition
 *   increments the version and the update is conditional on the expected
 *   version (compare-and-swap). The full module-specific case object is stored
 *   in `caseJson`; `state` is duplicated as a column for indexing/querying.
 * - fsm_case_events: append-only, hash-chained event log. Each row stores
 *   prevEventHash + eventHash = sha256(prevEventHash || canonical(event)),
 *   giving a tamper-evident chain verifiable via verifyEventChain().
 * - fsm_case_idempotency: idempotency-key records so replays of
 *   createCase / transitionCase return the prior result without double-applying.
 *
 * House style follows drizzle/schema-submission-automation.ts: separate module
 * to avoid concurrent-edit conflicts on the shared schema.ts; the Postgres
 * store imports this module directly. Applied by the hand-written migration
 * drizzle/migrations/0030_fsm_case_tables.sql.
 */

import {
  pgTable,
  varchar,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const fsmCases = pgTable(
  "fsm_cases",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 128 }).notNull(),
    // Owning module: 'notice-consent' | 'priorauth' | 'gfe-ppdr' | ...
    caseType: varchar("caseType", { length: 64 }).notNull(),
    // Caller-facing case id (the FSM entity's own `id`).
    caseId: varchar("caseId", { length: 128 }).notNull(),
    // FSM state (duplicated from caseJson for indexing).
    state: varchar("state", { length: 64 }).notNull(),
    // Optimistic-locking version; incremented on every transition; CAS target.
    version: integer("version").notNull().default(0),
    // Full module-specific case object (JSON). Server-authoritative: clients
    // never supply this; it is produced only by the module's pure functions.
    caseJson: jsonb("caseJson").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
    closedAt: timestamp("closedAt"),
  },
  (t) => [
    uniqueIndex("fsm_cases_tenant_type_case_idx").on(t.tenantId, t.caseType, t.caseId),
    index("fsm_cases_state_idx").on(t.state),
  ]
);
export type FsmCase = typeof fsmCases.$inferSelect;
export type InsertFsmCase = typeof fsmCases.$inferInsert;

export const fsmCaseEvents = pgTable(
  "fsm_case_events",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    // Row id of the owning fsm_cases row.
    caseRowId: varchar("caseRowId", { length: 64 }).notNull(),
    tenantId: varchar("tenantId", { length: 128 }).notNull(),
    caseType: varchar("caseType", { length: 64 }).notNull(),
    caseId: varchar("caseId", { length: 128 }).notNull(),
    // Monotonic per-case sequence; the unique index makes the log append-only.
    seq: integer("seq").notNull(),
    eventType: varchar("eventType", { length: 64 }),
    fromState: varchar("fromState", { length: 64 }),
    toState: varchar("toState", { length: 64 }),
    at: timestamp("at").notNull(),
    detail: text("detail"),
    // Canonical JSON of the full module-specific event (hash input).
    eventJson: text("eventJson").notNull(),
    // Hash chain: eventHash = sha256_hex(prevEventHash || canonicalEventJson).
    prevEventHash: varchar("prevEventHash", { length: 64 }).notNull(),
    eventHash: varchar("eventHash", { length: 64 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("fsm_events_case_seq_idx").on(t.caseRowId, t.seq),
    index("fsm_events_tenant_type_case_idx").on(t.tenantId, t.caseType, t.caseId),
  ]
);
export type FsmCaseEvent = typeof fsmCaseEvents.$inferSelect;
export type InsertFsmCaseEvent = typeof fsmCaseEvents.$inferInsert;

export const fsmCaseIdempotency = pgTable(
  "fsm_case_idempotency",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 128 }).notNull(),
    caseType: varchar("caseType", { length: 64 }).notNull(),
    caseId: varchar("caseId", { length: 128 }).notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 128 }).notNull(),
    // 'create' | 'transition' — what operation this key was used for.
    operation: varchar("operation", { length: 32 }).notNull(),
    // Serialized prior result returned verbatim on replay.
    resultJson: text("resultJson").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("fsm_idem_tenant_type_case_key_idx").on(
      t.tenantId,
      t.caseType,
      t.caseId,
      t.idempotencyKey
    ),
  ]
);
export type FsmCaseIdempotency = typeof fsmCaseIdempotency.$inferSelect;
export type InsertFsmCaseIdempotency = typeof fsmCaseIdempotency.$inferInsert;
