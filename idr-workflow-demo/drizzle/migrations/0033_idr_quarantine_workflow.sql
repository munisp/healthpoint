CREATE TABLE file_quarantine_jobs (
  id varchar(64) PRIMARY KEY,
  "documentId" varchar(64) NOT NULL,
  "tenantId" varchar(64) NOT NULL,
  "disputeId" varchar(64),
  "objectUri" varchar(1024) NOT NULL,
  "inputSha256" varchar(64) NOT NULL,
  "mimeType" varchar(128) NOT NULL,
  "byteSize" bigint NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'quarantined',
  attempts integer NOT NULL DEFAULT 0,
  "availableAt" timestamp NOT NULL DEFAULT now(),
  "leaseOwner" varchar(128),
  "leaseExpiresAt" timestamp,
  "lastError" text,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT file_quarantine_document_hash_unique UNIQUE ("documentId", "inputSha256"),
  CONSTRAINT file_quarantine_hash_chk CHECK ("inputSha256" ~ '^[a-fA-F0-9]{64}$'),
  CONSTRAINT file_quarantine_byte_size_chk CHECK ("byteSize" >= 0),
  CONSTRAINT file_quarantine_attempts_chk CHECK (attempts >= 0),
  CONSTRAINT file_quarantine_status_chk CHECK (status IN ('quarantined', 'scanning', 'clean', 'infected', 'review', 'failed', 'released'))
);
--> statement-breakpoint
CREATE INDEX file_quarantine_claim_idx ON file_quarantine_jobs (status, "availableAt");
--> statement-breakpoint
CREATE INDEX file_quarantine_tenant_idx ON file_quarantine_jobs ("tenantId", status);
--> statement-breakpoint
CREATE TABLE virus_scan_results (
  id varchar(64) PRIMARY KEY,
  "quarantineJobId" varchar(64) NOT NULL REFERENCES file_quarantine_jobs(id) ON DELETE RESTRICT,
  "documentId" varchar(64) NOT NULL,
  scanner varchar(64) NOT NULL,
  "scannerVersion" varchar(128) NOT NULL,
  status varchar(32) NOT NULL,
  signature varchar(512),
  "inputSha256" varchar(64) NOT NULL,
  report jsonb NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT virus_scan_result_job_unique UNIQUE ("quarantineJobId"),
  CONSTRAINT virus_scan_result_hash_chk CHECK ("inputSha256" ~ '^[a-fA-F0-9]{64}$'),
  CONSTRAINT virus_scan_result_status_chk CHECK (status IN ('quarantined', 'scanning', 'clean', 'infected', 'review', 'failed', 'released'))
);
--> statement-breakpoint
CREATE INDEX virus_scan_result_document_idx ON virus_scan_results ("documentId");
--> statement-breakpoint
CREATE TABLE quarantine_events (
  id varchar(64) PRIMARY KEY,
  "quarantineJobId" varchar(64) NOT NULL REFERENCES file_quarantine_jobs(id) ON DELETE RESTRICT,
  "documentId" varchar(64) NOT NULL,
  "eventType" varchar(64) NOT NULL,
  status varchar(32) NOT NULL,
  metadata jsonb NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT quarantine_events_status_chk CHECK (status IN ('quarantined', 'scanning', 'clean', 'infected', 'review', 'failed', 'released'))
);
--> statement-breakpoint
CREATE INDEX quarantine_events_job_idx ON quarantine_events ("quarantineJobId", "createdAt");
