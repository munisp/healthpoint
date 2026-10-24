-- wave-w7 (P1/P2 UX cluster remediation)
-- Columns/tables added here are accessed via raw SQL in server code;
-- drizzle/schema.ts is owned by another wave and intentionally NOT edited.

-- W7-4 (white-label): org-scoped branding on the organizations table
-- (drizzle/schema-personas.ts, created in wave W5). brandName/logoUrl/
-- primaryColor are applied to the app header + login page and are editable
-- by org owners from /orgs. NULL = platform default branding.
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "brandName" varchar(255);
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "logoUrl" text;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "primaryColor" varchar(16);

-- W7-5 (notification unsubscribe): per-preference one-click unsubscribe
-- token for digest emails. Generated lazily (crypto random) the first time
-- a digest is sent or a link is requested; never printed in logs.
ALTER TABLE "email_digest_preferences" ADD COLUMN IF NOT EXISTS "unsubscribeToken" varchar(128);
CREATE UNIQUE INDEX IF NOT EXISTS "email_digest_preferences_unsub_token_idx"
  ON "email_digest_preferences" ("unsubscribeToken");

-- W7-1 (mobile parity): Expo push tokens for the React-Native app. The
-- existing push_subscriptions table is web-push only (VAPID p256dh/auth
-- keys are mandatory there); Expo push tokens have no such keys, so they
-- live in their own table. Registered via
-- pushSubscriptions.registerExpoToken; the server push dispatcher can
-- fan out to https://exp.host/--/api/v2/push/send per token.
CREATE TABLE IF NOT EXISTS "expo_push_tokens" (
  "id" varchar(64) PRIMARY KEY,
  "userId" varchar(64) NOT NULL,
  "token" text NOT NULL,
  "platform" varchar(16),
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "expo_push_tokens_user_token_idx"
  ON "expo_push_tokens" ("userId", "token");
CREATE INDEX IF NOT EXISTS "expo_push_tokens_user_idx"
  ON "expo_push_tokens" ("userId");
