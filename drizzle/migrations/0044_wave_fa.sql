-- wave-fa (Phase 13 stakeholder onboarding remediation)
-- Covers G1 (invite tokens), G4 (patient token revocation),
-- G7 (duplicate payer-email guard). drizzle/schema-personas.ts is the
-- source of truth for these tables; drizzle/schema.ts is wave-owned and
-- intentionally NOT edited.

-- G4: explicit revocation timestamp for patient access tokens. Access paths
-- check revokedAt alongside expiresAt/usedAt.
ALTER TABLE "patient_access_tokens" ADD COLUMN IF NOT EXISTS "revokedAt" timestamp;

-- G1: email-delivered invite tokens (payer invites + org membership invites).
-- Only the sha256 hash of the raw bearer token is stored.
CREATE TABLE IF NOT EXISTS "invite_tokens" (
  "id" varchar(64) PRIMARY KEY,
  "tokenHash" varchar(128) NOT NULL,
  "email" varchar(320) NOT NULL,
  "purpose" varchar(32) NOT NULL,
  "orgId" varchar(64),
  "orgRole" varchar(32),
  "payerAccountId" varchar(64),
  "disputeId" varchar(64),
  "invitedByUserId" varchar(64) NOT NULL,
  "expiresAt" timestamp NOT NULL,
  "acceptedAt" timestamp,
  "acceptedByUserId" varchar(64),
  "revokedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "invite_tokens_hash_idx" ON "invite_tokens" ("tokenHash");
CREATE INDEX IF NOT EXISTS "invite_tokens_email_idx" ON "invite_tokens" ("email");

-- G7: one payer account per contact email. payer.invite resolves/looks up
-- accounts by contactEmail and previously tolerated silent duplicates
-- (accounts[0] mis-binding). NOTE: on non-fresh databases with pre-existing
-- duplicate contactEmail rows, this index creation will fail — deduplicate
-- payer_accounts first (merge duplicates into the earliest account and
-- re-point payer_case_links.payerAccountId) before applying.
CREATE UNIQUE INDEX IF NOT EXISTS "payer_accounts_contact_email_uidx"
  ON "payer_accounts" ("contactEmail");
