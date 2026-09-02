-- 0046: Durable TigerBeetle finality/reconciliation control plane.
-- Forward-only. This migration adds no provider credentials and does not enable
-- TigerBeetle posting. It persists sanctioned mapping/intent/attempt evidence so
-- a future approved worker can safely retry an ambiguous create_transfers call.

BEGIN;

CREATE TYPE "tigerbeetle_finality_mode" AS ENUM ('single_phase_settlement');
CREATE TYPE "tigerbeetle_finality_intent_status" AS ENUM ('queued', 'claimed', 'retryable', 'committed', 'exception');
CREATE TYPE "tigerbeetle_finality_attempt_outcome" AS ENUM ('created', 'exists_verified', 'retryable_transport_error', 'permanent_rejection', 'payload_mismatch');
CREATE TYPE "tigerbeetle_finality_authorization_status" AS ENUM ('pending_approval', 'approved', 'consumed', 'cancelled', 'expired');

CREATE TABLE "tigerbeetle_finality_account_mappings" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "provider" varchar(64) NOT NULL,
  "currency" varchar(3) NOT NULL,
  "debitAccountId" varchar(39) NOT NULL,
  "creditAccountId" varchar(39) NOT NULL,
  "ledger" integer NOT NULL,
  "code" integer NOT NULL,
  "mode" "tigerbeetle_finality_mode" NOT NULL,
  "mappingVersion" integer NOT NULL,
  "active" boolean DEFAULT false NOT NULL,
  "verifiedAt" timestamp,
  "verifiedBy" varchar(64),
  "verificationEvidenceSha256" varchar(64),
  "activationEvidenceBundleId" varchar(64) REFERENCES "stakeholder_claim_evidence_bundles"("id") ON DELETE RESTRICT,
  "approvedBy" varchar(64) NOT NULL,
  "approvalReference" varchar(128) NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "tigerbeetle_finality_mapping_account_ids" CHECK (
    "debitAccountId" ~ '^[1-9][0-9]{0,38}$'
    AND "creditAccountId" ~ '^[1-9][0-9]{0,38}$'
    AND "debitAccountId" <> "creditAccountId"
  ),
  CONSTRAINT "tigerbeetle_finality_mapping_ledger_code" CHECK (
    "ledger" > 0 AND "code" BETWEEN 1 AND 65535 AND "mappingVersion" > 0
  ),
  CONSTRAINT "tigerbeetle_finality_mapping_activation_verification" CHECK (
    NOT "active" OR (
      "verifiedAt" IS NOT NULL
      AND "verifiedBy" IS NOT NULL
      AND "verifiedBy" <> "approvedBy"
      AND "verificationEvidenceSha256" ~ '^[a-f0-9]{64}$'
      AND "activationEvidenceBundleId" IS NOT NULL
    )
  )
);
CREATE UNIQUE INDEX "tigerbeetle_finality_mapping_version_idx"
  ON "tigerbeetle_finality_account_mappings" ("provider", "currency", "mappingVersion");
CREATE UNIQUE INDEX "tigerbeetle_finality_mapping_one_active_idx"
  ON "tigerbeetle_finality_account_mappings" ("provider", "currency") WHERE "active";
CREATE UNIQUE INDEX "tigerbeetle_finality_mapping_evidence_idx"
  ON "tigerbeetle_finality_account_mappings" ("activationEvidenceBundleId") WHERE "activationEvidenceBundleId" IS NOT NULL;
CREATE INDEX "tigerbeetle_finality_mapping_active_idx"
  ON "tigerbeetle_finality_account_mappings" ("provider", "currency", "active");

