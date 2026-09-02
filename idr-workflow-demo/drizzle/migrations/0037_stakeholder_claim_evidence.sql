CREATE TYPE stakeholder_claim_evidence_status AS ENUM ('pending_review', 'validated', 'rejected', 'superseded');
--> statement-breakpoint
CREATE TYPE stakeholder_claim_attestation_kind AS ENUM ('owner', 'independent_reviewer');
--> statement-breakpoint
CREATE TABLE stakeholder_claim_evidence_bundles (
  id varchar(64) PRIMARY KEY,
  "claimId" varchar(128) NOT NULL,
  "claimStatement" text NOT NULL,
  "claimType" varchar(64) NOT NULL,
  "schemaVersion" varchar(16) NOT NULL,
  environment varchar(32) NOT NULL,
  "evidenceRootUri" varchar(1024) NOT NULL,
  "manifestSha256" varchar(64) NOT NULL,
  "validationReportSha256" varchar(64),
  "sourceSystem" varchar(256) NOT NULL,
  "dataClassification" varchar(128) NOT NULL,
  "collectionStartedAt" timestamp,
  "collectionEndedAt" timestamp,
  "completedAt" timestamp NOT NULL,
  status stakeholder_claim_evidence_status NOT NULL DEFAULT 'pending_review',
  "validatedBy" varchar(128),
  "validatedAt" timestamp,
  "invalidatedBy" varchar(128),
  "invalidatedAt" timestamp,
  "invalidationReason" text,
  "supersedesBundleId" varchar(64) REFERENCES stakeholder_claim_evidence_bundles(id) ON DELETE RESTRICT,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT stakeholder_claim_bundle_claim_manifest_unique UNIQUE ("claimId", "manifestSha256"),
  CONSTRAINT stakeholder_claim_bundle_manifest_hash_chk CHECK ("manifestSha256" ~ '^[a-fA-F0-9]{64}$'),
  CONSTRAINT stakeholder_claim_bundle_validation_hash_chk CHECK ("validationReportSha256" IS NULL OR "validationReportSha256" ~ '^[a-fA-F0-9]{64}$'),
  CONSTRAINT stakeholder_claim_bundle_status_audit_chk CHECK ((status = 'validated' AND "validatedBy" IS NOT NULL AND "validatedAt" IS NOT NULL) OR (status <> 'validated'))
);
--> statement-breakpoint
CREATE INDEX stakeholder_claim_evidence_claim_status_idx ON stakeholder_claim_evidence_bundles ("claimId", status, "validatedAt");
--> statement-breakpoint
CREATE INDEX stakeholder_claim_evidence_validation_idx ON stakeholder_claim_evidence_bundles (status, "validatedAt");
--> statement-breakpoint
CREATE TABLE stakeholder_claim_evidence_artifacts (
  id varchar(64) PRIMARY KEY,
  "bundleId" varchar(64) NOT NULL REFERENCES stakeholder_claim_evidence_bundles(id) ON DELETE RESTRICT,
  "relativePath" varchar(1024) NOT NULL,
  "artifactRole" varchar(128) NOT NULL,
  sha256 varchar(64) NOT NULL,
  "byteSize" bigint NOT NULL,
  "artifactCreatedAt" timestamp NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  "recordedAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT stakeholder_claim_artifact_path_unique UNIQUE ("bundleId", "relativePath"),
  CONSTRAINT stakeholder_claim_artifact_hash_chk CHECK (sha256 ~ '^[a-fA-F0-9]{64}$'),
  CONSTRAINT stakeholder_claim_artifact_size_chk CHECK ("byteSize" >= 0)
);
--> statement-breakpoint
CREATE INDEX stakeholder_claim_artifact_hash_idx ON stakeholder_claim_evidence_artifacts (sha256);
--> statement-breakpoint
CREATE TABLE stakeholder_claim_reviewer_attestations (
  id varchar(64) PRIMARY KEY,
  "bundleId" varchar(64) NOT NULL REFERENCES stakeholder_claim_evidence_bundles(id) ON DELETE RESTRICT,
  kind stakeholder_claim_attestation_kind NOT NULL,
  "reviewerName" varchar(256) NOT NULL,
  "reviewerRole" varchar(256) NOT NULL,
  "reviewerIdentity" varchar(256) NOT NULL,
  "approvedAt" timestamp NOT NULL,
  "signatureUri" varchar(1024),
  "signatureSha256" varchar(64),
  "attestationSha256" varchar(64) NOT NULL,
  "attestationText" text NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT stakeholder_claim_reviewer_kind_unique UNIQUE ("bundleId", kind),
  CONSTRAINT stakeholder_claim_reviewer_hash_chk CHECK ("attestationSha256" ~ '^[a-fA-F0-9]{64}$' AND ("signatureSha256" IS NULL OR "signatureSha256" ~ '^[a-fA-F0-9]{64}$'))
);
--> statement-breakpoint
CREATE INDEX stakeholder_claim_reviewer_identity_idx ON stakeholder_claim_reviewer_attestations ("reviewerIdentity", "approvedAt");
