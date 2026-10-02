-- wave-w5 (admin/product P1 remediation)
-- Columns/tables added here are accessed via raw SQL or via wave-owned
-- modules; drizzle/schema.ts is owned by another wave and intentionally
-- NOT edited (same convention as 0039_wave_w3.sql).

-- W5-1: IDRE directory — fee ranges on idr_entities.
ALTER TABLE "idr_entities" ADD COLUMN IF NOT EXISTS "feeSingleUsd" numeric(12,2);
--> statement-breakpoint
ALTER TABLE "idr_entities" ADD COLUMN IF NOT EXISTS "feeBatchedUsd" numeric(12,2);
--> statement-breakpoint

-- W5-3: email digest idempotency markers (one digest per user per period).
ALTER TABLE "email_digest_preferences" ADD COLUMN IF NOT EXISTS "lastDailyDigestSentAt" timestamp;
--> statement-breakpoint
ALTER TABLE "email_digest_preferences" ADD COLUMN IF NOT EXISTS "lastWeeklyDigestSentAt" timestamp;
--> statement-breakpoint

-- W5-4: DB-backed administrative fee schedule. Seeded from the verified
-- effective-dated tiers in server/idr/clocks-2026/params-2026.ts
-- (CMS-9897-F; 45 CFR 149.510(d)(2)(ii)(B)). clocks-2026 routes read this
-- table first and fall back to the hardcoded params when no row matches.
CREATE TABLE IF NOT EXISTS "fee_schedules" (
  "id" varchar(64) PRIMARY KEY,
  "effectiveYear" integer NOT NULL,
  "tier" varchar(16) NOT NULL,                  -- single | batched
  "effectiveFrom" varchar(10) NOT NULL,         -- ISO date yyyy-mm-dd, inclusive
  "effectiveTo" varchar(10),                    -- ISO date, exclusive; null = open-ended
  "amountUsd" numeric(12,2) NOT NULL,
  "citation" text,
  "updatedBy" varchar(64),
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fee_schedules_tier_from_idx" ON "fee_schedules" ("tier", "effectiveFrom");
--> statement-breakpoint
INSERT INTO "fee_schedules" ("id", "effectiveYear", "tier", "effectiveFrom", "effectiveTo", "amountUsd", "citation", "updatedBy")
SELECT * FROM (VALUES
  ('fee-seed-single-pre2024', 2023, 'single', '1900-01-01', '2024-01-22', 50::numeric, 'Pre-2024-01-22 tier', 'wave-w5-seed'),
  ('fee-seed-single-2024', 2024, 'single', '2024-01-22', '2026-06-11', 115::numeric, 'December 2023 fee notice (2024-01-22 through 2026-06-10)', 'wave-w5-seed'),
  ('fee-seed-single-2026', 2026, 'single', '2026-06-11', NULL, 15::numeric, 'CMS-9897-F, 45 CFR 149.510(d)(2)(ii)(B) (disputes initiated on/after 2026-06-11)', 'wave-w5-seed'),
  ('fee-seed-batched-pre2024', 2023, 'batched', '1900-01-01', '2024-01-22', 50::numeric, 'Pre-2024-01-22 tier', 'wave-w5-seed'),
  ('fee-seed-batched-2024', 2024, 'batched', '2024-01-22', '2026-06-11', 115::numeric, 'December 2023 fee notice (2024-01-22 through 2026-06-10)', 'wave-w5-seed'),
  ('fee-seed-batched-2026', 2026, 'batched', '2026-06-11', NULL, 15::numeric, 'CMS-9897-F, 45 CFR 149.510(d)(2)(ii)(B) (disputes initiated on/after 2026-06-11)', 'wave-w5-seed')
) AS seed("id", "effectiveYear", "tier", "effectiveFrom", "effectiveTo", "amountUsd", "citation", "updatedBy")
WHERE NOT EXISTS (SELECT 1 FROM "fee_schedules" LIMIT 1);
--> statement-breakpoint

-- W5-7: feature flags (deterministic per-user rollout bucketing).
CREATE TABLE IF NOT EXISTS "feature_flags" (
  "key" varchar(128) PRIMARY KEY,
  "enabled" boolean DEFAULT true NOT NULL,
  "rolloutPercent" integer DEFAULT 100 NOT NULL,  -- 0..100
  "description" text,
  "updatedBy" varchar(64),
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "feature_flags" ("key", "enabled", "rolloutPercent", "description", "updatedBy")
SELECT * FROM (VALUES
  ('personas.payerCases', true, 100, 'Gate for /payer/cases persona page', 'wave-w5-seed'),
  ('personas.idreQueue', true, 100, 'Gate for /idre/queue persona page', 'wave-w5-seed'),
  ('personas.orgs', true, 100, 'Gate for /orgs persona page', 'wave-w5-seed')
) AS seed("key", "enabled", "rolloutPercent", "description", "updatedBy")
WHERE NOT EXISTS (SELECT 1 FROM "feature_flags" LIMIT 1);
