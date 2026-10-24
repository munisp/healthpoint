-- phase17: EHR integration robustness — practice claims staging + eligibility
-- score persistence (audit gaps E1/E3/E5/E6).
-- practice_claims: normalized claims from FHIR bulk $export ndjson, X12 837P,
-- FHIR single-patient pull, or CSV; idempotent by (orgId, contentSha256).
-- practice_claim_scores: deterministic NSA/IDR eligibility rule verdicts with
-- CFR citations (45 CFR 149.510/149.410-149.430, CMS-9897-F). Verdicts are
-- eligibility determinations only — never an assurance of IDR outcome.
-- All statements idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS "practice_claims" (
  "id" varchar(64) PRIMARY KEY,
  "orgId" varchar(64) NOT NULL,
  "emrConnectionId" varchar(64),
  "source" varchar(16) NOT NULL,
  "sourceRef" varchar(128),
  "contentSha256" varchar(64) NOT NULL,
  "claimId" varchar(128),
  "patientRef" varchar(128),
  "planType" varchar(32),
  "serviceCategory" varchar(32),
  "patientState" varchar(2),
  "facilityState" varchar(2),
  "serviceDate" varchar(10),
  "serviceEndDate" varchar(10),
  "placeOfService" varchar(8),
  "networkStatus" varchar(16),
  "noticeConsentStatus" varchar(24),
  "initialPaymentDate" varchar(10),
  "denialDate" varchar(10),
  "priorPaymentDeterminationDate" varchar(10),
  "cptCodes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "modifiers" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "diagnoses" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "payerId" varchar(64),
  "payerName" varchar(255),
  "planIdentifier" varchar(128),
  "renderingNpi" varchar(10),
  "billingNpi" varchar(10),
  "tin" varchar(16),
  "billedCents" bigint,
  "allowedCents" bigint,
  "paidCents" bigint,
  "sourceProvenance" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "sourceResourceRefs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "practice_claims_org_hash_idx"
  ON "practice_claims" ("orgId", "contentSha256");
CREATE INDEX IF NOT EXISTS "practice_claims_org_idx"
  ON "practice_claims" ("orgId");
CREATE INDEX IF NOT EXISTS "practice_claims_connection_idx"
  ON "practice_claims" ("emrConnectionId");
CREATE INDEX IF NOT EXISTS "practice_claims_claimid_idx"
  ON "practice_claims" ("claimId");
CREATE INDEX IF NOT EXISTS "practice_claims_service_date_idx"
  ON "practice_claims" ("serviceDate");

CREATE TABLE IF NOT EXISTS "practice_claim_scores" (
  "id" varchar(64) PRIMARY KEY,
  "claimId" varchar(64) NOT NULL REFERENCES "practice_claims"("id") ON DELETE CASCADE,
  "verdict" varchar(16) NOT NULL,
  "rulesFired" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "missingFields" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "evidenceChecklist" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "completenessPct" integer NOT NULL DEFAULT 0,
  "jurisdiction" varchar(24),
  "winProbabilityStatisticalEstimate" varchar(16),
  "scoredAt" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "practice_claim_scores_claim_idx"
  ON "practice_claim_scores" ("claimId");
CREATE INDEX IF NOT EXISTS "practice_claim_scores_verdict_idx"
  ON "practice_claim_scores" ("verdict");
