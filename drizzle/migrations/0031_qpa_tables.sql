-- QPA-engine persistence tables (server/idr/qpa): validated contracted-rate
-- rows, content-addressed idempotent ingestion batches, and effective-dated
-- cumulative CPI-U factors (45 CFR 149.140(c)(1)) from the 2019 baseline.
-- See drizzle/schema-qpa.ts for the authoritative column comments.
-- NOT YET APPLIED — requires migration runner execution.

CREATE TABLE "qpa_contracted_rates" (
	"id" varchar(80) PRIMARY KEY NOT NULL,
	"batchId" varchar(64) NOT NULL,
	"payerId" varchar(128) NOT NULL,
	"serviceCode" varchar(16) NOT NULL,
	"market" varchar(32) NOT NULL,
	"region" varchar(128) NOT NULL,
	"contractedRateCents" integer NOT NULL,
	"arrangementType" varchar(32) NOT NULL,
	"effectiveDate" varchar(10) NOT NULL,
	"underlyingFeeScheduleCents" integer,
	"derivedAmountCents" integer,
	"claimsSharePercent" numeric(5,2),
	"rowHash" varchar(64) NOT NULL,
	"provenance" jsonb NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "qpa_rates_dimension_idx" ON "qpa_contracted_rates" USING btree ("serviceCode","market","region","effectiveDate");--> statement-breakpoint
CREATE INDEX "qpa_rates_batch_idx" ON "qpa_contracted_rates" USING btree ("batchId");--> statement-breakpoint
CREATE UNIQUE INDEX "qpa_rates_rowhash_idx" ON "qpa_contracted_rates" USING btree ("rowHash");--> statement-breakpoint

CREATE TABLE "qpa_ingestion_batches" (
	"batchId" varchar(64) PRIMARY KEY NOT NULL,
	"contentHash" varchar(64) NOT NULL,
	"sourceType" varchar(16) NOT NULL,
	"sourceRef" text NOT NULL,
	"importedAt" varchar(10) NOT NULL,
	"totalRows" integer NOT NULL,
	"acceptedRows" integer NOT NULL,
	"rejectedRows" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "qpa_batches_content_hash_idx" ON "qpa_ingestion_batches" USING btree ("contentHash");--> statement-breakpoint

CREATE TABLE "qpa_cpi_factors" (
	"year" integer PRIMARY KEY NOT NULL,
	"factor" numeric(20,10) NOT NULL,
	"publicationRef" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
