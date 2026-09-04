-- 0047: Enforce previously defined stakeholder evidence/key integrity functions.
-- Forward-only corrective migration. It does not activate mappings or submit transfers.

BEGIN;

-- The lifecycle and integrity functions were introduced in migration 0038. Attach
-- them now rather than rewriting an already-applied migration.
CREATE TRIGGER "stakeholder_claim_evidence_bundle_integrity_trigger"
  BEFORE INSERT OR UPDATE ON "stakeholder_claim_evidence_bundles"
  FOR EACH ROW EXECUTE FUNCTION enforce_stakeholder_claim_evidence_bundle_integrity();

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

  -- An independently verified active mapping is an immutable financial account
  -- configuration. Only `active` may later change, to permit controlled
  -- deactivation during version rotation.
  IF OLD."active" AND (
       NEW."verifiedAt" IS DISTINCT FROM OLD."verifiedAt"
       OR NEW."verifiedBy" IS DISTINCT FROM OLD."verifiedBy"
       OR NEW."verificationEvidenceSha256" IS DISTINCT FROM OLD."verificationEvidenceSha256"
       OR NEW."activationEvidenceBundleId" IS DISTINCT FROM OLD."activationEvidenceBundleId"
     ) THEN
    RAISE EXCEPTION 'Active TigerBeetle finality mapping verification evidence is immutable' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "tigerbeetle_finality_validate_mapping_activation_evidence"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  evidence_status stakeholder_claim_evidence_status;
  evidence_claim_type varchar(64);
  evidence_environment varchar(32);
  evidence_manifest_sha256 varchar(64);
BEGIN
  IF NOT NEW."active" THEN
    RETURN NEW;
  END IF;

  SELECT status, "claimType", environment, "manifestSha256"
    INTO evidence_status, evidence_claim_type, evidence_environment, evidence_manifest_sha256
    FROM "stakeholder_claim_evidence_bundles"
    WHERE id = NEW."activationEvidenceBundleId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active TigerBeetle finality mapping requires an existing activation evidence bundle' USING ERRCODE = 'P0001';
  END IF;
  IF evidence_status <> 'validated'
     OR evidence_claim_type <> 'tigerbeetle_finality_mapping'
     OR evidence_environment <> 'staging' THEN
    RAISE EXCEPTION 'Active TigerBeetle finality mapping requires validated staging finality evidence' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."verificationEvidenceSha256" <> evidence_manifest_sha256 THEN
    RAISE EXCEPTION 'TigerBeetle finality mapping verification digest must match activation evidence bundle' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."verifiedBy" IS NULL OR NEW."verifiedAt" IS NULL OR NEW."verifiedBy" = NEW."approvedBy" THEN
    RAISE EXCEPTION 'TigerBeetle finality mapping requires an independent verifier and verification timestamp' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "tigerbeetle_finality_mapping_activation_evidence_trigger"
  BEFORE INSERT OR UPDATE ON "tigerbeetle_finality_account_mappings"
  FOR EACH ROW EXECUTE FUNCTION "tigerbeetle_finality_validate_mapping_activation_evidence"();

COMMIT;