CREATE TABLE "tigerbeetle_finality_intents" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "settlementTransferId" varchar(64) NOT NULL REFERENCES "settlement_transfers"("id") ON DELETE RESTRICT,
  "providerReportId" varchar(64) NOT NULL REFERENCES "settlement_provider_reports"("id") ON DELETE RESTRICT,
  "mappingId" varchar(64) NOT NULL REFERENCES "tigerbeetle_finality_account_mappings"("id") ON DELETE RESTRICT,
  "provider" varchar(64) NOT NULL,
  "currency" varchar(3) NOT NULL,
  "mode" "tigerbeetle_finality_mode" NOT NULL,
  "tigerbeetleTransferId" varchar(39) NOT NULL,
  "debitAccountId" varchar(39) NOT NULL,
  "creditAccountId" varchar(39) NOT NULL,
  "ledger" integer NOT NULL,
  "code" integer NOT NULL,
  "amountCents" bigint NOT NULL,
  "payloadDigest" varchar(64) NOT NULL,
  "status" "tigerbeetle_finality_intent_status" DEFAULT 'queued' NOT NULL,
  "attemptCount" integer DEFAULT 0 NOT NULL,
  "nextAttemptAt" timestamp DEFAULT now() NOT NULL,
  "leaseExpiresAt" timestamp,
  "finalityObservedAt" timestamp,
  "ledgerEntryId" varchar(64),
  "lastOutcome" "tigerbeetle_finality_attempt_outcome",
  "lastErrorCode" varchar(96),
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "tigerbeetle_finality_intent_u128_ids" CHECK (
    "tigerbeetleTransferId" ~ '^[1-9][0-9]{0,38}$'
    AND "debitAccountId" ~ '^[1-9][0-9]{0,38}$'
    AND "creditAccountId" ~ '^[1-9][0-9]{0,38}$'
    AND "debitAccountId" <> "creditAccountId"
  ),
  CONSTRAINT "tigerbeetle_finality_intent_values" CHECK (
    "ledger" > 0 AND "code" BETWEEN 1 AND 65535 AND "amountCents" > 0 AND "attemptCount" >= 0
  ),
  CONSTRAINT "tigerbeetle_finality_intent_digest" CHECK ("payloadDigest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "tigerbeetle_finality_intent_finality_state" CHECK (
    ("status" = 'committed') = ("finalityObservedAt" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "tigerbeetle_finality_intents_transfer_idx"
  ON "tigerbeetle_finality_intents" ("settlementTransferId");
CREATE UNIQUE INDEX "tigerbeetle_finality_intents_report_idx"
  ON "tigerbeetle_finality_intents" ("providerReportId");
CREATE UNIQUE INDEX "tigerbeetle_finality_intents_tb_transfer_idx"
  ON "tigerbeetle_finality_intents" ("tigerbeetleTransferId");
CREATE INDEX "tigerbeetle_finality_intents_claim_idx"
  ON "tigerbeetle_finality_intents" ("status", "nextAttemptAt");

CREATE TABLE "tigerbeetle_finality_submission_authorizations" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "intentId" varchar(64) NOT NULL REFERENCES "tigerbeetle_finality_intents"("id") ON DELETE RESTRICT,
  "changeTicket" varchar(128) NOT NULL,
  "requestReason" text NOT NULL,
  "requestedBy" varchar(64) NOT NULL,
  "requestedAt" timestamp DEFAULT now() NOT NULL,
  "approvedBy" varchar(64),
  "approvedAt" timestamp,
  "expiresAt" timestamp,
  "consumedAt" timestamp,
  "consumedBy" varchar(64),
  "cancelledAt" timestamp,
  "cancelledBy" varchar(64),
  "status" "tigerbeetle_finality_authorization_status" DEFAULT 'pending_approval' NOT NULL,
  CONSTRAINT "tigerbeetle_finality_authorization_ticket" CHECK ("changeTicket" ~ '^CHG-[A-Za-z0-9._-]{3,120}$'),
  CONSTRAINT "tigerbeetle_finality_authorization_state" CHECK (
    ("status" = 'pending_approval' AND "approvedBy" IS NULL AND "approvedAt" IS NULL AND "expiresAt" IS NULL AND "consumedAt" IS NULL AND "consumedBy" IS NULL AND "cancelledAt" IS NULL AND "cancelledBy" IS NULL)
    OR ("status" = 'approved' AND "approvedBy" IS NOT NULL AND "approvedBy" <> "requestedBy" AND "approvedAt" IS NOT NULL AND "expiresAt" > "approvedAt" AND "expiresAt" <= "approvedAt" + interval '30 minutes' AND "consumedAt" IS NULL AND "consumedBy" IS NULL AND "cancelledAt" IS NULL AND "cancelledBy" IS NULL)
    OR ("status" = 'consumed' AND "approvedBy" IS NOT NULL AND "approvedBy" <> "requestedBy" AND "approvedAt" IS NOT NULL AND "expiresAt" IS NOT NULL AND "consumedAt" IS NOT NULL AND "consumedBy" IS NOT NULL AND "consumedBy" <> "requestedBy" AND "consumedBy" <> "approvedBy" AND "cancelledAt" IS NULL AND "cancelledBy" IS NULL)
    OR ("status" = 'cancelled' AND "consumedAt" IS NULL AND "consumedBy" IS NULL AND "cancelledAt" IS NOT NULL AND "cancelledBy" IS NOT NULL)
    OR ("status" = 'expired' AND "consumedAt" IS NULL AND "consumedBy" IS NULL AND "cancelledAt" IS NULL AND "cancelledBy" IS NULL)
  )
);
CREATE INDEX "tigerbeetle_finality_authorization_claim_idx"
  ON "tigerbeetle_finality_submission_authorizations" ("intentId", "status", "expiresAt");
CREATE INDEX "tigerbeetle_finality_authorization_ticket_idx"
  ON "tigerbeetle_finality_submission_authorizations" ("changeTicket");

CREATE TABLE "tigerbeetle_finality_attempts" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "intentId" varchar(64) NOT NULL REFERENCES "tigerbeetle_finality_intents"("id") ON DELETE RESTRICT,
  "attemptNumber" integer NOT NULL,
  "outcome" "tigerbeetle_finality_attempt_outcome" NOT NULL,
  "resultCode" varchar(96) NOT NULL,
  "startedAt" timestamp NOT NULL,
  "completedAt" timestamp NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "tigerbeetle_finality_attempt_number_positive" CHECK ("attemptNumber" > 0),
  CONSTRAINT "tigerbeetle_finality_attempt_time_order" CHECK ("completedAt" >= "startedAt")
);
CREATE UNIQUE INDEX "tigerbeetle_finality_attempt_number_idx"
  ON "tigerbeetle_finality_attempts" ("intentId", "attemptNumber");
