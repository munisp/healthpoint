/**
 * drizzle/schema-submission-automation.ts
 *
 * Persistence tables for the assisted-manual IDR submission-automation layer
 * (server/idr/submission-automation/):
 *
 * - submission_automation_submissions: one row per submission entity, carrying
 *   an optimistic-locking `version` integer. Every FSM transition increments
 *   the version and the update is conditional on the expected version
 *   (compare-and-swap). Unique ACTIVE submission per (tenantId, disputeId) is
 *   enforced by the partial unique index in the migration
 *   (drizzle/migrations/0029_submission_automation_tables.sql) — withdrawn and
 *   closed submissions do not block a new one.
 * - submission_automation_events: append-only, hash-chained event log. Each row
 *   stores prevEventHash + eventHash = sha256(prevEventHash || canonical(event)),
 *   giving a tamper-evident chain verifiable via verifyEventChain().
 * - submission_automation_idempotency: idempotency-key records so replays of
 *   createSubmission / transition return the prior result without double-applying.
 *
 * House style follows drizzle/schema-idr-compliance.ts: separate module to
 * avoid concurrent-edit conflicts on the shared schema.ts. NOTE: the one-line
 * re-export (`export * from "./schema-submission-automation";`) is
 * intentionally NOT added to drizzle/schema.ts in this wave to avoid a
 * concurrent-edit conflict on that shared file; the Postgres store imports
 * this module directly. Applied by the hand-written migration
 * drizzle/migrations/0029_submission_automation_tables.sql.
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

export const submissionAutomationSubmissions = pgTable(
  "submission_automation_submissions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 128 }).notNull(),
    disputeId: varchar("disputeId", { length: 128 }).notNull(),
    // FSM state (see server/idr/submission-automation/submission-fsm.ts).
    state: varchar("state", { length: 32 }).notNull(),
    // Optimistic-locking version; incremented on every transition; CAS target.
    version: integer("version").notNull().default(0),
    cmsDisputeReferenceNumber: varchar("cmsDisputeReferenceNumber", { length: 64 }),
    // Server-side attestation { actorId, attestedAt, portalConfirmationText? }.
    // actorId is forced server-side from ctx.user.id — never caller-supplied.
    attestation: jsonb("attestation"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
    closedAt: timestamp("closedAt"),
  },
  (t) => [
    // Non-partial uniqueness of (tenantId, disputeId) is intentionally NOT
    // declared here: withdrawn/closed submissions must not block a new one.
    // The ACTIVE-only partial unique index lives in the hand-written
    // migration 0029_submission_automation_tables.sql (drizzle cannot
    // express partial indexes declaratively).
    index("sa_submissions_tenant_dispute_idx").on(t.tenantId, t.disputeId),
    index("sa_submissions_state_idx").on(t.state),
  ]
);
export type SubmissionAutomationSubmission =
  typeof submissionAutomationSubmissions.$inferSelect;
export type InsertSubmissionAutomationSubmission =
  typeof submissionAutomationSubmissions.$inferInsert;

export const submissionAutomationEvents = pgTable(
  "submission_automation_events",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    submissionId: varchar("submissionId", { length: 64 }).notNull(),
    tenantId: varchar("tenantId", { length: 128 }).notNull(),
    disputeId: varchar("disputeId", { length: 128 }).notNull(),
    // Monotonic per-submission sequence; the unique index makes the log append-only.
    seq: integer("seq").notNull(),
    fromState: varchar("fromState", { length: 32 }),
    toState: varchar("toState", { length: 32 }).notNull(),
    at: timestamp("at").notNull(),
    actorId: varchar("actorId", { length: 128 }),
    detail: text("detail"),
    // Hash chain: eventHash = sha256_hex(prevEventHash || canonicalEventJson).
    prevEventHash: varchar("prevEventHash", { length: 64 }).notNull(),
    eventHash: varchar("eventHash", { length: 64 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("sa_events_submission_seq_idx").on(t.submissionId, t.seq),
    index("sa_events_dispute_idx").on(t.tenantId, t.disputeId),
  ]
);
export type SubmissionAutomationEvent = typeof submissionAutomationEvents.$inferSelect;
export type InsertSubmissionAutomationEvent = typeof submissionAutomationEvents.$inferInsert;

export const submissionAutomationIdempotency = pgTable(
  "submission_automation_idempotency",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 128 }).notNull(),
    disputeId: varchar("disputeId", { length: 128 }).notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 128 }).notNull(),
    // 'create' | 'transition' — what operation this key was used for.
    operation: varchar("operation", { length: 32 }).notNull(),
    submissionId: varchar("submissionId", { length: 64 }).notNull(),
    // Serialized prior result returned verbatim on replay.
    resultJson: text("resultJson").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("sa_idem_tenant_dispute_key_idx").on(
      t.tenantId,
      t.disputeId,
      t.idempotencyKey
    ),
  ]
);
export type SubmissionAutomationIdempotency =
  typeof submissionAutomationIdempotency.$inferSelect;
export type InsertSubmissionAutomationIdempotency =
  typeof submissionAutomationIdempotency.$inferInsert;
