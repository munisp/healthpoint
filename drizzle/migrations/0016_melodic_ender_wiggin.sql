CREATE TYPE "public"."hermes_job_status" AS ENUM('queued', 'running', 'complete', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."hermes_job_type" AS ENUM('narrative_generation', 'outcome_simulation', 'fhir_enrichment', 'risk_scoring', 'payer_intelligence', 'regulatory_feed', 'arbitrator_scoring', 'chat');--> statement-breakpoint
CREATE TABLE "hermes_chat_messages" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"sessionId" varchar(64) NOT NULL,
	"userId" varchar(64) NOT NULL,
	"disputeId" varchar(64),
	"role" varchar(16) NOT NULL,
	"content" text NOT NULL,
	"jobId" varchar(64),
	"createdAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "hermes_insights" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"disputeId" varchar(64) NOT NULL,
	"jobId" varchar(64),
	"insightType" "hermes_job_type" NOT NULL,
	"riskScore" integer,
	"riskLevel" varchar(16),
	"riskFactors" jsonb,
	"narrative" text,
	"narrativeVersion" integer DEFAULT 1,
	"providerWinPct" integer,
	"payerWinPct" integer,
	"splitPct" integer,
	"withdrawnPct" integer,
	"simulationBasis" text,
	"payerBehaviorSummary" text,
	"payerAcceptanceRate" integer,
	"payerAvgRoundToAccept" numeric(4, 1),
	"arbitratorId" varchar(64),
	"arbitratorWinRate" integer,
	"arbitratorAvgAward" numeric(12, 2),
	"arbitratorNotes" text,
	"enrichedFields" jsonb,
	"generatedAt" timestamp DEFAULT now(),
	"expiresAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "hermes_jobs" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"userId" varchar(64) NOT NULL,
	"disputeId" varchar(64),
	"jobType" "hermes_job_type" NOT NULL,
	"status" "hermes_job_status" DEFAULT 'queued' NOT NULL,
	"inputPayload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"outputText" text,
	"outputJson" jsonb,
	"modelUsed" varchar(128),
	"promptTokens" integer,
	"completionTokens" integer,
	"latencyMs" integer,
	"errorMessage" text,
	"startedAt" timestamp,
	"completedAt" timestamp,
	"createdAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "hermes_regulatory_entries" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"title" varchar(512) NOT NULL,
	"summary" text NOT NULL,
	"source" varchar(255) NOT NULL,
	"sourceUrl" varchar(1024),
	"impactLevel" varchar(16) DEFAULT 'medium' NOT NULL,
	"affectedSteps" jsonb DEFAULT '[]'::jsonb,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"effectiveDate" timestamp,
	"isRead" boolean DEFAULT false,
	"createdAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "hermes_chat_session_idx" ON "hermes_chat_messages" USING btree ("sessionId");--> statement-breakpoint
CREATE INDEX "hermes_chat_user_idx" ON "hermes_chat_messages" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "hermes_insights_dispute_idx" ON "hermes_insights" USING btree ("disputeId");--> statement-breakpoint
CREATE INDEX "hermes_insights_type_idx" ON "hermes_insights" USING btree ("insightType");--> statement-breakpoint
CREATE INDEX "hermes_jobs_user_idx" ON "hermes_jobs" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "hermes_jobs_dispute_idx" ON "hermes_jobs" USING btree ("disputeId");--> statement-breakpoint
CREATE INDEX "hermes_jobs_type_idx" ON "hermes_jobs" USING btree ("jobType");--> statement-breakpoint
CREATE INDEX "hermes_jobs_status_idx" ON "hermes_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "hermes_reg_impact_idx" ON "hermes_regulatory_entries" USING btree ("impactLevel");--> statement-breakpoint
CREATE INDEX "hermes_reg_read_idx" ON "hermes_regulatory_entries" USING btree ("isRead");