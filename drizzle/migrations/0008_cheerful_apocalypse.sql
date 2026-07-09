CREATE TYPE "public"."authz_permission" AS ENUM('read', 'write', 'admin');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('pending', 'delivered', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."ledger_account_type" AS ENUM('billed', 'allowed', 'paid', 'determination', 'adjustment', 'patient_responsibility');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_type" AS ENUM('debit', 'credit', 'adjustment', 'reversal');--> statement-breakpoint
CREATE TABLE "dispute_access" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"disputeId" varchar(64) NOT NULL,
	"userId" varchar(64) NOT NULL,
	"permission" "authz_permission" DEFAULT 'read' NOT NULL,
	"grantedBy" varchar(64) NOT NULL,
	"grantedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_log" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"topic" varchar(128) NOT NULL,
	"eventType" varchar(128) NOT NULL,
	"aggregateId" varchar(64) NOT NULL,
	"aggregateType" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"metadata" jsonb,
	"status" "event_status" DEFAULT 'pending' NOT NULL,
	"publishedAt" timestamp,
	"failureReason" text,
	"retryCount" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"disputeId" varchar(64) NOT NULL,
	"accountType" "ledger_account_type" NOT NULL,
	"balanceCents" integer DEFAULT 0 NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"disputeId" varchar(64) NOT NULL,
	"debitAccountId" varchar(64) NOT NULL,
	"creditAccountId" varchar(64) NOT NULL,
	"amountCents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"entryType" "ledger_entry_type" NOT NULL,
	"description" text NOT NULL,
	"referenceId" varchar(64),
	"referenceType" varchar(64),
	"metadata" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "dispute_access_disputeId_idx" ON "dispute_access" USING btree ("disputeId");--> statement-breakpoint
CREATE INDEX "dispute_access_userId_idx" ON "dispute_access" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "dispute_access_unique_idx" ON "dispute_access" USING btree ("disputeId","userId");--> statement-breakpoint
CREATE INDEX "event_log_topic_idx" ON "event_log" USING btree ("topic");--> statement-breakpoint
CREATE INDEX "event_log_aggregateId_idx" ON "event_log" USING btree ("aggregateId");--> statement-breakpoint
CREATE INDEX "event_log_status_idx" ON "event_log" USING btree ("status");--> statement-breakpoint
CREATE INDEX "event_log_createdAt_idx" ON "event_log" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "ledger_accounts_disputeId_idx" ON "ledger_accounts" USING btree ("disputeId");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_unique_idx" ON "ledger_accounts" USING btree ("disputeId","accountType");--> statement-breakpoint
CREATE INDEX "ledger_entries_disputeId_idx" ON "ledger_entries" USING btree ("disputeId");--> statement-breakpoint
CREATE INDEX "ledger_entries_debitAccountId_idx" ON "ledger_entries" USING btree ("debitAccountId");--> statement-breakpoint
CREATE INDEX "ledger_entries_creditAccountId_idx" ON "ledger_entries" USING btree ("creditAccountId");--> statement-breakpoint
CREATE INDEX "ledger_entries_createdAt_idx" ON "ledger_entries" USING btree ("createdAt");