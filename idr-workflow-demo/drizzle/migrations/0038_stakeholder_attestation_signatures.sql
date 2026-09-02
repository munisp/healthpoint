-- Cryptographic key binding for stakeholder claim attestations.
-- Ed25519 is the sole accepted evidence-signing algorithm in this migration.

CREATE TYPE stakeholder_claim_signing_key_status AS ENUM (
  'active',
  'retired',
  'revoked'
);

CREATE TYPE stakeholder_claim_signature_algorithm AS ENUM (
  'ed25519'
);

CREATE TABLE stakeholder_claim_signing_keys (
  id varchar(64) PRIMARY KEY,
  "keyId" varchar(128) NOT NULL UNIQUE,
  "subjectIdentity" varchar(256) NOT NULL,
  "displayName" varchar(256) NOT NULL,
  "permittedAttestationKinds" stakeholder_claim_attestation_kind[] NOT NULL,
  algorithm stakeholder_claim_signature_algorithm NOT NULL DEFAULT 'ed25519',
  "publicKeyPem" text NOT NULL,
  "publicKeySha256" varchar(64) NOT NULL UNIQUE,
  status stakeholder_claim_signing_key_status NOT NULL DEFAULT 'active',
  "validFrom" timestamptz NOT NULL,
  "validUntil" timestamptz,
  "revokedAt" timestamptz,
  "revokedBy" varchar(256),
  "revocationReason" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "createdBy" varchar(256) NOT NULL,
  CONSTRAINT stakeholder_claim_signing_key_hash_chk
    CHECK ("publicKeySha256" ~ '^[a-fA-F0-9]{64}$'),
  CONSTRAINT stakeholder_claim_signing_key_pem_chk
    CHECK ("publicKeyPem" LIKE '-----BEGIN PUBLIC KEY-----%'),
  CONSTRAINT stakeholder_claim_signing_key_kinds_chk
    CHECK (
      cardinality("permittedAttestationKinds") > 0
      AND "permittedAttestationKinds" <@ ARRAY['owner', 'independent_reviewer']::stakeholder_claim_attestation_kind[]
    ),
  CONSTRAINT stakeholder_claim_signing_key_validity_chk
    CHECK ("validUntil" IS NULL OR "validFrom" < "validUntil"),
  CONSTRAINT stakeholder_claim_signing_key_revocation_state_chk
    CHECK (
      (status <> 'revoked' AND "revokedAt" IS NULL AND "revokedBy" IS NULL AND "revocationReason" IS NULL)
      OR (status = 'revoked' AND "revokedAt" IS NOT NULL AND "revokedBy" IS NOT NULL AND "revocationReason" IS NOT NULL)
    )
);

CREATE INDEX stakeholder_claim_signing_key_subject_status_idx
  ON stakeholder_claim_signing_keys ("subjectIdentity", status, "validFrom", "validUntil");

ALTER TABLE stakeholder_claim_reviewer_attestations
  ADD COLUMN "signingKeyId" varchar(64) REFERENCES stakeholder_claim_signing_keys(id) ON DELETE RESTRICT,
  ADD COLUMN "signatureAlgorithm" stakeholder_claim_signature_algorithm,
  ADD COLUMN "signatureBase64" text,
  ADD COLUMN "signedPayloadSha256" varchar(64),
  ADD COLUMN "cryptographicallyVerifiedAt" timestamptz,
  ADD COLUMN "cryptographicVerifierVersion" varchar(64);

ALTER TABLE stakeholder_claim_reviewer_attestations
  ADD CONSTRAINT stakeholder_claim_attestation_signature_state_chk
  CHECK (
    (
      "signingKeyId" IS NULL
      AND "signatureAlgorithm" IS NULL
      AND "signatureBase64" IS NULL
      AND "signedPayloadSha256" IS NULL
      AND "cryptographicallyVerifiedAt" IS NULL
      AND "cryptographicVerifierVersion" IS NULL
    )
    OR
    (
      "signingKeyId" IS NOT NULL
      AND "signatureAlgorithm" = 'ed25519'
      AND length("signatureBase64") BETWEEN 80 AND 256
      AND "signedPayloadSha256" ~ '^[a-fA-F0-9]{64}$'
      AND "cryptographicallyVerifiedAt" IS NOT NULL
      AND "cryptographicVerifierVersion" IS NOT NULL
    )
  );

