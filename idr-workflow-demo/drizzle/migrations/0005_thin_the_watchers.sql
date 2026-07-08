CREATE TYPE "public"."stakeholder_role" AS ENUM('provider', 'facility', 'payer', 'idr_entity', 'other');--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"orgName" varchar(255),
	"orgType" varchar(128),
	"stakeholderRole" "stakeholder_role" DEFAULT 'provider',
	"npi" varchar(32),
	"taxId" varchar(32),
	"phone" varchar(32),
	"preferredContact" varchar(64),
	"onboardingCompleted" boolean DEFAULT false,
	"onboardingCompletedAt" timestamp,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "user_profiles_role_idx" ON "user_profiles" USING btree ("stakeholderRole");