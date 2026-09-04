CREATE TYPE "public"."settlement_approval_decision" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."settlement_reconciliation_status" AS ENUM('matched', 'mismatched', 'exception');--> statement-breakpoint
CREATE TYPE "public"."settlement_transfer_status" AS ENUM('requested', 'authorized', 'submitted', 'accepted', 'settled', 'failed', 'reversed', 'reconciled');--> statement-breakpoint
CREATE TABLE "settlement_approvals" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"transferId" varchar(64) NOT NULL,
	"decision" "settlement_approval_decision" NOT NULL,
	"decidedBy" varchar(64) NOT NULL,
	"decidedByName" varchar(255) NOT NULL,
	"decisionReason" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"decidedAt" timestamp DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_provider_reports" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"provider" varchar(64) NOT NULL,
	"providerReportId" varchar(128) NOT NULL,
	"transferId" varchar(64) NOT NULL,
	"providerTransferId" varchar(128) NOT NULL,
	"reportedStatus" "settlement_transfer_status" NOT NULL,
	"amountCents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"reportedAt" timestamp NOT NULL,
	"rawPayload" jsonb NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_reconciliations" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"transferId" varchar(64) NOT NULL,
	"providerReportId" varchar(64) NOT NULL,
	"status" "settlement_reconciliation_status" NOT NULL,
	"expectedAmountCents" integer NOT NULL,
	"reportedAmountCents" integer NOT NULL,
	"expectedStatus" "settlement_transfer_status" NOT NULL,
	"reportedStatus" "settlement_transfer_status" NOT NULL,
	"exceptionReason" text,
	"reconciledBy" varchar(64) NOT NULL,
	"reconciledAt" timestamp DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_transfers" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"disputeId" varchar(64) NOT NULL,
	"provider" varchar(64) NOT NULL,
	"providerTransferId" varchar(128),
	"amountCents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"status" "settlement_transfer_status" DEFAULT 'requested' NOT NULL,
	"requestedBy" varchar(64) NOT NULL,
	"requestedByName" varchar(255) NOT NULL,
	"requestReason" text NOT NULL,
	"idempotencyKey" varchar(128) NOT NULL,
	"authorizedAt" timestamp,
	"submittedAt" timestamp,
	"acceptedAt" timestamp,
	"settledAt" timestamp,
	"failedAt" timestamp,
	"reversedAt" timestamp,
	"reconciledAt" timestamp,
	"failureCode" varchar(64),
	"failureReason" text,
	"metadata" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_approvals_transfer_idx" ON "settlement_approvals" USING btree ("transferId");--> statement-breakpoint
CREATE INDEX "settlement_approvals_decider_idx" ON "settlement_approvals" USING btree ("decidedBy");--> statement-breakpoint
CREATE INDEX "settlement_approvals_expiry_idx" ON "settlement_approvals" USING btree ("expiresAt");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_provider_reports_event_idx" ON "settlement_provider_reports" USING btree ("provider","providerReportId");--> statement-breakpoint
CREATE INDEX "settlement_provider_reports_transfer_idx" ON "settlement_provider_reports" USING btree ("transferId");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_reconciliations_report_idx" ON "settlement_reconciliations" USING btree ("providerReportId");--> statement-breakpoint
CREATE INDEX "settlement_reconciliations_transfer_idx" ON "settlement_reconciliations" USING btree ("transferId");--> statement-breakpoint
CREATE INDEX "settlement_reconciliations_status_idx" ON "settlement_reconciliations" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_transfers_idempotency_idx" ON "settlement_transfers" USING btree ("idempotencyKey");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_transfers_provider_transfer_idx" ON "settlement_transfers" USING btree ("provider","providerTransferId");--> statement-breakpoint
CREATE INDEX "settlement_transfers_dispute_idx" ON "settlement_transfers" USING btree ("disputeId");--> statement-breakpoint
CREATE INDEX "settlement_transfers_status_idx" ON "settlement_transfers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "settlement_transfers_provider_idx" ON "settlement_transfers" USING btree ("provider");