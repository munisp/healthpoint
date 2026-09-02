CREATE TYPE "public"."dapr_inbox_status" AS ENUM('received', 'processed', 'failed');

CREATE TABLE "dapr_event_inbox" (
  "id" varchar(128) PRIMARY KEY NOT NULL,
  "pubsubName" varchar(128) NOT NULL,
  "topic" varchar(128) NOT NULL,
  "eventType" varchar(128) NOT NULL,
  "subject" varchar(256),
  "payload" jsonb NOT NULL,
  "payloadSha256" varchar(64) NOT NULL,
  "status" "dapr_inbox_status" DEFAULT 'received' NOT NULL,
  "retryCount" integer DEFAULT 0 NOT NULL,
  "failureReason" varchar(512),
  "receivedAt" timestamp DEFAULT now() NOT NULL,
  "processedAt" timestamp,
  CONSTRAINT "dapr_inbox_topic_check" CHECK ("topic" IN ('idr.dispute.events', 'idr.payments', 'idr.audit')),
  CONSTRAINT "dapr_inbox_event_type_check" CHECK ("eventType" ~ '^[a-z][a-z0-9._-]{0,127}$'),
  CONSTRAINT "dapr_inbox_hash_check" CHECK ("payloadSha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "dapr_inbox_retry_count_check" CHECK ("retryCount" >= 0 AND "retryCount" <= 32),
  CONSTRAINT "dapr_inbox_processed_state_check" CHECK (
    ("status" = 'processed' AND "processedAt" IS NOT NULL)
    OR ("status" <> 'processed' AND "processedAt" IS NULL)
  )
);

CREATE UNIQUE INDEX "dapr_inbox_dedup_idx" ON "dapr_event_inbox" USING btree ("pubsubName", "topic", "id");
CREATE INDEX "dapr_inbox_status_received_idx" ON "dapr_event_inbox" USING btree ("status", "receivedAt");
CREATE INDEX "dapr_inbox_event_type_idx" ON "dapr_event_inbox" USING btree ("eventType");
