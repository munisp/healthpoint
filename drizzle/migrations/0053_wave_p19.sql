-- phase19: chunked, resumable million-claim web ingestion.
--  * bulk_upload_sessions: per-file upload session with chunk ledger,
--    ingestion watermark (chunk + row offset) and row counters.
--  * bulk_upload_chunks: raw chunk bytes (bytea), composite PK
--    (session_id, chunk_index), idempotent re-PUT, cascade with session.
--  * claim_quarantine: row-level parse/validation failures with
--    missingFields detail; repairable via the shared applyManualClaimFields
--    helper (server/routers/practice-audit.ts).
-- All statements idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS "bulk_upload_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" varchar(64) NOT NULL,
  "created_by_user_id" varchar(64) NOT NULL,
  "file_name" text NOT NULL,
  "file_type" varchar(8) NOT NULL,
  "declared_size_bytes" bigint NOT NULL,
  "chunk_size_bytes" integer NOT NULL DEFAULT 8388608,
  "total_chunks" integer NOT NULL,
  "chunks_received" integer NOT NULL DEFAULT 0,
  "assembled_sha256" varchar(64),
  "status" varchar(24) NOT NULL DEFAULT 'uploading',
  "watermark_chunk" integer NOT NULL DEFAULT 0,
  "watermark_offset" integer NOT NULL DEFAULT 0,
  "rows_processed" integer NOT NULL DEFAULT 0,
  "rows_accepted" integer NOT NULL DEFAULT 0,
  "rows_quarantined" integer NOT NULL DEFAULT 0,
  "error_message" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "finalized_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  CONSTRAINT "bulk_upload_sessions_file_type_check" CHECK ("file_type" IN ('csv','ndjson','837','835')),
  CONSTRAINT "bulk_upload_sessions_status_check" CHECK ("status" IN ('uploading','ready','ingesting','completed','failed','cancelled'))
);
CREATE INDEX IF NOT EXISTS "bulk_upload_sessions_org_status_idx" ON "bulk_upload_sessions" ("org_id", "status");
CREATE INDEX IF NOT EXISTS "bulk_upload_sessions_org_created_idx" ON "bulk_upload_sessions" ("org_id", "created_at");

CREATE TABLE IF NOT EXISTS "bulk_upload_chunks" (
  "session_id" uuid NOT NULL REFERENCES "bulk_upload_sessions"("id") ON DELETE CASCADE,
  "chunk_index" integer NOT NULL,
  "sha256" varchar(64) NOT NULL,
  "byte_length" integer NOT NULL,
  "data" bytea NOT NULL,
  "ingested" boolean NOT NULL DEFAULT false,
  "received_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("session_id", "chunk_index")
);
CREATE INDEX IF NOT EXISTS "bulk_upload_chunks_session_ingested_idx" ON "bulk_upload_chunks" ("session_id", "ingested");

CREATE TABLE IF NOT EXISTS "claim_quarantine" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id" uuid NOT NULL REFERENCES "bulk_upload_sessions"("id") ON DELETE CASCADE,
  "org_id" varchar(64) NOT NULL,
  "row_number" integer NOT NULL,
  "raw_payload" text NOT NULL,
  "error_reason" text NOT NULL,
  "missing_fields" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" varchar(16) NOT NULL DEFAULT 'quarantined',
  "repaired_claim_id" varchar(64),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "resolved_at" timestamp with time zone,
  CONSTRAINT "claim_quarantine_status_check" CHECK ("status" IN ('quarantined','repaired','discarded'))
);
CREATE INDEX IF NOT EXISTS "claim_quarantine_org_status_idx" ON "claim_quarantine" ("org_id", "status");
CREATE INDEX IF NOT EXISTS "claim_quarantine_session_idx" ON "claim_quarantine" ("session_id");
