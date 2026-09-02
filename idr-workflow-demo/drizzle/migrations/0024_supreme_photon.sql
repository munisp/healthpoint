CREATE TYPE "public"."settlement_balance_proof_status" AS ENUM('passed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."settlement_exception_review_status" AS ENUM('open', 'resolved', 'accepted_risk');--> statement-breakpoint
CREATE TABLE "settlement_balance_proofs" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"proofDate" varchar(10) NOT NULL,
	"status" "settlement_balance_proof_status" NOT NULL,
	"transferCount" integer NOT NULL,
	"reconciledTransferCount" integer NOT NULL,
	"ledgerPaymentCents" integer NOT NULL,
	"ledgerReversalCents" integer NOT NULL,
	"unresolvedExceptionCount" integer NOT NULL,
	"ledgerMismatchCount" integer NOT NULL,
	"evidenceHash" varchar(64) NOT NULL,
	"summary" jsonb NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_exception_reviews" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"reconciliationId" varchar(64) NOT NULL,
	"status" "settlement_exception_review_status" DEFAULT 'open' NOT NULL,
	"reviewReason" text NOT NULL,
	"reviewedBy" varchar(64),
	"reviewedByName" varchar(255),
	"resolution" text,
	"reviewedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_balance_proofs_date_idx" ON "settlement_balance_proofs" USING btree ("proofDate");--> statement-breakpoint
CREATE INDEX "settlement_balance_proofs_status_idx" ON "settlement_balance_proofs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_exception_reviews_reconciliation_idx" ON "settlement_exception_reviews" USING btree ("reconciliationId");--> statement-breakpoint
CREATE INDEX "settlement_exception_reviews_status_idx" ON "settlement_exception_reviews" USING btree ("status");