-- phase16: third-party-submitter (delegated representative) capability.
-- CMS-9897-F (91 FR 33900), 45 CFR 149.510(b)(2)(ii)(A)(3) as amended:
-- representative identification + authority attestation on IDR initiation,
-- attestation may allocate administrative-fee debt; 835 CARC/RARC (incl.
-- RARC N830) machine-readable NSA/IDR eligibility signals.
-- All statements idempotent (IF NOT EXISTS / IF NOT EXISTS columns via
-- ADD COLUMN IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS "submitter_clients" (
  "id" varchar(64) PRIMARY KEY,
  "submitterOrgId" varchar(64) NOT NULL REFERENCES "organizations"("id"),
  "clientOrgId" varchar(64),
  "label" varchar(255) NOT NULL,
  "npis" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "tins" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" varchar(16) NOT NULL DEFAULT 'pending',
  "inviteTokenHash" varchar(128),
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "submitter_clients_org_pair_idx"
  ON "submitter_clients" ("submitterOrgId", "clientOrgId");
CREATE INDEX IF NOT EXISTS "submitter_clients_submitter_idx"
  ON "submitter_clients" ("submitterOrgId");
CREATE INDEX IF NOT EXISTS "submitter_clients_client_idx"
  ON "submitter_clients" ("clientOrgId");

CREATE TABLE IF NOT EXISTS "delegation_attestations" (
  "id" varchar(64) PRIMARY KEY,
  "submitterClientId" varchar(64) NOT NULL REFERENCES "submitter_clients"("id"),
  "scope" varchar(16) NOT NULL,
  "authorityText" text NOT NULL,
  "attestedByUserId" varchar(64) NOT NULL,
  "attestedAt" timestamp NOT NULL,
  "effectiveFrom" timestamp NOT NULL,
  "expiresAt" timestamp,
  "adminFeeDebtAccepted" boolean NOT NULL DEFAULT false,
  "artifactSha256" varchar(64) NOT NULL,
  "prevHash" varchar(64) NOT NULL,
  "revokedAt" timestamp,
  "revokedByUserId" varchar(64),
  "status" varchar(16) NOT NULL DEFAULT 'active',
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "delegation_attestations_client_idx"
  ON "delegation_attestations" ("submitterClientId");
CREATE INDEX IF NOT EXISTS "delegation_attestations_status_idx"
  ON "delegation_attestations" ("status");

CREATE TABLE IF NOT EXISTS "remittance_835_files" (
  "id" varchar(64) PRIMARY KEY,
  "orgId" varchar(64) NOT NULL,
  "fileName" varchar(255) NOT NULL,
  "contentSha256" varchar(64) NOT NULL,
  "receivedAt" timestamp NOT NULL DEFAULT now(),
  "lineCount" integer NOT NULL DEFAULT 0,
  "status" varchar(16) NOT NULL DEFAULT 'received',
  "parseError" text
);
CREATE UNIQUE INDEX IF NOT EXISTS "remittance_835_files_org_hash_idx"
  ON "remittance_835_files" ("orgId", "contentSha256");
CREATE INDEX IF NOT EXISTS "remittance_835_files_org_idx"
  ON "remittance_835_files" ("orgId");

CREATE TABLE IF NOT EXISTS "remittance_lines" (
  "id" varchar(64) PRIMARY KEY,
  "fileId" varchar(64) NOT NULL REFERENCES "remittance_835_files"("id"),
  "claimId" text NOT NULL,
  "payerId" varchar(64),
  "npi" varchar(20),
  "cptCode" varchar(16),
  "billedCents" integer,
  "allowedCents" integer,
  "carcCodes" text[],
  "rarcCodes" text[],
  "idrEligibleFlag" boolean NOT NULL DEFAULT false,
  "mappedDisputeId" varchar(64),
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "remittance_lines_file_idx"
  ON "remittance_lines" ("fileId");
CREATE INDEX IF NOT EXISTS "remittance_lines_claim_idx"
  ON "remittance_lines" ("claimId");
CREATE INDEX IF NOT EXISTS "remittance_lines_mapped_idx"
  ON "remittance_lines" ("mappedDisputeId");

-- disputes: delegation + eligibility-attestation columns (Phase 16).
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "submitterClientId" varchar(64);
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "delegationAttestationId" varchar(64);
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "eligibilityAttestedAt" timestamp;
CREATE INDEX IF NOT EXISTS "disputes_submitterClient_idx"
  ON "disputes" ("submitterClientId");
