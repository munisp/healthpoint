-- NSA / Federal IDR compliance tables: statutory deadline ledger,
-- effective-dated fee schedules, idempotent fee assessments, attestations.
-- See drizzle/schema-idr-compliance.ts for the authoritative column comments.
-- All money amounts are integer cents; fee VALUES come from configuration,
-- never from code (45 CFR § 149.510(d) amounts change via rulemaking).

CREATE TABLE "idr_deadline_events" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"disputeId" varchar(64) NOT NULL,
	"deadlineType" varchar(48) NOT NULL,
	"basisDate" timestamp,
	"computedDeadline" timestamp NOT NULL,
	"dayCount" integer NOT NULL,
	"dayKind" varchar(16) DEFAULT 'business' NOT NULL,
	"cfrReference" varchar(96) NOT NULL,
	"status" varchar(24) DEFAULT 'open' NOT NULL,
	"metAt" timestamp,
	"tMinus5SentAt" timestamp,
	"tMinus1SentAt" timestamp,
	"overdueSentAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idr_deadline_events_dispute_type_idx" ON "idr_deadline_events" USING btree ("disputeId","deadlineType");--> statement-breakpoint
CREATE INDEX "idr_deadline_events_deadline_idx" ON "idr_deadline_events" USING btree ("computedDeadline");--> statement-breakpoint
CREATE INDEX "idr_deadline_events_status_idx" ON "idr_deadline_events" USING btree ("status");--> statement-breakpoint

CREATE TABLE "idr_fee_schedules" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"effectiveFrom" timestamp NOT NULL,
	"effectiveTo" timestamp,
	"adminFeeCents" integer NOT NULL,
	"idreFeeSingleMinCents" integer,
	"idreFeeSingleMaxCents" integer,
	"idreFeeBatchedMinCents" integer,
	"idreFeeBatchedMaxCents" integer,
	"batchingMaxLineItems" integer,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"source" varchar(255),
	"notes" text,
	"createdBy" varchar(64) NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idr_fee_schedules_effective_idx" ON "idr_fee_schedules" USING btree ("effectiveFrom");--> statement-breakpoint

CREATE TABLE "idr_fee_assessments" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"disputeId" varchar(64) NOT NULL,
	"feeScheduleId" varchar(64) NOT NULL,
	"feeType" varchar(24) NOT NULL,
	"partyRole" varchar(24) NOT NULL,
	"partyId" varchar(64),
	"amountCents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"status" varchar(16) DEFAULT 'assessed' NOT NULL,
	"assessedAt" timestamp DEFAULT now() NOT NULL,
	"assessedBy" varchar(64) NOT NULL,
	"invoicedAt" timestamp,
	"paidAt" timestamp,
	"paymentReference" varchar(128),
	"statusReason" text,
	"idempotencyKey" varchar(191) NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idr_fee_assessments_idem_idx" ON "idr_fee_assessments" USING btree ("idempotencyKey");--> statement-breakpoint
CREATE UNIQUE INDEX "idr_fee_assessments_dispute_type_party_idx" ON "idr_fee_assessments" USING btree ("disputeId","feeType","partyRole");--> statement-breakpoint
CREATE INDEX "idr_fee_assessments_dispute_idx" ON "idr_fee_assessments" USING btree ("disputeId");--> statement-breakpoint
CREATE INDEX "idr_fee_assessments_status_idx" ON "idr_fee_assessments" USING btree ("status");--> statement-breakpoint

CREATE TABLE "idr_attestations" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"disputeId" varchar(64) NOT NULL,
	"attestationType" varchar(32) NOT NULL,
	"partyRole" varchar(24) NOT NULL,
	"attestedBy" varchar(64) NOT NULL,
	"attestedByName" varchar(255) NOT NULL,
	"attestationText" text NOT NULL,
	"informationComplete" boolean NOT NULL,
	"informationAccurate" boolean NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"supersededBy" varchar(64),
	"ipAddress" varchar(64),
	"userAgent" text,
	"attestedAt" timestamp DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idr_attestations_dispute_idx" ON "idr_attestations" USING btree ("disputeId");--> statement-breakpoint
CREATE INDEX "idr_attestations_type_idx" ON "idr_attestations" USING btree ("disputeId","attestationType");--> statement-breakpoint
CREATE INDEX "idr_attestations_status_idx" ON "idr_attestations" USING btree ("status");