CREATE TABLE document_validation_runs (
  id varchar(64) PRIMARY KEY,
  "documentId" varchar(64) NOT NULL,
  "disputeId" varchar(64),
  "inputSha256" varchar(64) NOT NULL,
  "pipelineVersion" varchar(64) NOT NULL,
  "modelGovernanceRunId" varchar(64) NOT NULL REFERENCES model_validation_runs(id) ON DELETE RESTRICT,
  "humanApprovalId" varchar(128) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'pending',
  "approvedAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT document_validation_identity_unique UNIQUE ("documentId", "inputSha256", "pipelineVersion"),
  CONSTRAINT document_validation_input_hash_chk CHECK ("inputSha256" ~ '^[a-fA-F0-9]{64}$'),
  CONSTRAINT document_validation_status_chk CHECK (status IN ('pending', 'passed', 'failed', 'requires_review', 'superseded')),
  CONSTRAINT document_validation_approval_chk CHECK ((status = 'passed' AND "approvedAt" IS NOT NULL) OR (status <> 'passed'))
);
--> statement-breakpoint
CREATE INDEX document_validation_dispute_idx ON document_validation_runs ("disputeId");
--> statement-breakpoint
CREATE INDEX document_validation_status_idx ON document_validation_runs (status);
--> statement-breakpoint
CREATE TABLE document_validation_step_evidence (
  id varchar(64) PRIMARY KEY,
  "validationRunId" varchar(64) NOT NULL REFERENCES document_validation_runs(id) ON DELETE RESTRICT,
  step varchar(64) NOT NULL,
  "evidenceSha256" varchar(64) NOT NULL,
  actor varchar(128) NOT NULL,
  "completedAt" timestamp NOT NULL,
  "evidenceUri" varchar(1024),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT document_validation_step_identity_unique UNIQUE ("validationRunId", step),
  CONSTRAINT document_validation_step_hash_chk CHECK ("evidenceSha256" ~ '^[a-fA-F0-9]{64}$')
);
--> statement-breakpoint
CREATE INDEX document_validation_step_hash_idx ON document_validation_step_evidence ("evidenceSha256");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_document_validation_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Document validation evidence is immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER document_validation_evidence_immutable_trigger
  BEFORE UPDATE OR DELETE ON document_validation_step_evidence
  FOR EACH ROW EXECUTE FUNCTION prevent_document_validation_evidence_mutation();
