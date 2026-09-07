-- Generic persisted FSM case tables (server/fsm-store): optimistic-locked
-- case entities addressed by (tenantId, caseType, caseId), append-only
-- hash-chained event log, idempotency records. Makes the notice-consent,
-- priorauth, and gfe-ppdr FSMs server-authoritative (clients can no longer
-- round-trip forged case state). See drizzle/schema-fsm-cases.ts for the
-- authoritative column comments. NOT YET APPLIED — requires migration runner
-- execution.

CREATE TABLE "fsm_cases" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"tenantId" varchar(128) NOT NULL,
	"caseType" varchar(64) NOT NULL,
	"caseId" varchar(128) NOT NULL,
	"state" varchar(64) NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"caseJson" jsonb NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"closedAt" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fsm_cases_tenant_type_case_idx" ON "fsm_cases" USING btree ("tenantId","caseType","caseId");--> statement-breakpoint
CREATE INDEX "fsm_cases_state_idx" ON "fsm_cases" USING btree ("state");--> statement-breakpoint

CREATE TABLE "fsm_case_events" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"caseRowId" varchar(64) NOT NULL,
	"tenantId" varchar(128) NOT NULL,
	"caseType" varchar(64) NOT NULL,
	"caseId" varchar(128) NOT NULL,
	"seq" integer NOT NULL,
	"eventType" varchar(64),
	"fromState" varchar(64),
	"toState" varchar(64),
	"at" timestamp NOT NULL,
	"detail" text,
	"eventJson" text NOT NULL,
	"prevEventHash" varchar(64) NOT NULL,
	"eventHash" varchar(64) NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fsm_events_case_seq_idx" ON "fsm_case_events" USING btree ("caseRowId","seq");--> statement-breakpoint
CREATE INDEX "fsm_events_tenant_type_case_idx" ON "fsm_case_events" USING btree ("tenantId","caseType","caseId");--> statement-breakpoint

CREATE TABLE "fsm_case_idempotency" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"tenantId" varchar(128) NOT NULL,
	"caseType" varchar(64) NOT NULL,
	"caseId" varchar(128) NOT NULL,
	"idempotencyKey" varchar(128) NOT NULL,
	"operation" varchar(32) NOT NULL,
	"resultJson" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fsm_idem_tenant_type_case_key_idx" ON "fsm_case_idempotency" USING btree ("tenantId","caseType","caseId","idempotencyKey");--> statement-breakpoint
