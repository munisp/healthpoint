CREATE TYPE "public"."changelog_category" AS ENUM('feature', 'improvement', 'bugfix', 'security', 'breaking', 'deprecation');--> statement-breakpoint
CREATE TYPE "public"."compliance_status" AS ENUM('compliant', 'non_compliant', 'not_applicable', 'pending_review');--> statement-breakpoint
CREATE TYPE "public"."expert_availability" AS ENUM('available', 'busy', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."expert_specialty" AS ENUM('emergency_medicine', 'anesthesiology', 'air_ambulance', 'radiology', 'pathology', 'hospitalist', 'intensivist', 'neonatology', 'ground_ambulance', 'general');--> statement-breakpoint
CREATE TYPE "public"."regulatory_category" AS ENUM('fee_schedule', 'court_ruling', 'guidance', 'regulation', 'certification', 'enforcement', 'legislation');--> statement-breakpoint
CREATE TYPE "public"."regulatory_impact" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."totp_status" AS ENUM('pending', 'active', 'disabled');--> statement-breakpoint
CREATE TABLE "changelog_entries" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"version" varchar(32) NOT NULL,
	"releasedAt" timestamp NOT NULL,
	"title" varchar(512) NOT NULL,
	"description" text NOT NULL,
	"category" "changelog_category" NOT NULL,
	"isHighlight" boolean DEFAULT false,
	"createdAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "compliance_checks" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"disputeId" varchar(64),
	"userId" varchar(64) NOT NULL,
	"sectionKey" varchar(128) NOT NULL,
	"itemKey" varchar(256) NOT NULL,
	"status" "compliance_status" DEFAULT 'pending_review' NOT NULL,
	"notes" text,
	"checkedAt" timestamp,
	"checkedBy" varchar(64),
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "expert_panel" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(256) NOT NULL,
	"credentials" varchar(128),
	"specialty" "expert_specialty" NOT NULL,
	"yearsExperience" integer DEFAULT 0,
	"casesHandled" integer DEFAULT 0,
	"successRate" varchar(8),
	"avgResponseHours" integer DEFAULT 24,
	"availability" "expert_availability" DEFAULT 'available' NOT NULL,
	"bio" text,
	"isActive" boolean DEFAULT true,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "org_settings" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"userId" varchar(64) NOT NULL,
	"orgName" varchar(256),
	"timezone" varchar(64) DEFAULT 'America/New_York',
	"dateFormat" varchar(32) DEFAULT 'MM/DD/YYYY',
	"defaultPageSize" integer DEFAULT 25,
	"emailDeadlineWarning" boolean DEFAULT true,
	"emailStepAdvanced" boolean DEFAULT true,
	"emailDetermination" boolean DEFAULT true,
	"inAppNotifications" boolean DEFAULT true,
	"deadlineWarningDays" integer DEFAULT 3,
	"sessionTimeoutMinutes" integer DEFAULT 30,
	"requireMFA" boolean DEFAULT false,
	"auditAllActions" boolean DEFAULT true,
	"ipAllowlist" text,
	"retentionDays" integer DEFAULT 2555,
	"autoExportEnabled" boolean DEFAULT false,
	"exportFormat" varchar(16) DEFAULT 'csv',
	"updatedAt" timestamp DEFAULT now(),
	CONSTRAINT "org_settings_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "qpa_benchmarks" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"cptCode" varchar(16) NOT NULL,
	"description" text NOT NULL,
	"specialty" varchar(64) NOT NULL,
	"p50National" integer NOT NULL,
	"p75National" integer NOT NULL,
	"p90National" integer NOT NULL,
	"effectiveYear" integer DEFAULT 2025,
	"source" varchar(128) DEFAULT 'CMS NSA Reference',
	"notes" text,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "qpa_state_modifiers" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"stateCode" varchar(2) NOT NULL,
	"modifier" varchar(8) NOT NULL,
	"effectiveYear" integer DEFAULT 2025,
	"createdAt" timestamp DEFAULT now(),
	CONSTRAINT "qpa_state_modifiers_stateCode_unique" UNIQUE("stateCode")
);
--> statement-breakpoint
CREATE TABLE "regulatory_updates" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"publishedAt" timestamp NOT NULL,
	"title" varchar(512) NOT NULL,
	"summary" text NOT NULL,
	"category" "regulatory_category" NOT NULL,
	"impactLevel" "regulatory_impact" NOT NULL,
	"source" varchar(128) NOT NULL,
	"sourceUrl" varchar(1024),
	"tags" text,
	"isActive" boolean DEFAULT true,
	"createdAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "totp_secrets" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"userId" varchar(64) NOT NULL,
	"secret" varchar(128) NOT NULL,
	"status" "totp_status" DEFAULT 'pending' NOT NULL,
	"backupCodes" text,
	"usedBackupCodes" text,
	"enabledAt" timestamp,
	"disabledAt" timestamp,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now(),
	CONSTRAINT "totp_secrets_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "passwordHash" text;--> statement-breakpoint
CREATE INDEX "changelog_version_idx" ON "changelog_entries" USING btree ("version");--> statement-breakpoint
CREATE INDEX "changelog_date_idx" ON "changelog_entries" USING btree ("releasedAt");--> statement-breakpoint
CREATE INDEX "compliance_dispute_idx" ON "compliance_checks" USING btree ("disputeId");--> statement-breakpoint
CREATE INDEX "compliance_user_idx" ON "compliance_checks" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "compliance_section_idx" ON "compliance_checks" USING btree ("sectionKey");--> statement-breakpoint
CREATE INDEX "expert_specialty_idx" ON "expert_panel" USING btree ("specialty");--> statement-breakpoint
CREATE INDEX "expert_availability_idx" ON "expert_panel" USING btree ("availability");--> statement-breakpoint
CREATE INDEX "org_settings_user_idx" ON "org_settings" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "qpa_cpt_idx" ON "qpa_benchmarks" USING btree ("cptCode");--> statement-breakpoint
CREATE INDEX "qpa_specialty_idx" ON "qpa_benchmarks" USING btree ("specialty");--> statement-breakpoint
CREATE INDEX "qpa_state_idx" ON "qpa_state_modifiers" USING btree ("stateCode");--> statement-breakpoint
CREATE INDEX "reg_update_date_idx" ON "regulatory_updates" USING btree ("publishedAt");--> statement-breakpoint
CREATE INDEX "reg_update_impact_idx" ON "regulatory_updates" USING btree ("impactLevel");--> statement-breakpoint
CREATE INDEX "reg_update_category_idx" ON "regulatory_updates" USING btree ("category");--> statement-breakpoint
CREATE INDEX "totp_user_idx" ON "totp_secrets" USING btree ("userId");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE("email");