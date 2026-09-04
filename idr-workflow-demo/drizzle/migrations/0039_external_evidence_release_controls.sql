-- Durable controls for governed data use and CMS human-portal pilot authorization.
-- These records support evidence-gated release decisions; they never authorize
-- automated CMS portal submission.

CREATE TYPE data_use_approval_status AS ENUM (
  'pending',
  'approved',
  'rejected',
  'expired',
  'revoked'
);

CREATE TYPE evidence_stop_decision AS ENUM (
  'proceed',
  'hold',
  'abort'
);

CREATE TABLE model_data_use_approvals (
  id varchar(64) PRIMARY KEY,
  "datasetId" varchar(128) NOT NULL,
  "datasetSha256" varchar(64) NOT NULL,
  "approvedPurpose" varchar(64) NOT NULL,
  "approvedScope" text NOT NULL,
  "dataController" varchar(256) NOT NULL,
  "privacyReviewerId" varchar(128) NOT NULL,
  "legalReviewerId" varchar(128) NOT NULL,
  status data_use_approval_status NOT NULL DEFAULT 'pending',
  "stopDecision" evidence_stop_decision NOT NULL DEFAULT 'hold',
  "stopDecisionReason" text NOT NULL,
  "retentionPolicyUri" text NOT NULL,
  "redactionMethod" text NOT NULL,
  "evidenceSha256" varchar(64) NOT NULL,
  "approvedBy" varchar(128),
  "approvedAt" timestamptz,
  "expiresAt" timestamptz,
  "revokedAt" timestamptz,
  "revokedBy" varchar(128),
  "revocationReason" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "createdBy" varchar(128) NOT NULL,
  CONSTRAINT model_data_use_approval_dataset_hash_chk
    CHECK ("datasetSha256" ~ '^[a-fA-F0-9]{64}$'),
  CONSTRAINT model_data_use_approval_evidence_hash_chk
    CHECK ("evidenceSha256" ~ '^[a-fA-F0-9]{64}$'),
  CONSTRAINT model_data_use_approval_purpose_chk
    CHECK ("approvedPurpose" = 'model_validation'),
  CONSTRAINT model_data_use_approval_expiry_chk
    CHECK ("expiresAt" IS NULL OR "approvedAt" IS NULL OR "expiresAt" > "approvedAt"),
  CONSTRAINT model_data_use_approval_state_chk
    CHECK (
      (
        status = 'approved'
        AND "stopDecision" = 'proceed'
        AND "approvedBy" IS NOT NULL
        AND "approvedAt" IS NOT NULL
        AND "expiresAt" IS NOT NULL
        AND "revokedAt" IS NULL
        AND "revokedBy" IS NULL
        AND "revocationReason" IS NULL
      )
      OR
      (
        status <> 'approved'
        AND "stopDecision" IN ('hold', 'abort')
      )
    ),
  CONSTRAINT model_data_use_approval_revocation_chk
    CHECK (
      (status = 'revoked' AND "revokedAt" IS NOT NULL AND "revokedBy" IS NOT NULL AND "revocationReason" IS NOT NULL)
      OR
      (status <> 'revoked' AND "revokedAt" IS NULL AND "revokedBy" IS NULL AND "revocationReason" IS NULL)
    )
);

CREATE UNIQUE INDEX model_data_use_approvals_dataset_hash_uidx
  ON model_data_use_approvals ("datasetId", "datasetSha256");
CREATE INDEX model_data_use_approvals_status_expiry_idx
  ON model_data_use_approvals (status, "expiresAt");

CREATE TYPE cms_pilot_authorization_status AS ENUM (
  'pending',
  'approved',
  'held',
  'aborted',
  'expired',
  'revoked'
);

CREATE TABLE cms_pilot_authorizations (
  id varchar(64) PRIMARY KEY,
  "approvedScope" text NOT NULL,
  "approvedBy" varchar(128),
  "operatorId" varchar(128) NOT NULL,
  "operatorTrainingRecordSha256" varchar(64) NOT NULL,
  "operatorTrainingRecordUri" text NOT NULL,
  "sopSha256" varchar(64) NOT NULL,
  "sopUri" text NOT NULL,
  "escalationOwnerId" varchar(128) NOT NULL,
  status cms_pilot_authorization_status NOT NULL DEFAULT 'pending',
  "stopDecision" evidence_stop_decision NOT NULL DEFAULT 'hold',
  "stopDecisionReason" text NOT NULL,
  "evidenceSha256" varchar(64) NOT NULL,
  "approvedAt" timestamptz,
  "expiresAt" timestamptz,
  "revokedAt" timestamptz,
  "revokedBy" varchar(128),
  "revocationReason" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "createdBy" varchar(128) NOT NULL,
  CONSTRAINT cms_pilot_authorization_training_hash_chk
    CHECK ("operatorTrainingRecordSha256" ~ '^[a-fA-F0-9]{64}$'),
  CONSTRAINT cms_pilot_authorization_sop_hash_chk
    CHECK ("sopSha256" ~ '^[a-fA-F0-9]{64}$'),
  CONSTRAINT cms_pilot_authorization_evidence_hash_chk
    CHECK ("evidenceSha256" ~ '^[a-fA-F0-9]{64}$'),
  CONSTRAINT cms_pilot_authorization_expiry_chk
    CHECK ("expiresAt" IS NULL OR "approvedAt" IS NULL OR "expiresAt" > "approvedAt"),
  CONSTRAINT cms_pilot_authorization_state_chk
    CHECK (
      (
        status = 'approved'
        AND "stopDecision" = 'proceed'
        AND "approvedBy" IS NOT NULL
        AND "approvedAt" IS NOT NULL
        AND "expiresAt" IS NOT NULL
        AND "revokedAt" IS NULL
        AND "revokedBy" IS NULL
        AND "revocationReason" IS NULL
      )
      OR
      (
        status <> 'approved'
        AND "stopDecision" IN ('hold', 'abort')
      )
    ),
  CONSTRAINT cms_pilot_authorization_revocation_chk
    CHECK (
      (status = 'revoked' AND "revokedAt" IS NOT NULL AND "revokedBy" IS NOT NULL AND "revocationReason" IS NOT NULL)
      OR
      (status <> 'revoked' AND "revokedAt" IS NULL AND "revokedBy" IS NULL AND "revocationReason" IS NULL)
    )
);