CREATE INDEX "tigerbeetle_finality_attempts_intent_idx"
  ON "tigerbeetle_finality_attempts" ("intentId");

CREATE OR REPLACE FUNCTION "tigerbeetle_finality_reject_mapping_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'TigerBeetle finality mappings are immutable; deactivate an old version instead of deleting it' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."provider" <> OLD."provider"
     OR NEW."currency" <> OLD."currency"
     OR NEW."debitAccountId" <> OLD."debitAccountId"
     OR NEW."creditAccountId" <> OLD."creditAccountId"
     OR NEW."ledger" <> OLD."ledger"
     OR NEW."code" <> OLD."code"
     OR NEW."mode" <> OLD."mode"
     OR NEW."mappingVersion" <> OLD."mappingVersion"
     OR NEW."approvedBy" <> OLD."approvedBy"
     OR NEW."approvalReference" <> OLD."approvalReference" THEN
    RAISE EXCEPTION 'TigerBeetle finality mappings are immutable; add a new version and deactivate the old mapping' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "tigerbeetle_finality_mapping_immutable_trigger"
  BEFORE UPDATE OR DELETE ON "tigerbeetle_finality_account_mappings"
  FOR EACH ROW EXECUTE FUNCTION "tigerbeetle_finality_reject_mapping_mutation"();

