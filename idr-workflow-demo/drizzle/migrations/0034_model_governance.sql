CREATE TYPE model_validation_status AS ENUM ('pending', 'passed', 'failed', 'superseded');
--> statement-breakpoint
CREATE TYPE model_approval_status AS ENUM ('pending', 'approved', 'rejected', 'revoked');
--> statement-breakpoint
CREATE TABLE model_governance_models (
  id varchar(128) PRIMARY KEY,
  version varchar(64) NOT NULL,
  "artifactSha256" varchar(64) NOT NULL,
  "featureSchemaVersion" varchar(64) NOT NULL,
  "trainingDatasetId" varchar(128) NOT NULL,
  owner varchar(256) NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT model_governance_models_version_unique UNIQUE (id, version),
  CONSTRAINT model_governance_models_artifact_unique UNIQUE ("artifactSha256"),
  CONSTRAINT model_governance_models_hash_chk CHECK ("artifactSha256" ~ '^[a-fA-F0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE model_validation_datasets (
  id varchar(128) PRIMARY KEY,
  "sourceUrl" text NOT NULL,
  "sourceDescription" text NOT NULL,
  "datasetSha256" varchar(64) NOT NULL,
  "rowCount" integer NOT NULL,
  "positiveCount" integer NOT NULL,
  "negativeCount" integer NOT NULL,
  "asOf" timestamp NOT NULL,
  "licenseConfirmed" boolean NOT NULL,
  "externalValidation" boolean NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT model_validation_datasets_hash_unique UNIQUE ("datasetSha256"),
  CONSTRAINT model_validation_datasets_hash_chk CHECK ("datasetSha256" ~ '^[a-fA-F0-9]{64}$'),
  CONSTRAINT model_validation_datasets_counts_chk CHECK ("rowCount" >= 0 AND "positiveCount" >= 0 AND "negativeCount" >= 0 AND "positiveCount" + "negativeCount" <= "rowCount")
);
--> statement-breakpoint
CREATE TABLE model_validation_runs (
  id varchar(64) PRIMARY KEY,
  "modelId" varchar(128) NOT NULL,
  "modelVersion" varchar(64) NOT NULL,
  "datasetId" varchar(128) NOT NULL REFERENCES model_validation_datasets(id) ON DELETE RESTRICT,
  status model_validation_status NOT NULL DEFAULT 'pending',
  metrics jsonb NOT NULL,
  checks jsonb NOT NULL,
  "rejectionReasons" jsonb NOT NULL,
  "createdBy" varchar(128) NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT model_validation_runs_model_fk FOREIGN KEY ("modelId", "modelVersion") REFERENCES model_governance_models(id, version) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX model_validation_runs_model_idx ON model_validation_runs ("modelId", "modelVersion");
--> statement-breakpoint
CREATE INDEX model_validation_runs_dataset_idx ON model_validation_runs ("datasetId");
--> statement-breakpoint
CREATE INDEX model_validation_runs_status_idx ON model_validation_runs (status);
--> statement-breakpoint
CREATE TABLE model_approval_gates (
  id varchar(64) PRIMARY KEY,
  "modelId" varchar(128) NOT NULL,
  "modelVersion" varchar(64) NOT NULL,
  "validationRunId" varchar(64) NOT NULL REFERENCES model_validation_runs(id) ON DELETE RESTRICT,
  status model_approval_status NOT NULL DEFAULT 'pending',
  "approvedBy" varchar(128),
  "decisionReason" text,
  "decidedAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT model_approval_gates_version_unique UNIQUE ("modelId", "modelVersion"),
  CONSTRAINT model_approval_gates_model_fk FOREIGN KEY ("modelId", "modelVersion") REFERENCES model_governance_models(id, version) ON DELETE RESTRICT,
  CONSTRAINT model_approval_gates_decision_chk CHECK ((status = 'pending' AND "approvedBy" IS NULL AND "decidedAt" IS NULL) OR (status IN ('approved', 'rejected', 'revoked') AND "approvedBy" IS NOT NULL AND "decidedAt" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX model_approval_gates_status_idx ON model_approval_gates (status);
