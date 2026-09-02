ALTER TABLE outcome_predictions
  ADD COLUMN "modelId" varchar(128),
  ADD COLUMN "modelArtifactSha256" varchar(64),
  ADD COLUMN "modelValidationRunId" varchar(64),
  ADD COLUMN "modelApprovalGateId" varchar(64),
  ADD COLUMN "documentValidationRunId" varchar(64),
  ADD COLUMN "confidenceInterval" jsonb,
  ADD COLUMN "decisionSupportOnly" boolean NOT NULL DEFAULT true,
  ADD COLUMN "governanceApprovedAt" timestamp;
--> statement-breakpoint
CREATE INDEX outcome_predictions_governance_gate_idx
  ON outcome_predictions ("modelApprovalGateId", "governanceApprovedAt");
--> statement-breakpoint
CREATE INDEX outcome_predictions_document_validation_idx
  ON outcome_predictions ("documentValidationRunId");
--> statement-breakpoint
ALTER TABLE outcome_predictions
  ADD CONSTRAINT outcome_predictions_governed_shape_chk
  CHECK (
    ("modelId" IS NULL AND "modelArtifactSha256" IS NULL AND "modelValidationRunId" IS NULL AND "modelApprovalGateId" IS NULL AND "documentValidationRunId" IS NULL AND "governanceApprovedAt" IS NULL)
    OR
    ("modelId" IS NOT NULL
      AND "modelArtifactSha256" ~ '^[a-fA-F0-9]{64}$'
      AND "modelValidationRunId" IS NOT NULL
      AND "modelApprovalGateId" IS NOT NULL
      AND "documentValidationRunId" IS NOT NULL
      AND "confidenceInterval" IS NOT NULL
      AND "decisionSupportOnly" = true
      AND "governanceApprovedAt" IS NOT NULL)
  ) NOT VALID;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_governed_outcome_prediction_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."modelApprovalGateId" IS NOT NULL AND (
    OLD."modelId" IS DISTINCT FROM NEW."modelId" OR
    OLD."modelVersion" IS DISTINCT FROM NEW."modelVersion" OR
    OLD."modelArtifactSha256" IS DISTINCT FROM NEW."modelArtifactSha256" OR
    OLD."modelValidationRunId" IS DISTINCT FROM NEW."modelValidationRunId" OR
    OLD."modelApprovalGateId" IS DISTINCT FROM NEW."modelApprovalGateId" OR
    OLD."documentValidationRunId" IS DISTINCT FROM NEW."documentValidationRunId" OR
    OLD."confidenceInterval" IS DISTINCT FROM NEW."confidenceInterval" OR
    OLD."governanceApprovedAt" IS DISTINCT FROM NEW."governanceApprovedAt"
  ) THEN
    RAISE EXCEPTION 'Governed outcome provenance is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER outcome_predictions_governance_immutable_trigger
  BEFORE UPDATE ON outcome_predictions
  FOR EACH ROW EXECUTE FUNCTION prevent_governed_outcome_prediction_mutation();
