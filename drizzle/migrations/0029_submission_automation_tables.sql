-- Submission-automation persistence tables: optimistic-locked submission
-- entities, append-only hash-chained event log, idempotency records.
-- See drizzle/schema-submission-automation.ts for the authoritative column
-- comments. NOT YET APPLIED — requires migration runner execution.

CREATE TABLE "submission_automation_submissions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"tenantId" varchar(128) NOT NULL,
	"disputeId" varchar(128) NOT NULL,
	"state" varchar(32) NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"cmsDisputeReferenceNumber" varchar(64),
	"attestation" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"closedAt" timestamp
);
--> statement-breakpoint
CREATE INDEX "sa_submissions_tenant_dispute_idx" ON "submission_automation_submissions" USING btree ("tenantId","disputeId");--> statement-breakpoint
CREATE INDEX "sa_submissions_state_idx" ON "submission_automation_submissions" USING btree ("state");--> statement-breakpoint
-- Unique ACTIVE submission per (tenantId, disputeId): withdrawn/closed rows do not block a new submission.
CREATE UNIQUE INDEX "sa_submissions_active_tenant_dispute_idx" ON "submission_automation_submissions" USING btree ("tenantId","disputeId") WHERE "state" NOT IN ('WITHDRAWN','CLOSED');--> statement-breakpoint

CREATE TABLE "submission_automation_events" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"submissionId" varchar(64) NOT NULL,
	"tenantId" varchar(128) NOT NULL,
	"disputeId" varchar(128) NOT NULL,
	"seq" integer NOT NULL,
	"fromState" varchar(32),
	"toState" varchar(32) NOT NULL,
	"at" timestamp NOT NULL,
	"actorId" varchar(128),
	"detail" text,
	"prevEventHash" varchar(64) NOT NULL,
	"eventHash" varchar(64) NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sa_events_submission_seq_idx" ON "submission_automation_events" USING btree ("submissionId","seq");--> statement-breakpoint
CREATE INDEX "sa_events_dispute_idx" ON "submission_automation_events" USING btree ("tenantId","disputeId");--> statement-breakpoint

CREATE TABLE "submission_automation_idempotency" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"tenantId" varchar(128) NOT NULL,
	"disputeId" varchar(128) NOT NULL,
	"idempotencyKey" varchar(128) NOT NULL,
	"operation" varchar(32) NOT NULL,
	"submissionId" varchar(64) NOT NULL,
	"resultJson" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sa_idem_tenant_dispute_key_idx" ON "submission_automation_idempotency" USING btree ("tenantId","disputeId","idempotencyKey");--> statement-breakpoint
