-- phase20: payment-instrument capture + CMS IDR gateway + Stripe billing.
--  * 20-A: 835 BPR/TRN header capture (5 columns on remittance_835_files,
--    2 propagated columns on remittance_lines) + manual_check_postings
--    (paper check bookkeeping — lifecycle posted→matched→deposited→reconciled;
--    reconciliation is human-confirmed proposals only; no payment is ever
--    initiated, PAYMENT_EXECUTION_MODE stays disabled/sandbox).
--  * 20-B: CMS IDR Gateway connector bookkeeping on disputes
--    (gateway_submission_id / gateway_status). The connector is an
--    ASSUMPTION-based scaffold: as of 2026-09 CMS has published NO public
--    machine-to-machine Gateway API spec; default mode is disabled and the
--    platform continues the assisted-manual portal-package flow.
--  * 20-C: Stripe Checkout collection for submitter_invoices (card +
--    us_bank_account ACH; platform ABSORBS processing fees, ACH-preferred,
--    NO surcharge/pass-through anywhere). stripe_webhook_events stores
--    verified events keyed by evt_ id for idempotent delivery.
-- All statements idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).

-- ── 20-A ────────────────────────────────────────────────────────────────────
ALTER TABLE "remittance_835_files"
  ADD COLUMN IF NOT EXISTS "paymentMethodCode" varchar(8),
  ADD COLUMN IF NOT EXISTS "paymentMethod" varchar(16),
  ADD COLUMN IF NOT EXISTS "totalPaymentCents" integer,
  ADD COLUMN IF NOT EXISTS "paymentTraceNumber" varchar(64),
  ADD COLUMN IF NOT EXISTS "paymentEffectiveDate" varchar(10);

ALTER TABLE "remittance_lines"
  ADD COLUMN IF NOT EXISTS "paymentMethodCode" varchar(8),
  ADD COLUMN IF NOT EXISTS "paymentTraceNumber" varchar(64);
CREATE INDEX IF NOT EXISTS "remittance_lines_trace_idx"
  ON "remittance_lines" ("paymentTraceNumber");

CREATE TABLE IF NOT EXISTS "manual_check_postings" (
  "id" varchar(64) PRIMARY KEY,
  "orgId" varchar(64) NOT NULL,
  "checkNumber" varchar(64) NOT NULL,
  "amountCents" integer NOT NULL,
  "payerName" varchar(255) NOT NULL,
  "receivedDate" varchar(10) NOT NULL,
  "depositDate" varchar(10),
  "matchedRemittanceLineIds" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "matchedPaymentTraceNumber" varchar(64),
  "status" varchar(16) NOT NULL DEFAULT 'posted',
  "createdBy" varchar(64) NOT NULL,
  "notes" text,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "manual_check_postings_status_check"
    CHECK ("status" IN ('posted','matched','deposited','reconciled'))
);
CREATE INDEX IF NOT EXISTS "manual_check_postings_org_idx"
  ON "manual_check_postings" ("orgId");
CREATE UNIQUE INDEX IF NOT EXISTS "manual_check_postings_org_check_idx"
  ON "manual_check_postings" ("orgId", "checkNumber", "payerName");

-- ── 20-B ────────────────────────────────────────────────────────────────────
ALTER TABLE "disputes"
  ADD COLUMN IF NOT EXISTS "gateway_submission_id" varchar(128),
  ADD COLUMN IF NOT EXISTS "gateway_status" varchar(32);
CREATE INDEX IF NOT EXISTS "disputes_gateway_status_idx"
  ON "disputes" ("gateway_status") WHERE "gateway_submission_id" IS NOT NULL;

-- ── 20-C ────────────────────────────────────────────────────────────────────
ALTER TABLE "submitter_invoices"
  ADD COLUMN IF NOT EXISTS "stripeSessionId" varchar(128),
  ADD COLUMN IF NOT EXISTS "stripeInvoiceId" varchar(128),
  ADD COLUMN IF NOT EXISTS "stripeStatus" varchar(24);
CREATE INDEX IF NOT EXISTS "submitter_invoices_stripe_session_idx"
  ON "submitter_invoices" ("stripeSessionId") WHERE "stripeSessionId" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "stripe_webhook_events" (
  "id" varchar(128) PRIMARY KEY,
  "type" varchar(64) NOT NULL,
  "payload" jsonb NOT NULL,
  "processedAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "stripe_webhook_events_type_idx"
  ON "stripe_webhook_events" ("type");
