CREATE TYPE "public"."doc_analysis_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."webhook_status" AS ENUM('active', 'paused', 'failed');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"userId" varchar(64) NOT NULL,
	"action" varchar(128) NOT NULL,
	"entityType" varchar(64) NOT NULL,
	"entityId" varchar(64),
	"oldValue" text,
	"newValue" text,
	"ipAddress" varchar(64),
	"userAgent" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_analyses" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"disputeId" varchar(64),
	"userId" varchar(64) NOT NULL,
	"fileName" varchar(256) NOT NULL,
	"fileType" varchar(64) NOT NULL,
	"s3Key" varchar(512),
	"status" "doc_analysis_status" DEFAULT 'pending' NOT NULL,
	"ocrText" text,
	"extractedFields" jsonb,
	"confidence" integer DEFAULT 0,
	"processingTimeMs" integer,
	"errorMessage" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outcome_predictions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"disputeId" varchar(64) NOT NULL,
	"winProbability" integer NOT NULL,
	"confidenceScore" integer NOT NULL,
	"keyFactors" text NOT NULL,
	"recommendation" text NOT NULL,
	"modelVersion" varchar(32) DEFAULT 'v1' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"userId" varchar(64) NOT NULL,
	"name" varchar(128) NOT NULL,
	"url" text NOT NULL,
	"secret" varchar(128) NOT NULL,
	"events" text NOT NULL,
	"status" "webhook_status" DEFAULT 'active' NOT NULL,
	"lastTriggeredAt" timestamp,
	"failureCount" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_log_userId_idx" ON "audit_log" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "audit_log_entityType_entityId_idx" ON "audit_log" USING btree ("entityType","entityId");--> statement-breakpoint
CREATE INDEX "audit_log_createdAt_idx" ON "audit_log" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "doc_analyses_disputeId_idx" ON "document_analyses" USING btree ("disputeId");--> statement-breakpoint
CREATE INDEX "doc_analyses_userId_idx" ON "document_analyses" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "doc_analyses_status_idx" ON "document_analyses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "outcome_predictions_disputeId_idx" ON "outcome_predictions" USING btree ("disputeId");--> statement-breakpoint
CREATE INDEX "webhooks_userId_idx" ON "webhooks" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "webhooks_status_idx" ON "webhooks" USING btree ("status");