-- 0035_personas: missing-stakeholder-persona tables (v1)
-- payer accounts/case links, patient access tokens, IDRE assignments,
-- organizations + memberships. Hand-written to match drizzle/schema-personas.ts.

CREATE TABLE IF NOT EXISTS "payer_accounts" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"payerName" varchar(255) NOT NULL,
	"contactEmail" varchar(320) NOT NULL,
	"orgRef" varchar(64),
	"apiKeyHash" varchar(128),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payer_accounts_email_idx" ON "payer_accounts" USING btree ("contactEmail");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payer_accounts_name_idx" ON "payer_accounts" USING btree ("payerName");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "payer_case_links" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"payerAccountId" varchar(64) NOT NULL,
	"disputeId" varchar(64) NOT NULL,
	"role" varchar(32) DEFAULT 'responding_party' NOT NULL,
	"invitedByUserId" varchar(64) NOT NULL,
	"status" varchar(32) DEFAULT 'invited' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payer_case_links_account_dispute_idx" ON "payer_case_links" USING btree ("payerAccountId","disputeId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payer_case_links_dispute_idx" ON "payer_case_links" USING btree ("disputeId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payer_case_links_account_idx" ON "payer_case_links" USING btree ("payerAccountId");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "patient_access_tokens" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"tokenHash" varchar(128) NOT NULL,
	"disputeId" varchar(64),
	"patientName" varchar(255) NOT NULL,
	"email" varchar(320),
	"phone" varchar(32),
	"scope" varchar(32) DEFAULT 'view' NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"createdByUserId" varchar(64) NOT NULL,
	"usedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "patient_access_tokens_hash_idx" ON "patient_access_tokens" USING btree ("tokenHash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "patient_access_tokens_dispute_idx" ON "patient_access_tokens" USING btree ("disputeId");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "idre_assignments" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"disputeId" varchar(64) NOT NULL,
	"idrEntityId" varchar(64) NOT NULL,
	"arbitratorUserId" varchar(64),
	"status" varchar(32) DEFAULT 'proposed' NOT NULL,
	"coiAttestation" jsonb,
	"assignedAt" timestamp DEFAULT now() NOT NULL,
	"decidedAt" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idre_assignments_dispute_idx" ON "idre_assignments" USING btree ("disputeId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idre_assignments_entity_idx" ON "idre_assignments" USING btree ("idrEntityId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idre_assignments_arbitrator_idx" ON "idre_assignments" USING btree ("arbitratorUserId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idre_assignments_status_idx" ON "idre_assignments" USING btree ("status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "organizations" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" varchar(32) NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organizations_type_idx" ON "organizations" USING btree ("type");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "org_memberships" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"orgId" varchar(64) NOT NULL,
	"userId" varchar(64) NOT NULL,
	"role" varchar(32) DEFAULT 'staff' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_memberships_org_user_idx" ON "org_memberships" USING btree ("orgId","userId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_memberships_user_idx" ON "org_memberships" USING btree ("userId");