CREATE INDEX cms_pilot_authorizations_status_expiry_idx
  ON cms_pilot_authorizations (status, "expiresAt");
CREATE INDEX cms_pilot_authorizations_operator_idx
  ON cms_pilot_authorizations ("operatorId");

CREATE OR REPLACE FUNCTION enforce_model_data_use_approval_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."datasetId" IS DISTINCT FROM NEW."datasetId"
      OR OLD."datasetSha256" IS DISTINCT FROM NEW."datasetSha256"
      OR OLD."approvedPurpose" IS DISTINCT FROM NEW."approvedPurpose"
      OR OLD."approvedScope" IS DISTINCT FROM NEW."approvedScope"
      OR OLD."dataController" IS DISTINCT FROM NEW."dataController"
      OR OLD."privacyReviewerId" IS DISTINCT FROM NEW."privacyReviewerId"
      OR OLD."legalReviewerId" IS DISTINCT FROM NEW."legalReviewerId"
      OR OLD."retentionPolicyUri" IS DISTINCT FROM NEW."retentionPolicyUri"
      OR OLD."redactionMethod" IS DISTINCT FROM NEW."redactionMethod"
      OR OLD."evidenceSha256" IS DISTINCT FROM NEW."evidenceSha256"
      OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt"
      OR OLD."createdBy" IS DISTINCT FROM NEW."createdBy" THEN
      RAISE EXCEPTION 'Model data-use approval identity and evidence fields are immutable';
    END IF;
    IF OLD.status IN ('rejected', 'expired', 'revoked') THEN
      RAISE EXCEPTION 'Terminal model data-use approval records are immutable';
    END IF;
    IF OLD.status = 'approved' AND NEW.status NOT IN ('expired', 'revoked') THEN
      RAISE EXCEPTION 'Approved model data-use records may only expire or be revoked';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER model_data_use_approval_lifecycle_trigger
  BEFORE UPDATE ON model_data_use_approvals
  FOR EACH ROW EXECUTE FUNCTION enforce_model_data_use_approval_lifecycle();

CREATE OR REPLACE FUNCTION enforce_cms_pilot_authorization_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."approvedScope" IS DISTINCT FROM NEW."approvedScope"
      OR OLD."operatorId" IS DISTINCT FROM NEW."operatorId"
      OR OLD."operatorTrainingRecordSha256" IS DISTINCT FROM NEW."operatorTrainingRecordSha256"
      OR OLD."operatorTrainingRecordUri" IS DISTINCT FROM NEW."operatorTrainingRecordUri"
      OR OLD."sopSha256" IS DISTINCT FROM NEW."sopSha256"
      OR OLD."sopUri" IS DISTINCT FROM NEW."sopUri"
      OR OLD."escalationOwnerId" IS DISTINCT FROM NEW."escalationOwnerId"
      OR OLD."evidenceSha256" IS DISTINCT FROM NEW."evidenceSha256"
      OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt"
      OR OLD."createdBy" IS DISTINCT FROM NEW."createdBy" THEN
      RAISE EXCEPTION 'CMS pilot authorization identity and evidence fields are immutable';
    END IF;
    IF OLD.status IN ('aborted', 'expired', 'revoked') THEN
      RAISE EXCEPTION 'Terminal CMS pilot authorization records are immutable';
    END IF;
    IF OLD.status = 'approved' AND NEW.status NOT IN ('held', 'aborted', 'expired', 'revoked') THEN
      RAISE EXCEPTION 'Approved CMS pilot authorizations may only be held, aborted, expired, or revoked';
    END IF;
    IF OLD.status = 'held' AND NEW.status NOT IN ('approved', 'aborted', 'expired', 'revoked') THEN
      RAISE EXCEPTION 'Held CMS pilot authorizations may only proceed by explicit reapproval or become terminal';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cms_pilot_authorization_lifecycle_trigger
  BEFORE UPDATE ON cms_pilot_authorizations
  FOR EACH ROW EXECUTE FUNCTION enforce_cms_pilot_authorization_lifecycle();
