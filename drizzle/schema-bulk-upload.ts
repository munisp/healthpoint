/**
 * drizzle/schema-bulk-upload.ts
 *
 * Phase 19: chunked, resumable million-claim web ingestion.
 *
 * Tables:
 *  - bulk_upload_sessions: one row per uploaded file; tracks chunk ledger
 *    progress, ingestion watermark (chunk + row offset), and row counters.
 *  - bulk_upload_chunks: raw chunk bytes in Postgres bytea (transactional
 *    with session state; works with embedded-pg test env). Composite PK
 *    (session_id, chunk_index); re-PUT of the same chunk is idempotent.
 *  - claim_quarantine: row-level parse/validation failures captured during
 *    ingestion with missingFields detail; repairable via
 *    bulkUpload.repairQuarantinedRows (delegates to the same
 *    applyManualClaimFields helper as practiceAudit.bulkCompleteClaims).
 *
 * Separate module (not appended to drizzle/schema.ts) to avoid
 * concurrent-edit conflicts, matching the schema-submitter.ts /
 * schema-practice-claims.ts precedent. Applied by the hand-written
 * migration drizzle/migrations/0053_wave_p19.sql.
 *
 * Honesty: throughput/memory behavior at true million-row scale is UNPROVEN
 * (no staging infra for a real million-claim load test). Verified at journey
 * scale (thousands of rows) only.
 */

import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  jsonb,
  customType,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

/** bytea column (drizzle pg-core has no first-class bytea builder here). */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export type BulkUploadFileType = "csv" | "ndjson" | "837" | "835";
export type BulkUploadStatus =
  | "uploading"
  | "ready"
  | "ingesting"
  | "completed"
  | "failed"
  | "cancelled";
export type QuarantineStatus = "quarantined" | "repaired" | "discarded";

export const bulkUploadSessions = pgTable(
  "bulk_upload_sessions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: varchar("org_id", { length: 64 }).notNull(),
    createdByUserId: varchar("created_by_user_id", { length: 64 }).notNull(),
    fileName: text("file_name").notNull(),
    fileType: varchar("file_type", { length: 8 }).notNull(), // csv | ndjson | 837 | 835
    declaredSizeBytes: bigint("declared_size_bytes", { mode: "number" }).notNull(),
    chunkSizeBytes: integer("chunk_size_bytes").notNull().default(8_388_608), // 8 MiB
    totalChunks: integer("total_chunks").notNull(),
    chunksReceived: integer("chunks_received").notNull().default(0),
    assembledSha256: varchar("assembled_sha256", { length: 64 }),
    status: varchar("status", { length: 24 }).notNull().default("uploading"),
    /** Last fully-ingested chunk index (0-based; -ish semantics: next chunk = watermark_chunk). */
    watermarkChunk: integer("watermark_chunk").notNull().default(0),
    /** Row offset within the resumed unit (ndjson/csv line number; 837/835 claim index). */
    watermarkOffset: integer("watermark_offset").notNull().default(0),
    rowsProcessed: integer("rows_processed").notNull().default(0),
    rowsAccepted: integer("rows_accepted").notNull().default(0),
    rowsQuarantined: integer("rows_quarantined").notNull().default(0),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("bulk_upload_sessions_org_status_idx").on(t.orgId, t.status),
    index("bulk_upload_sessions_org_created_idx").on(t.orgId, t.createdAt),
  ],
);

export const bulkUploadChunks = pgTable(
  "bulk_upload_chunks",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => bulkUploadSessions.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    byteLength: integer("byte_length").notNull(),
    data: bytea("data").notNull(),
    /** Resume marker: true once the runner has fully ingested this chunk. */
    ingested: boolean("ingested").notNull().default(false),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.chunkIndex] }),
    index("bulk_upload_chunks_session_ingested_idx").on(t.sessionId, t.ingested),
  ],
);

export const claimQuarantine = pgTable(
  "claim_quarantine",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => bulkUploadSessions.id, { onDelete: "cascade" }),
    orgId: varchar("org_id", { length: 64 }).notNull(),
    /** 1-based line/claim index in the file. */
    rowNumber: integer("row_number").notNull(),
    /** Offending line/segment, capped at 64KB server-side. */
    rawPayload: text("raw_payload").notNull(),
    errorReason: text("error_reason").notNull(),
    missingFields: jsonb("missing_fields").notNull().default([]),
    status: varchar("status", { length: 16 }).notNull().default("quarantined"),
    repairedClaimId: varchar("repaired_claim_id", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("claim_quarantine_org_status_idx").on(t.orgId, t.status),
    index("claim_quarantine_session_idx").on(t.sessionId),
  ],
);

export type BulkUploadSession = typeof bulkUploadSessions.$inferSelect;
export type BulkUploadChunk = typeof bulkUploadChunks.$inferSelect;
export type ClaimQuarantineRow = typeof claimQuarantine.$inferSelect;