CREATE INDEX stakeholder_claim_attestation_signing_key_idx
  ON stakeholder_claim_reviewer_attestations ("signingKeyId", "cryptographicallyVerifiedAt");

CREATE OR REPLACE FUNCTION enforce_stakeholder_claim_signing_key_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."keyId" IS DISTINCT FROM NEW."keyId"
      OR OLD."subjectIdentity" IS DISTINCT FROM NEW."subjectIdentity"
      OR OLD."displayName" IS DISTINCT FROM NEW."displayName"
      OR OLD."permittedAttestationKinds" IS DISTINCT FROM NEW."permittedAttestationKinds"
      OR OLD.algorithm IS DISTINCT FROM NEW.algorithm
      OR OLD."publicKeyPem" IS DISTINCT FROM NEW."publicKeyPem"
      OR OLD."publicKeySha256" IS DISTINCT FROM NEW."publicKeySha256"
      OR OLD."validFrom" IS DISTINCT FROM NEW."validFrom"
      OR OLD."validUntil" IS DISTINCT FROM NEW."validUntil"
      OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt"
      OR OLD."createdBy" IS DISTINCT FROM NEW."createdBy" THEN
      RAISE EXCEPTION 'Stakeholder claim signing-key identity and trust fields are immutable';
    END IF;
    IF OLD.status = 'revoked' THEN
      RAISE EXCEPTION 'Revoked stakeholder claim signing keys are immutable';
    END IF;
    IF OLD.status = 'retired' AND NEW.status = 'active' THEN
      RAISE EXCEPTION 'Retired stakeholder claim signing keys may not be reactivated';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER stakeholder_claim_signing_key_lifecycle_trigger
  BEFORE UPDATE ON stakeholder_claim_signing_keys
  FOR EACH ROW EXECUTE FUNCTION enforce_stakeholder_claim_signing_key_lifecycle();

CREATE OR REPLACE FUNCTION enforce_stakeholder_claim_attestation_key_binding()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  signer stakeholder_claim_signing_keys%ROWTYPE;
BEGIN
  IF NEW."signingKeyId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO signer FROM stakeholder_claim_signing_keys WHERE id = NEW."signingKeyId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stakeholder claim attestation references an unknown signing key';
  END IF;
  IF signer.status <> 'active' THEN
    RAISE EXCEPTION 'Stakeholder claim attestation signing key must be active';
  END IF;
  IF signer."validFrom" > NEW."approvedAt"
    OR (signer."validUntil" IS NOT NULL AND signer."validUntil" < NEW."approvedAt") THEN
    RAISE EXCEPTION 'Stakeholder claim attestation signing key is outside its validity interval';
  END IF;
  IF NOT NEW.kind = ANY(signer."permittedAttestationKinds") THEN
    RAISE EXCEPTION 'Stakeholder claim signing key is not authorized for this attestation kind';
  END IF;
  IF signer."subjectIdentity" <> NEW."reviewerIdentity" THEN
    RAISE EXCEPTION 'Stakeholder claim attestation reviewer identity does not match signing-key subject';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM stakeholder_claim_reviewer_attestations a
    WHERE a."bundleId" = NEW."bundleId"
      AND a."signingKeyId" = NEW."signingKeyId"
      AND a.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'Owner and independent reviewer must use distinct signing keys';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM stakeholder_claim_reviewer_attestations a
    WHERE a."bundleId" = NEW."bundleId"
      AND a."reviewerIdentity" = NEW."reviewerIdentity"
      AND a.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'Owner and independent reviewer must use distinct reviewer identities';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER stakeholder_claim_attestation_key_binding_trigger
  BEFORE INSERT ON stakeholder_claim_reviewer_attestations
  FOR EACH ROW EXECUTE FUNCTION enforce_stakeholder_claim_attestation_key_binding();

