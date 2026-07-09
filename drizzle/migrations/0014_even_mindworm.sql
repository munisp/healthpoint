CREATE TYPE "public"."bulk_fhir_status" AS ENUM('pending', 'in_progress', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."cds_hook_status" AS ENUM('active', 'inactive', 'error');--> statement-breakpoint
CREATE TYPE "public"."davinci_tx_status" AS ENUM('pending', 'approved', 'denied', 'pended', 'error');--> statement-breakpoint
CREATE TYPE "public"."davinci_tx_type" AS ENUM('pdex_payer_network', 'pas_prior_auth', 'crd_coverage_req', 'dtr_doc_templates', 'hrex_member_match');--> statement-breakpoint
CREATE TABLE "bulk_fhir_export_jobs" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"emrConnectionId" varchar(64) NOT NULL,
	"initiatedBy" varchar(64) NOT NULL,
	"exportType" varchar(32) DEFAULT 'Patient' NOT NULL,
	"resourceTypes" jsonb DEFAULT '[]'::jsonb,
	"since" timestamp,
	"statusUrl" text,
	"status" "bulk_fhir_status" DEFAULT 'pending' NOT NULL,
	"progress" integer DEFAULT 0,
	"outputFiles" jsonb DEFAULT '[]'::jsonb,
	"errorFiles" jsonb DEFAULT '[]'::jsonb,
	"totalRecords" integer DEFAULT 0,
	"disputesCreated" integer DEFAULT 0,
	"errorMessage" text,
	"startedAt" timestamp,
	"completedAt" timestamp,
	"createdAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cds_hooks" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"emrConnectionId" varchar(64) NOT NULL,
	"hookId" varchar(128) NOT NULL,
	"title" varchar(256) NOT NULL,
	"description" text,
	"prefetch" jsonb DEFAULT '{}'::jsonb,
	"status" "cds_hook_status" DEFAULT 'active' NOT NULL,
	"invocationCount" integer DEFAULT 0,
	"lastInvokedAt" timestamp,
	"createdAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "davinci_transactions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"disputeId" varchar(64),
	"emrConnectionId" varchar(64),
	"txType" "davinci_tx_type" NOT NULL,
	"status" "davinci_tx_status" DEFAULT 'pending' NOT NULL,
	"requestPayload" jsonb,
	"responsePayload" jsonb,
	"priorAuthNumber" varchar(64),
	"coverageDecision" varchar(32),
	"errorCode" varchar(32),
	"errorMessage" text,
	"processingTimeMs" integer,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "fhir_capability_statements" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"emrConnectionId" varchar(64) NOT NULL,
	"fhirVersion" varchar(8) DEFAULT 'R4' NOT NULL,
	"softwareName" varchar(128),
	"softwareVersion" varchar(64),
	"supportedResources" jsonb DEFAULT '[]'::jsonb,
	"supportedSearchParams" jsonb DEFAULT '{}'::jsonb,
	"smartScopes" jsonb DEFAULT '[]'::jsonb,
	"bulkExportSupported" boolean DEFAULT false,
	"cdsHooksSupported" boolean DEFAULT false,
	"rawStatement" jsonb,
	"fetchedAt" timestamp DEFAULT now(),
	"createdAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "fhir_resource_cache" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"emrConnectionId" varchar(64) NOT NULL,
	"resourceType" varchar(64) NOT NULL,
	"resourceId" varchar(128) NOT NULL,
	"fhirVersion" varchar(8) DEFAULT 'R4',
	"resourceData" jsonb NOT NULL,
	"disputeId" varchar(64),
	"expiresAt" timestamp,
	"fetchedAt" timestamp DEFAULT now(),
	"createdAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "smart_tokens" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"emrConnectionId" varchar(64) NOT NULL,
	"userId" varchar(64) NOT NULL,
	"accessToken" text NOT NULL,
	"refreshToken" text,
	"tokenType" varchar(32) DEFAULT 'Bearer',
	"scope" text,
	"expiresAt" timestamp,
	"patientContext" varchar(64),
	"encounterContext" varchar(64),
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "uscdi_data_elements" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"disputeId" varchar(64) NOT NULL,
	"emrConnectionId" varchar(64),
	"patientName" boolean DEFAULT false,
	"patientDOB" boolean DEFAULT false,
	"patientAddress" boolean DEFAULT false,
	"patientInsuranceMemberId" boolean DEFAULT false,
	"diagnosisCodes" boolean DEFAULT false,
	"procedureCodes" boolean DEFAULT false,
	"encounterDate" boolean DEFAULT false,
	"facilityNPI" boolean DEFAULT false,
	"providerNPI" boolean DEFAULT false,
	"billedAmount" boolean DEFAULT false,
	"allowedAmount" boolean DEFAULT false,
	"payerName" boolean DEFAULT false,
	"planType" boolean DEFAULT false,
	"priorAuthNumber" boolean DEFAULT false,
	"completenessScore" integer DEFAULT 0,
	"missingElements" jsonb DEFAULT '[]'::jsonb,
	"lastUpdatedAt" timestamp DEFAULT now(),
	"createdAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "bulk_fhir_emr_idx" ON "bulk_fhir_export_jobs" USING btree ("emrConnectionId");--> statement-breakpoint
CREATE INDEX "bulk_fhir_status_idx" ON "bulk_fhir_export_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cds_hooks_emr_idx" ON "cds_hooks" USING btree ("emrConnectionId");--> statement-breakpoint
CREATE INDEX "cds_hooks_hookId_idx" ON "cds_hooks" USING btree ("hookId");--> statement-breakpoint
CREATE INDEX "davinci_dispute_idx" ON "davinci_transactions" USING btree ("disputeId");--> statement-breakpoint
CREATE INDEX "davinci_type_status_idx" ON "davinci_transactions" USING btree ("txType","status");--> statement-breakpoint
CREATE INDEX "fhir_cap_emr_idx" ON "fhir_capability_statements" USING btree ("emrConnectionId");--> statement-breakpoint
CREATE INDEX "fhir_cache_emr_type_idx" ON "fhir_resource_cache" USING btree ("emrConnectionId","resourceType");--> statement-breakpoint
CREATE INDEX "fhir_cache_dispute_idx" ON "fhir_resource_cache" USING btree ("disputeId");--> statement-breakpoint
CREATE INDEX "smart_tokens_emr_user_idx" ON "smart_tokens" USING btree ("emrConnectionId","userId");--> statement-breakpoint
CREATE INDEX "uscdi_dispute_idx" ON "uscdi_data_elements" USING btree ("disputeId");