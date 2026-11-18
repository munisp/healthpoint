CREATE TABLE "api_keys" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"userId" varchar(64) NOT NULL,
	"name" text NOT NULL,
	"keyHash" varchar(128) NOT NULL,
	"keyPrefix" varchar(8) NOT NULL,
	"scopes" text DEFAULT 'read' NOT NULL,
	"lastUsedAt" timestamp,
	"expiresAt" timestamp,
	"revokedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispute_comments" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"disputeId" varchar(64) NOT NULL,
	"authorId" varchar(64) NOT NULL,
	"authorName" text,
	"content" text NOT NULL,
	"parentId" varchar(64),
	"edited" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payer_contacts" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"payerName" text NOT NULL,
	"payerId" varchar(64),
	"contactName" text,
	"contactTitle" text,
	"email" varchar(320),
	"phone" varchar(32),
	"fax" varchar(32),
	"address" text,
	"idrPortalUrl" text,
	"notes" text,
	"createdBy" varchar(64),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sla_breaches" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"disputeId" varchar(64) NOT NULL,
	"step" text NOT NULL,
	"deadlineDays" integer NOT NULL,
	"actualDays" integer NOT NULL,
	"breachDays" integer NOT NULL,
	"detectedAt" timestamp DEFAULT now() NOT NULL,
	"resolvedAt" timestamp,
	"severity" text DEFAULT 'warning' NOT NULL
);
--> statement-breakpoint
CREATE INDEX "api_keys_userId_idx" ON "api_keys" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "api_keys_keyHash_idx" ON "api_keys" USING btree ("keyHash");--> statement-breakpoint
CREATE INDEX "dispute_comments_disputeId_idx" ON "dispute_comments" USING btree ("disputeId");--> statement-breakpoint
CREATE INDEX "dispute_comments_parentId_idx" ON "dispute_comments" USING btree ("parentId");--> statement-breakpoint
CREATE INDEX "payer_contacts_payerName_idx" ON "payer_contacts" USING btree ("payerName");--> statement-breakpoint
CREATE INDEX "sla_breaches_disputeId_idx" ON "sla_breaches" USING btree ("disputeId");--> statement-breakpoint
CREATE INDEX "sla_breaches_detectedAt_idx" ON "sla_breaches" USING btree ("detectedAt");