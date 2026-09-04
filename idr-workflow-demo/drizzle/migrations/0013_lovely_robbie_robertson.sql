CREATE TYPE "public"."appeal_status" AS ENUM('draft', 'submitted', 'under_review', 'upheld', 'denied', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."digest_frequency" AS ENUM('daily', 'weekly', 'never');--> statement-breakpoint
CREATE TYPE "public"."escalation_priority" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."escalation_status" AS ENUM('open', 'in_review', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."webhook_delivery_status" AS ENUM('pending', 'delivered', 'failed');--> statement-breakpoint
CREATE TABLE "dispute_appeals" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"disputeId" varchar(64) NOT NULL,
	"submittedBy" varchar(64) NOT NULL,
	"submittedByName" varchar(255) NOT NULL,
	"status" "appeal_status" DEFAULT 'draft' NOT NULL,
	"groundsForAppeal" text NOT NULL,
	"supportingEvidence" text,
	"originalDetermination" text,
	"appealDecision" text,
	"decidedAt" timestamp,
	"submittedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispute_escalations" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"disputeId" varchar(64) NOT NULL,
	"raisedBy" varchar(64) NOT NULL,
	"raisedByName" varchar(255) NOT NULL,
	"assignedTo" varchar(64),
	"priority" "escalation_priority" DEFAULT 'medium' NOT NULL,
	"status" "escalation_status" DEFAULT 'open' NOT NULL,
	"reason" text NOT NULL,
	"resolution" text,
	"resolvedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispute_narratives" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"disputeId" varchar(64) NOT NULL,
	"generatedBy" varchar(64) NOT NULL,
	"narrativeType" varchar(64) DEFAULT 'opening_statement' NOT NULL,
	"content" text NOT NULL,
	"wordCount" integer DEFAULT 0 NOT NULL,
	"approved" boolean DEFAULT false NOT NULL,
	"approvedBy" varchar(64),
	"approvedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispute_watchlist" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"userId" varchar(64) NOT NULL,
	"disputeId" varchar(64) NOT NULL,
	"note" text,
	"alertOnStatusChange" boolean DEFAULT true NOT NULL,
	"alertOnDeadline" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_expiry_alerts" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"disputeId" varchar(64) NOT NULL,
	"documentId" varchar(64) NOT NULL,
	"documentName" varchar(255) NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"alertSentAt" timestamp,
	"dismissed" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_digest_preferences" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"userId" varchar(64) NOT NULL,
	"digestFrequency" "digest_frequency" DEFAULT 'daily' NOT NULL,
	"notifyOnNewDispute" boolean DEFAULT true NOT NULL,
	"notifyOnStatusChange" boolean DEFAULT true NOT NULL,
	"notifyOnDeadlineApproach" boolean DEFAULT true NOT NULL,
	"notifyOnDetermination" boolean DEFAULT true NOT NULL,
	"notifyOnSLABreach" boolean DEFAULT true NOT NULL,
	"digestTime" varchar(5) DEFAULT '08:00' NOT NULL,
	"digestDayOfWeek" integer DEFAULT 1 NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_digest_preferences_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"webhookId" varchar(64) NOT NULL,
	"eventType" varchar(64) NOT NULL,
	"payload" text NOT NULL,
	"status" "webhook_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lastAttemptAt" timestamp,
	"nextRetryAt" timestamp,
	"responseStatus" integer,
	"responseBody" text,
	"errorMessage" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "appeals_disputeId_idx" ON "dispute_appeals" USING btree ("disputeId");--> statement-breakpoint
CREATE INDEX "appeals_status_idx" ON "dispute_appeals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "escalations_disputeId_idx" ON "dispute_escalations" USING btree ("disputeId");--> statement-breakpoint
CREATE INDEX "escalations_status_idx" ON "dispute_escalations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "narratives_disputeId_idx" ON "dispute_narratives" USING btree ("disputeId");--> statement-breakpoint
CREATE INDEX "watchlist_userId_idx" ON "dispute_watchlist" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "watchlist_disputeId_idx" ON "dispute_watchlist" USING btree ("disputeId");--> statement-breakpoint
CREATE INDEX "doc_expiry_disputeId_idx" ON "document_expiry_alerts" USING btree ("disputeId");--> statement-breakpoint
CREATE INDEX "doc_expiry_expiresAt_idx" ON "document_expiry_alerts" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX "email_digest_prefs_userId_idx" ON "email_digest_preferences" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_webhookId_idx" ON "webhook_deliveries" USING btree ("webhookId");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_status_idx" ON "webhook_deliveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_createdAt_idx" ON "webhook_deliveries" USING btree ("createdAt");