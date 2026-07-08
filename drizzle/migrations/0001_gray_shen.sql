CREATE TYPE "public"."cms_draft_status" AS ENUM('draft', 'submitted', 'determined', 'withdrawn');--> statement-breakpoint
CREATE TABLE "cms_drafts" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"disputeId" varchar(64) NOT NULL,
	"createdBy" varchar(64) NOT NULL,
	"status" "cms_draft_status" DEFAULT 'draft' NOT NULL,
	"isEligible" boolean NOT NULL,
	"eligibilityReason" text NOT NULL,
	"missingRequirements" jsonb NOT NULL,
	"warnings" jsonb NOT NULL,
	"estimatedDeadline" varchar(64),
	"regulatoryBasis" jsonb,
	"formFields" jsonb NOT NULL,
	"attachmentChecklist" jsonb NOT NULL,
	"submissionNarrative" text NOT NULL,
	"draftRegulatoryBasis" jsonb,
	"estimatedOutcome" text NOT NULL,
	"nextSteps" jsonb NOT NULL,
	"additionalContext" text,
	"processingTimeSeconds" numeric(6, 2),
	"agentTrace" jsonb,
	"submittedAt" timestamp,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "cms_drafts_dispute_idx" ON "cms_drafts" USING btree ("disputeId");--> statement-breakpoint
CREATE INDEX "cms_drafts_user_idx" ON "cms_drafts" USING btree ("createdBy");--> statement-breakpoint
CREATE INDEX "cms_drafts_status_idx" ON "cms_drafts" USING btree ("status");