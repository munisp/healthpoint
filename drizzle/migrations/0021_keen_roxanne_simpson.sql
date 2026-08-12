CREATE TYPE "public"."settlement_callback_status" AS ENUM('settled', 'failed', 'rejected');--> statement-breakpoint
CREATE TABLE "settlement_callbacks" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"provider" varchar(64) NOT NULL,
	"providerEventId" varchar(128) NOT NULL,
	"providerTransferId" varchar(128) NOT NULL,
	"disputeId" varchar(64) NOT NULL,
	"amountCents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"status" "settlement_callback_status" NOT NULL,
	"occurredAt" timestamp NOT NULL,
	"signatureVersion" varchar(16) DEFAULT 'v1' NOT NULL,
	"rawPayload" jsonb NOT NULL,
	"ledgerEntryId" varchar(64),
	"reconciliationNote" text,
	"reconciledAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_log" ADD COLUMN "idempotencyKey" varchar(191);--> statement-breakpoint
ALTER TABLE "event_log" ADD COLUMN "lastAttemptAt" timestamp;--> statement-breakpoint
ALTER TABLE "event_log" ADD COLUMN "nextAttemptAt" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_callbacks_provider_event_idx" ON "settlement_callbacks" USING btree ("provider","providerEventId");--> statement-breakpoint
CREATE INDEX "settlement_callbacks_dispute_idx" ON "settlement_callbacks" USING btree ("disputeId");--> statement-breakpoint
CREATE INDEX "settlement_callbacks_transfer_idx" ON "settlement_callbacks" USING btree ("providerTransferId");--> statement-breakpoint
CREATE INDEX "settlement_callbacks_status_idx" ON "settlement_callbacks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "event_log_retry_idx" ON "event_log" USING btree ("status","nextAttemptAt");--> statement-breakpoint
CREATE UNIQUE INDEX "event_log_idempotency_idx" ON "event_log" USING btree ("idempotencyKey");