CREATE TYPE document_analysis_job_status AS ENUM ('pending', 'processing', 'completed', 'requires_review', 'retryable_failure', 'failed', 'dead_letter');
--> statement-breakpoint
CREATE TABLE document_analysis_jobs (
  id varchar(64) PRIMARY KEY,
  "documentId" varchar(64) NOT NULL,
  "disputeId" varchar(64),
  "tenantId" varchar(64) NOT NULL,
  "requestedBy" varchar(64) NOT NULL,
  "inputSha256" varchar(64) NOT NULL,
  "objectUri" varchar(1024) NOT NULL,
  "mimeType" varchar(128) NOT NULL,
  "analysisProfile" varchar(64) NOT NULL,
  "pipelineVersion" varchar(64) NOT NULL,
  status document_analysis_job_status NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  "availableAt" timestamp NOT NULL DEFAULT now(),
  "leaseOwner" varchar(128),
  "leaseExpiresAt" timestamp,
  "lastError" text,
  "completedAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT document_analysis_job_identity_unique UNIQUE ("documentId", "analysisProfile", "inputSha256", "pipelineVersion"),
  CONSTRAINT document_analysis_job_hash_chk CHECK ("inputSha256" ~ '^[a-fA-F0-9]{64}$'),
  CONSTRAINT document_analysis_job_attempts_chk CHECK (attempts >= 0)
);
--> statement-breakpoint
CREATE INDEX document_analysis_jobs_claim_idx ON document_analysis_jobs (status, "availableAt");
--> statement-breakpoint
CREATE INDEX document_analysis_jobs_tenant_idx ON document_analysis_jobs ("tenantId", status);
--> statement-breakpoint
CREATE INDEX document_analysis_jobs_dispute_idx ON document_analysis_jobs ("disputeId");
--> statement-breakpoint
CREATE TABLE document_analysis_results (
  id varchar(64) PRIMARY KEY,
  "jobId" varchar(64) NOT NULL REFERENCES document_analysis_jobs(id) ON DELETE RESTRICT,
  "documentId" varchar(64) NOT NULL,
  "inputSha256" varchar(64) NOT NULL,
  "outputSha256" varchar(64) NOT NULL,
  engine varchar(64) NOT NULL,
  "engineVersion" varchar(128) NOT NULL,
  status varchar(32) NOT NULL,
  "extractedText" text,
  "extractedFields" jsonb,
  provenance jsonb NOT NULL,
  findings jsonb,
  confidence integer,
  "processingTimeMs" integer,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT document_analysis_result_hashes_chk CHECK ("inputSha256" ~ '^[a-fA-F0-9]{64}$' AND "outputSha256" ~ '^[a-fA-F0-9]{64}$'),
  CONSTRAINT document_analysis_result_confidence_chk CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 100),
  CONSTRAINT document_analysis_result_processing_time_chk CHECK ("processingTimeMs" IS NULL OR "processingTimeMs" >= 0),
  CONSTRAINT document_analysis_results_job_unique UNIQUE ("jobId")
);
--> statement-breakpoint
CREATE INDEX document_analysis_results_document_idx ON document_analysis_results ("documentId");
--> statement-breakpoint
CREATE TABLE document_analysis_outbox (
  id varchar(64) PRIMARY KEY,
  "jobId" varchar(64) NOT NULL REFERENCES document_analysis_jobs(id) ON DELETE RESTRICT,
  "eventType" varchar(64) NOT NULL,
  payload jsonb NOT NULL,
  "publishedAt" timestamp,
  attempts integer NOT NULL DEFAULT 0,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT document_analysis_outbox_job_event_unique UNIQUE ("jobId", "eventType"),
  CONSTRAINT document_analysis_outbox_attempts_chk CHECK (attempts >= 0)
);
--> statement-breakpoint
CREATE INDEX document_analysis_outbox_pending_idx ON document_analysis_outbox ("publishedAt", "createdAt");
--> statement-breakpoint
CREATE TABLE document_review_tasks (
  id varchar(64) PRIMARY KEY,
  "jobId" varchar(64) NOT NULL REFERENCES document_analysis_jobs(id) ON DELETE RESTRICT,
  "tenantId" varchar(64) NOT NULL,
  reason text NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'open',
  "assignedTo" varchar(64),
  resolution jsonb,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "resolvedAt" timestamp
);
--> statement-breakpoint
CREATE INDEX document_review_tasks_queue_idx ON document_review_tasks ("tenantId", status);
--> statement-breakpoint
CREATE TABLE model_registry_versions (
  id varchar(64) PRIMARY KEY,
  "modelName" varchar(128) NOT NULL,
  "modelVersion" varchar(128) NOT NULL,
  "artifactSha256" varchar(64) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'candidate',
  provenance jsonb NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT model_registry_identity_unique UNIQUE ("modelName", "modelVersion"),
  CONSTRAINT model_registry_artifact_hash_chk CHECK ("artifactSha256" ~ '^[a-fA-F0-9]{64}$')
);
