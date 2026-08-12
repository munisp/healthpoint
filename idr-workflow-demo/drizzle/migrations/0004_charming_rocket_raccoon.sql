CREATE TABLE "dispute_templates" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"createdBy" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"serviceType" varchar(64),
	"initiatingPartyName" varchar(255),
	"initiatingPartyType" varchar(64),
	"respondingPartyName" varchar(255),
	"respondingPartyType" varchar(64),
	"billedAmount" varchar(32),
	"qpaAmount" varchar(32),
	"dateOfService" varchar(32),
	"patientName" varchar(255),
	"claimNumber" varchar(128),
	"cptCodes" jsonb,
	"icdCodes" jsonb,
	"notes" text,
	"usageCount" integer DEFAULT 0,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "dispute_templates_user_idx" ON "dispute_templates" USING btree ("createdBy");--> statement-breakpoint
CREATE INDEX "dispute_templates_created_idx" ON "dispute_templates" USING btree ("createdAt");