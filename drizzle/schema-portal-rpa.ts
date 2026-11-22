/**
 * drizzle/schema-portal-rpa.ts
 *
 * Persistence for the portal RPA driver (server/idr/portal-rpa/*) and for
 * settlement callback replay protection:
 *
 *   - idr_portal_rpa_runs:        durable run records (replaces the module-scope
 *                                 InMemoryRunStore). resume_token is stored ONLY
 *                                 as a SHA-256 hash (hex) — never plaintext — and
 *                                 `version` implements CAS optimistic concurrency.
 *   - idr_portal_rpa_checkpoints: durable checkpoint/MFA interrupts (replaces the
 *                                 module-scope InMemoryCheckpointQueue).
 *   - settlement_callback_nonces: replay-protection ledger for
 *                                 /api/settlement/* signed callbacks (see
 *                                 server/settlement-auth.ts).
 *
 * Defined in a separate module (not appended inline to drizzle/schema.ts) to
 * avoid concurrent-edit conflicts on the shared schema file — same convention
 * as drizzle/schema-idr-compliance.ts. It IS re-exported from drizzle/schema.ts
 * and covered by the drizzle.config.ts `schema-*.ts` glob so future
 * `drizzle-kit generate` runs see these tables. Applied by the hand-written
 * migration drizzle/migrations/0055_wave_auditfix.sql — keep the column lists
 * in sync with that migration.
 */

import {
  pgTable,
  varchar,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ── RPA runs ────────────────────────────────────────────────────────────────
// status: running | checkpoint_required | completed | failed | blocked |
//         dry_run_complete | unconfirmed  (terminal states per terminalStatus
//         in server/idr/portal-rpa/routes.ts)
// payload: full serialized RunRecord minus the plaintext resumeToken.
// resumeTokenHash: sha256 hex of the resume bearer token (lookup key only;
// plaintext is never persisted).
export const idrPortalRpaRuns = pgTable(
  "idr_portal_rpa_runs",
  {
    runId: varchar("run_id", { length: 64 }).primaryKey(),
    submissionId: varchar("submission_id", { length: 128 }).notNull(),
    ownerUserId: varchar("owner_user_id", { length: 128 }),
    status: varchar("status", { length: 32 }).notNull(),
    mode: varchar("mode", { length: 8 }).notNull(),
    resumeTokenHash: varchar("resume_token_hash", { length: 64 }),
    payload: jsonb("payload").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("idr_portal_rpa_runs_submission_idx").on(t.submissionId),
    index("idr_portal_rpa_runs_owner_idx").on(t.ownerUserId),
    index("idr_portal_rpa_runs_status_idx").on(t.status),
    uniqueIndex("idr_portal_rpa_runs_resume_token_hash_idx").on(t.resumeTokenHash),
  ]
);
export type IdrPortalRpaRunRow = typeof idrPortalRpaRuns.$inferSelect;
export type InsertIdrPortalRpaRunRow = typeof idrPortalRpaRuns.$inferInsert;

// ── RPA checkpoints (human/MFA interrupts) ──────────────────────────────────
// One live (unresolved) checkpoint per run; re-enqueue replaces the live entry
// (enforced by the partial unique index created in the migration).
export const idrPortalRpaCheckpoints = pgTable(
  "idr_portal_rpa_checkpoints",
  {
    checkpointId: varchar("checkpoint_id", { length: 64 }).primaryKey(),
    runId: varchar("run_id", { length: 64 })
      .notNull()
      .references(() => idrPortalRpaRuns.runId, { onDelete: "cascade" }),
    submissionId: varchar("submission_id", { length: 128 }).notNull(),
    ownerUserId: varchar("owner_user_id", { length: 128 }),
    checkpoint: jsonb("checkpoint").notNull(),
    resumeTokenHash: varchar("resume_token_hash", { length: 64 }),
    expiresAt: timestamp("expires_at").notNull(),
    claimedBy: varchar("claimed_by", { length: 128 }),
    resolvedAt: timestamp("resolved_at"),
    resolution: jsonb("resolution"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("idr_portal_rpa_checkpoints_run_idx").on(t.runId),
    index("idr_portal_rpa_checkpoints_submission_idx").on(t.submissionId),
    index("idr_portal_rpa_checkpoints_expires_idx").on(t.expiresAt),
  ]
);
export type IdrPortalRpaCheckpointRow = typeof idrPortalRpaCheckpoints.$inferSelect;
export type InsertIdrPortalRpaCheckpointRow = typeof idrPortalRpaCheckpoints.$inferInsert;

// ── Settlement callback replay-protection nonces ────────────────────────────
// One row per observed signed-callback transmission. The nonce is derived (not
// caller-supplied) as sha256hex(`${signature}.${timestamp}.${sha256hex(body)}`)
// because the settlement callback payloads carry no nonce/jti field — see
// server/settlement-auth.ts (deriveSettlementCallbackNonce). A byte-identical
// replay inside the HMAC timestamp window collides on insert and is rejected.
export const settlementCallbackNonces = pgTable(
  "settlement_callback_nonces",
  {
    nonce: varchar("nonce", { length: 128 }).primaryKey(),
    seenAt: timestamp("seen_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (t) => [index("settlement_callback_nonces_expires_idx").on(t.expiresAt)]
);
export type SettlementCallbackNonceRow = typeof settlementCallbackNonces.$inferSelect;
export type InsertSettlementCallbackNonceRow = typeof settlementCallbackNonces.$inferInsert;
