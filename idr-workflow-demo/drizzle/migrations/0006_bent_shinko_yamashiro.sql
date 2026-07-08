CREATE TYPE "public"."lead_status" AS ENUM('new', 'contacted', 'qualified', 'converted', 'disqualified');--> statement-breakpoint
CREATE TABLE "marketing_leads" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"firstName" varchar(128),
	"lastName" varchar(128),
	"email" varchar(320) NOT NULL,
	"orgName" varchar(255),
	"orgType" varchar(128),
	"stakeholderRole" varchar(64),
	"phone" varchar(32),
	"message" text,
	"source" varchar(128) DEFAULT 'landing_page',
	"utmSource" varchar(128),
	"utmMedium" varchar(128),
	"utmCampaign" varchar(128),
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"convertedUserId" varchar(64),
	"notes" text,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "marketing_leads_email_idx" ON "marketing_leads" USING btree ("email");--> statement-breakpoint
CREATE INDEX "marketing_leads_status_idx" ON "marketing_leads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "marketing_leads_role_idx" ON "marketing_leads" USING btree ("stakeholderRole");