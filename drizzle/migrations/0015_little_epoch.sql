CREATE TYPE "public"."smart_form_target" AS ENUM('dispute', 'offer', 'cms_submission', 'emr_onboarding', 'mobile_dispute', 'generic');--> statement-breakpoint
CREATE TABLE "smart_form_extractions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"userId" varchar(64) NOT NULL,
	"targetForm" "smart_form_target" DEFAULT 'generic' NOT NULL,
	"disputeId" varchar(64),
	"inputType" varchar(32) DEFAULT 'text' NOT NULL,
	"inputPreview" text,
	"documentName" varchar(256),
	"extractedFields" jsonb DEFAULT '{}'::jsonb,
	"overallConfidence" integer DEFAULT 0,
	"fieldCount" integer DEFAULT 0,
	"highConfidenceCount" integer DEFAULT 0,
	"lowConfidenceCount" integer DEFAULT 0,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"errorMessage" text,
	"processingMs" integer,
	"modelUsed" varchar(128),
	"appliedAt" timestamp,
	"appliedFields" jsonb DEFAULT '[]'::jsonb,
	"createdAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "smart_form_user_idx" ON "smart_form_extractions" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "smart_form_dispute_idx" ON "smart_form_extractions" USING btree ("disputeId");