CREATE OR REPLACE FUNCTION "tigerbeetle_finality_reject_intent_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'TigerBeetle finality intents are immutable; preserve the intent and record a terminal exception instead of deleting it' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."settlementTransferId" <> OLD."settlementTransferId"
     OR NEW."providerReportId" <> OLD."providerReportId"
     OR NEW."provider" <> OLD."provider"
     OR NEW."currency" <> OLD."currency"
     OR NEW."mode" <> OLD."mode"
     OR NEW."mappingId" <> OLD."mappingId"
     OR NEW."tigerbeetleTransferId" <> OLD."tigerbeetleTransferId"
     OR NEW."debitAccountId" <> OLD."debitAccountId"
     OR NEW."creditAccountId" <> OLD."creditAccountId"
     OR NEW."ledger" <> OLD."ledger"
     OR NEW."code" <> OLD."code"
     OR NEW."amountCents" <> OLD."amountCents"
     OR NEW."payloadDigest" <> OLD."payloadDigest"
     OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'TigerBeetle finality intent financial fields are immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "tigerbeetle_finality_intent_immutable_trigger"
  BEFORE UPDATE OR DELETE ON "tigerbeetle_finality_intents"
  FOR EACH ROW EXECUTE FUNCTION "tigerbeetle_finality_reject_intent_mutation"();

CREATE OR REPLACE FUNCTION "tigerbeetle_finality_validate_authorization_transition"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'TigerBeetle finality submission authorizations are immutable; cancel or expire the authorization instead' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."intentId" <> OLD."intentId"
     OR NEW."changeTicket" <> OLD."changeTicket"
     OR NEW."requestReason" <> OLD."requestReason"
     OR NEW."requestedBy" <> OLD."requestedBy"
     OR NEW."requestedAt" <> OLD."requestedAt" THEN
    RAISE EXCEPTION 'TigerBeetle finality submission authorization request fields are immutable' USING ERRCODE = 'P0001';
  END IF;
  IF (OLD."status" = 'pending_approval' AND NEW."status" NOT IN ('pending_approval', 'approved', 'cancelled', 'expired'))
     OR (OLD."status" = 'approved' AND NEW."status" NOT IN ('approved', 'consumed', 'cancelled', 'expired'))
     OR (OLD."status" IN ('consumed', 'cancelled', 'expired') AND NEW."status" <> OLD."status") THEN
    RAISE EXCEPTION 'invalid TigerBeetle finality authorization status transition' USING ERRCODE = 'P0001';
  END IF;
  IF OLD."status" <> 'pending_approval' AND (
       NEW."approvedBy" IS DISTINCT FROM OLD."approvedBy"
       OR NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt"
       OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
     ) THEN
    RAISE EXCEPTION 'approved TigerBeetle finality authorization fields are immutable' USING ERRCODE = 'P0001';
  END IF;
  IF OLD."status" IN ('consumed', 'cancelled', 'expired') AND (
       NEW."consumedAt" IS DISTINCT FROM OLD."consumedAt"
       OR NEW."consumedBy" IS DISTINCT FROM OLD."consumedBy"
       OR NEW."cancelledAt" IS DISTINCT FROM OLD."cancelledAt"
       OR NEW."cancelledBy" IS DISTINCT FROM OLD."cancelledBy"
     ) THEN
    RAISE EXCEPTION 'terminal TigerBeetle finality authorization provenance is immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "tigerbeetle_finality_authorization_transition_trigger"
  BEFORE UPDATE OR DELETE ON "tigerbeetle_finality_submission_authorizations"
  FOR EACH ROW EXECUTE FUNCTION "tigerbeetle_finality_validate_authorization_transition"();

CREATE OR REPLACE FUNCTION "tigerbeetle_finality_reject_attempt_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'TigerBeetle finality attempt evidence is immutable' USING ERRCODE = 'P0001';
END;
$$;
CREATE TRIGGER "tigerbeetle_finality_attempt_immutable_trigger"
  BEFORE UPDATE OR DELETE ON "tigerbeetle_finality_attempts"
  FOR EACH ROW EXECUTE FUNCTION "tigerbeetle_finality_reject_attempt_mutation"();

COMMIT;