CREATE OR REPLACE FUNCTION enforce_stakeholder_claim_evidence_bundle_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  owner_identity varchar(256);
  reviewer_identity varchar(256);
  owner_approved_at timestamptz;
  reviewer_approved_at timestamptz;
  owner_key_id varchar(64);
  reviewer_key_id varchar(64);
  owner_verified_at timestamptz;
  reviewer_verified_at timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."claimId" IS DISTINCT FROM NEW."claimId"
      OR OLD."claimStatement" IS DISTINCT FROM NEW."claimStatement"
      OR OLD."claimType" IS DISTINCT FROM NEW."claimType"
      OR OLD."schemaVersion" IS DISTINCT FROM NEW."schemaVersion"
      OR OLD.environment IS DISTINCT FROM NEW.environment
      OR OLD."evidenceRootUri" IS DISTINCT FROM NEW."evidenceRootUri"
      OR OLD."manifestSha256" IS DISTINCT FROM NEW."manifestSha256"
      OR OLD."validationReportSha256" IS DISTINCT FROM NEW."validationReportSha256"
      OR OLD."sourceSystem" IS DISTINCT FROM NEW."sourceSystem"
      OR OLD."dataClassification" IS DISTINCT FROM NEW."dataClassification"
      OR OLD."collectionStartedAt" IS DISTINCT FROM NEW."collectionStartedAt"
      OR OLD."collectionEndedAt" IS DISTINCT FROM NEW."collectionEndedAt"
      OR OLD."completedAt" IS DISTINCT FROM NEW."completedAt"
      OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt" THEN
      RAISE EXCEPTION 'Stakeholder claim evidence bundle identity and integrity fields are immutable';
    END IF;
    IF OLD.status = 'validated' AND NEW.status <> 'superseded' THEN
      RAISE EXCEPTION 'Validated stakeholder claim evidence may only transition to superseded';
    END IF;
    IF OLD.status = 'rejected' AND NEW.status <> 'superseded' THEN
      RAISE EXCEPTION 'Rejected stakeholder claim evidence may only transition to superseded';
    END IF;
  END IF;

  IF NEW.status = 'validated' THEN
    SELECT "reviewerIdentity", "approvedAt", "signingKeyId", "cryptographicallyVerifiedAt"
      INTO owner_identity, owner_approved_at, owner_key_id, owner_verified_at
      FROM stakeholder_claim_reviewer_attestations
      WHERE "bundleId" = NEW.id AND kind = 'owner';
    SELECT "reviewerIdentity", "approvedAt", "signingKeyId", "cryptographicallyVerifiedAt"
      INTO reviewer_identity, reviewer_approved_at, reviewer_key_id, reviewer_verified_at
      FROM stakeholder_claim_reviewer_attestations
      WHERE "bundleId" = NEW.id AND kind = 'independent_reviewer';
    IF owner_identity IS NULL OR reviewer_identity IS NULL THEN
      RAISE EXCEPTION 'Validated stakeholder claim evidence requires owner and independent reviewer attestations';
    END IF;
    IF owner_identity = reviewer_identity OR owner_key_id = reviewer_key_id THEN
      RAISE EXCEPTION 'Stakeholder claim evidence owner and independent reviewer must be distinct';
    END IF;
    IF owner_verified_at IS NULL OR reviewer_verified_at IS NULL THEN
      RAISE EXCEPTION 'Validated stakeholder claim evidence requires cryptographically verified attestations';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM stakeholder_claim_signing_keys
      WHERE id IN (owner_key_id, reviewer_key_id)
        AND (
          status <> 'active'
          OR "revokedAt" IS NOT NULL
          OR "validFrom" > now()
          OR ("validUntil" IS NOT NULL AND "validUntil" < now())
        )
    ) THEN
      RAISE EXCEPTION 'Validated stakeholder claim evidence requires active, non-revoked, non-expired signing keys';
    END IF;
    IF reviewer_approved_at < owner_approved_at THEN
      RAISE EXCEPTION 'Independent reviewer approval must not precede owner approval';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM stakeholder_claim_evidence_artifacts WHERE "bundleId" = NEW.id) THEN
      RAISE EXCEPTION 'Validated stakeholder claim evidence requires at least one immutable artifact';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
