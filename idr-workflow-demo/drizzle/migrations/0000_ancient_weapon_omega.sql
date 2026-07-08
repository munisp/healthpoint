CREATE TYPE "public"."dispute_status" AS ENUM('open_negotiation', 'idr_initiated', 'idr_entity_selection', 'eligibility_review', 'offer_submission', 'under_arbitration', 'determination_issued', 'payment_pending', 'closed', 'appealed', 'ineligible');--> statement-breakpoint
CREATE TYPE "public"."idr_step" AS ENUM('STEP_01_OPEN_NEGOTIATION_INITIATED', 'STEP_02_OPEN_NEGOTIATION_PERIOD', 'STEP_03_OPEN_NEGOTIATION_FAILED', 'STEP_04_IDR_INITIATED', 'STEP_05_IDR_NOTICE_SENT', 'STEP_06_IDR_ENTITY_SELECTION', 'STEP_07_IDR_ENTITY_SELECTED', 'STEP_08_ELIGIBILITY_REVIEW', 'STEP_09_OFFER_SUBMISSION', 'STEP_10_QPA_DISCLOSURE', 'STEP_11_ADDITIONAL_INFORMATION', 'STEP_12_ARBITRATION_REVIEW', 'STEP_13_DETERMINATION_ISSUED', 'STEP_14_PAYMENT_DETERMINATION', 'STEP_15_PAYMENT_MADE', 'STEP_16_ADMINISTRATIVE_FEE_PAID', 'STEP_17_DISPUTE_CLOSED', 'STEP_18_APPEAL_FILED', 'STEP_19_APPEAL_RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."offer_type" AS ENUM('initiating_party', 'responding_party', 'qpa', 'determination');--> statement-breakpoint
CREATE TYPE "public"."party_type" AS ENUM('provider', 'facility', 'payer', 'aggregator');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."service_type" AS ENUM('emergency_medicine', 'anesthesiology', 'pathology', 'radiology', 'neonatology', 'assistant_surgeon', 'hospitalist', 'intensivist', 'air_ambulance', 'ground_ambulance', 'other');--> statement-breakpoint
CREATE TABLE "dispute_documents" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"disputeId" varchar(64) NOT NULL,
	"documentType" varchar(64) NOT NULL,
	"fileName" varchar(255) NOT NULL,
	"fileSize" integer,
	"mimeType" varchar(128),
	"s3Key" varchar(512),
	"uploadedBy" varchar(64),
	"uploadedAt" timestamp DEFAULT now(),
	"description" text
);
--> statement-breakpoint
CREATE TABLE "dispute_drafts" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"userId" varchar(64) NOT NULL,
	"formData" jsonb NOT NULL,
	"currentStep" integer DEFAULT 1,
	"lastSavedAt" timestamp DEFAULT now(),
	"createdAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "dispute_events" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"disputeId" varchar(64) NOT NULL,
	"step" "idr_step" NOT NULL,
	"previousStep" "idr_step",
	"eventType" varchar(64) NOT NULL,
	"description" text NOT NULL,
	"performedBy" varchar(64),
	"performedByName" varchar(255),
	"metadata" jsonb,
	"createdAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "dispute_offers" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"disputeId" varchar(64) NOT NULL,
	"offerType" "offer_type" NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"rationale" text,
	"supportingDocIds" jsonb,
	"submittedBy" varchar(64),
	"submittedAt" timestamp DEFAULT now(),
	"isAccepted" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"referenceNumber" varchar(32) NOT NULL,
	"initiatingPartyId" varchar(64) NOT NULL,
	"initiatingPartyType" "party_type" NOT NULL,
	"initiatingPartyName" varchar(255) NOT NULL,
	"initiatingPartyNpi" varchar(20),
	"respondingPartyId" varchar(64),
	"respondingPartyType" "party_type",
	"respondingPartyName" varchar(255),
	"respondingPartyNpi" varchar(20),
	"serviceType" "service_type" NOT NULL,
	"serviceDate" timestamp NOT NULL,
	"patientState" varchar(2) NOT NULL,
	"facilityState" varchar(2) NOT NULL,
	"cptCodes" jsonb NOT NULL,
	"icd10Codes" jsonb,
	"billedAmount" numeric(12, 2) NOT NULL,
	"qpaAmount" numeric(12, 2),
	"initiatingPartyOffer" numeric(12, 2),
	"respondingPartyOffer" numeric(12, 2),
	"determinationAmount" numeric(12, 2),
	"adminFeeAmount" numeric(12, 2),
	"currentStep" "idr_step" DEFAULT 'STEP_01_OPEN_NEGOTIATION_INITIATED' NOT NULL,
	"status" "dispute_status" DEFAULT 'open_negotiation' NOT NULL,
	"idrEntityId" varchar(64),
	"idrEntityName" varchar(255),
	"openNegotiationDeadline" timestamp,
	"idrInitiationDeadline" timestamp,
	"entitySelectionDeadline" timestamp,
	"eligibilityDeadline" timestamp,
	"offerSubmissionDeadline" timestamp,
	"additionalInfoDeadline" timestamp,
	"determinationDeadline" timestamp,
	"paymentDeadline" timestamp,
	"isEligible" boolean,
	"ineligibilityReason" text,
	"determinationBasis" text,
	"notes" text,
	"createdBy" varchar(64),
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now(),
	"closedAt" timestamp,
	CONSTRAINT "disputes_referenceNumber_unique" UNIQUE("referenceNumber")
);
--> statement-breakpoint
CREATE TABLE "idr_entities" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"certificationNumber" varchar(64),
	"certificationExpiry" timestamp,
	"specialties" jsonb,
	"states" jsonb,
	"contactEmail" varchar(320),
	"contactPhone" varchar(20),
	"website" varchar(512),
	"avgResolutionDays" integer,
	"totalCasesHandled" integer DEFAULT 0,
	"maxConcurrentCases" integer DEFAULT 50,
	"currentActiveCases" integer DEFAULT 0,
	"isActive" boolean DEFAULT true,
	"createdAt" timestamp DEFAULT now(),
	CONSTRAINT "idr_entities_certificationNumber_unique" UNIQUE("certificationNumber")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"disputeId" varchar(64) NOT NULL,
	"userId" varchar(64),
	"notificationType" varchar(64) NOT NULL,
	"title" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"dueDate" timestamp,
	"isRead" boolean DEFAULT false,
	"createdAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" "role" DEFAULT 'user' NOT NULL,
	"createdAt" timestamp DEFAULT now(),
	"lastSignedIn" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "docs_dispute_idx" ON "dispute_documents" USING btree ("disputeId");--> statement-breakpoint
CREATE INDEX "events_dispute_idx" ON "dispute_events" USING btree ("disputeId");--> statement-breakpoint
CREATE INDEX "events_step_idx" ON "dispute_events" USING btree ("step");--> statement-breakpoint
CREATE INDEX "offers_dispute_idx" ON "dispute_offers" USING btree ("disputeId");--> statement-breakpoint
CREATE INDEX "disputes_status_idx" ON "disputes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "disputes_step_idx" ON "disputes" USING btree ("currentStep");--> statement-breakpoint
CREATE INDEX "disputes_initiating_idx" ON "disputes" USING btree ("initiatingPartyId");--> statement-breakpoint
CREATE INDEX "disputes_responding_idx" ON "disputes" USING btree ("respondingPartyId");--> statement-breakpoint
CREATE UNIQUE INDEX "disputes_ref_idx" ON "disputes" USING btree ("referenceNumber");--> statement-breakpoint
CREATE INDEX "notif_dispute_idx" ON "notifications" USING btree ("disputeId");--> statement-breakpoint
CREATE INDEX "notif_user_idx" ON "notifications" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "notif_read_idx" ON "notifications" USING btree ("isRead");