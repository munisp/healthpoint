CREATE TYPE "public"."emr_sync_status" AS ENUM('success', 'partial', 'failed', 'timeout');--> statement-breakpoint
CREATE TYPE "public"."emr_sync_trigger" AS ENUM('manual', 'dispute_pull', 'heartbeat', 'test');--> statement-breakpoint
CREATE TABLE "emr_sync_logs" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"connectionId" varchar(64) NOT NULL,
	"triggeredBy" varchar(64),
	"triggerType" "emr_sync_trigger" DEFAULT 'manual' NOT NULL,
	"status" "emr_sync_status" DEFAULT 'success' NOT NULL,
	"fieldsExtracted" integer DEFAULT 0,
	"fhirResourcesAccessed" jsonb,
	"patientId" varchar(128),
	"claimId" varchar(128),
	"disputeId" varchar(64),
	"durationMs" integer,
	"errorMessage" text,
	"warnings" jsonb,
	"fieldConfidence" jsonb,
	"summary" text,
	"createdAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "emr_sync_logs_conn_idx" ON "emr_sync_logs" USING btree ("connectionId");--> statement-breakpoint
CREATE INDEX "emr_sync_logs_created_idx" ON "emr_sync_logs" USING btree ("createdAt");