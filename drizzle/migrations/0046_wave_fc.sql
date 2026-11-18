-- wave-fc (Phase 13 final gap closure)
-- Covers G8 (org suspension), G9 (API-key org binding),
-- G6 (NPI verification status + IDRE certification admin-verify workflow).
-- drizzle/schema.ts and drizzle/schema-personas.ts are the source of truth.

-- G8: organizations.status ('active' | 'suspended') + suspension metadata.
-- Org-scoped mutations are blocked for members of suspended orgs
-- (assertOrgNotSuspended in server/routers/personas.ts).
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "status" varchar(16) NOT NULL DEFAULT 'active';
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "suspendedAt" timestamp;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "suspendedByUserId" varchar(64);
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "suspensionReason" text;

-- G9: API-key org binding. Nullable for LEGACY keys minted before this
-- column existed. BACKFILL NOTE: legacy rows remain orgId=NULL and continue
-- to work user-scoped until revoked; operators should revoke/reissue legacy
-- keys (apiKeys.revoke then apiKeys.create with an org context). New keys
-- cannot be created without an org context, and key-authenticated requests
-- presenting a different tenant/org id are rejected (server/auth/bearer.ts).
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "orgId" varchar(64);
CREATE INDEX IF NOT EXISTS "api_keys_orgId_idx" ON "api_keys" ("orgId");

-- G6: NPPES NPI verification outcome on provider profiles
-- ('verified' | 'unverified' | 'mismatch'; NULL = never checked).
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "npiVerified" varchar(16);

-- G6: IDRE certification admin-verify workflow (no public registry exists —
-- an admin marks the certification verified with an evidence note, audit-logged).
ALTER TABLE "idr_entities" ADD COLUMN IF NOT EXISTS "certificationStatus" varchar(16) NOT NULL DEFAULT 'submitted';
ALTER TABLE "idr_entities" ADD COLUMN IF NOT EXISTS "certificationVerifiedAt" timestamp;
ALTER TABLE "idr_entities" ADD COLUMN IF NOT EXISTS "certificationVerifiedBy" varchar(64);
ALTER TABLE "idr_entities" ADD COLUMN IF NOT EXISTS "certificationEvidenceNote" text;
