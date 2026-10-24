-- phase18: one-stop submitter feature set.
--  * submitter_clients: per-client billing configuration (contingency pct of
--    awards or flat per-dispute fee) for submitter invoicing.
--  * submitter_invoices / submitter_invoice_lines: honest per-client invoices
--    generated FROM determinations data (no payment processing — invoice
--    lifecycle only: draft -> sent -> paid / void).
--  * audit_share_tokens: tokenized read-only share links for practice-audit
--    reports (three-lane scorecard). sha256 storage (patient-token pattern),
--    expiry + revocation, use tracking.
-- All statements idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).

ALTER TABLE "submitter_clients" ADD COLUMN IF NOT EXISTS "billingModel" varchar(16) NOT NULL DEFAULT 'flat';
ALTER TABLE "submitter_clients" ADD COLUMN IF NOT EXISTS "contingencyPct" numeric(5,2);
ALTER TABLE "submitter_clients" ADD COLUMN IF NOT EXISTS "flatFeeUsd" numeric(12,2);

CREATE TABLE IF NOT EXISTS "submitter_invoices" (
  "id" varchar(64) PRIMARY KEY,
  "submitterClientId" varchar(64) NOT NULL,
  /** Human-facing invoice number, unique per submitter client. */
  "invoiceNumber" varchar(48) NOT NULL,
  "billingModel" varchar(16) NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'draft',
  "periodStart" timestamp NOT NULL,
  "periodEnd" timestamp NOT NULL,
  "totalUsd" numeric(12,2) NOT NULL DEFAULT 0,
  "lineCount" integer NOT NULL DEFAULT 0,
  /** Snapshot of the computation inputs (honesty/audit trail). */
  "computationNotes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "issuedAt" timestamp,
  "paidAt" timestamp,
  "voidedAt" timestamp,
  "createdByUserId" varchar(64),
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "submitter_invoices_number_idx" ON "submitter_invoices" ("submitterClientId", "invoiceNumber");
CREATE INDEX IF NOT EXISTS "submitter_invoices_client_idx" ON "submitter_invoices" ("submitterClientId");
CREATE INDEX IF NOT EXISTS "submitter_invoices_status_idx" ON "submitter_invoices" ("status");

CREATE TABLE IF NOT EXISTS "submitter_invoice_lines" (
  "id" varchar(64) PRIMARY KEY,
  "invoiceId" varchar(64) NOT NULL,
  "disputeId" varchar(64) NOT NULL,
  "referenceNumber" varchar(32),
  /** Award (determinationAmount) the charge was computed from, when known. */
  "awardUsd" numeric(12,2),
  "chargeUsd" numeric(12,2) NOT NULL,
  "description" text NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "submitter_invoice_lines_invoice_idx" ON "submitter_invoice_lines" ("invoiceId");
CREATE UNIQUE INDEX IF NOT EXISTS "submitter_invoice_lines_dispute_idx" ON "submitter_invoice_lines" ("invoiceId", "disputeId");

CREATE TABLE IF NOT EXISTS "audit_share_tokens" (
  "id" varchar(64) PRIMARY KEY,
  /** sha256 hex of the bearer token; the raw token is never stored. */
  "tokenHash" varchar(128) NOT NULL,
  "orgId" varchar(64) NOT NULL,
  /** Fixed scope for now: read-only practice-audit scorecard. */
  "scope" varchar(32) NOT NULL DEFAULT 'practice_audit_read',
  "label" varchar(255),
  "expiresAt" timestamp NOT NULL,
  "revokedAt" timestamp,
  "revokedByUserId" varchar(64),
  "createdByUserId" varchar(64) NOT NULL,
  "lastAccessedAt" timestamp,
  "accessCount" integer NOT NULL DEFAULT 0,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "audit_share_tokens_hash_idx" ON "audit_share_tokens" ("tokenHash");
CREATE INDEX IF NOT EXISTS "audit_share_tokens_org_idx" ON "audit_share_tokens" ("orgId");

-- Auto-batcher confirmation trail: batched disputes carry a batchId and the
-- line-item count; source disputes folded into a batch are linked back.
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "batchId" varchar(64);
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "batchedLineItemCount" integer;
CREATE INDEX IF NOT EXISTS "disputes_batch_idx" ON "disputes" ("batchId");
