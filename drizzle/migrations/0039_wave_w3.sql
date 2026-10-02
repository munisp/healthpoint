-- wave-w3 (ops reliability remediation)
-- Columns/tables added here are accessed via raw SQL in server code;
-- drizzle/schema.ts is owned by another wave and intentionally NOT edited.

-- W3-1: per-attempt webhook delivery latency.
ALTER TABLE "webhook_deliveries" ADD COLUMN IF NOT EXISTS "durationMs" integer;
--> statement-breakpoint

-- W3-2: notification retry outbox (statutory deadline alerts must not be
-- silently lost when email/SMS delivery fails).
CREATE TABLE IF NOT EXISTS "notification_attempts" (
  "id" varchar(64) PRIMARY KEY,
  "channel" varchar(16) NOT NULL,               -- email | sms
  "recipient" text NOT NULL,
  "subject" text,
  "body" text NOT NULL,
  "htmlBody" text,
  "notificationType" varchar(64) NOT NULL,
  "disputeRef" varchar(128),
  "status" varchar(16) DEFAULT 'pending' NOT NULL, -- pending | delivered | failed | unconfigured
  "attempts" integer DEFAULT 0 NOT NULL,
  "lastAttemptAt" timestamp,
  "nextAttemptAt" timestamp,
  "errorMessage" text,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_attempts_status_idx" ON "notification_attempts" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_attempts_nextAttemptAt_idx" ON "notification_attempts" ("nextAttemptAt");
--> statement-breakpoint

-- W3-7: staleness flag for outcome predictions. Set true by dispute lifecycle
-- events (dispute.advanced / offers / determination / payment) via
-- server/events/bus.ts; read by predictions.get.
ALTER TABLE "outcome_predictions" ADD COLUMN IF NOT EXISTS "isStale" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

-- W3-8: persisted search indexing-failure retry set, drained by
-- search.reindexAll (in addition to the in-memory set in server/search.ts).
CREATE TABLE IF NOT EXISTS "search_index_failures" (
  "id" varchar(64) PRIMARY KEY,
  "entityType" varchar(32) NOT NULL,
  "entityId" varchar(128) NOT NULL,
  "payload" text,                                -- JSON snapshot at failure time (may be stale)
  "errorMessage" text,
  "attempts" integer DEFAULT 0 NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "search_index_failures_entity_uq" UNIQUE ("entityType", "entityId")
);
