CREATE TABLE "provider_sandbox_acceptances" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"providerName" varchar(160) NOT NULL,
	"sandboxBaseUrl" text,
	"providerReference" varchar(160),
	"mtlsEvidenceState" varchar(32) DEFAULT 'pending' NOT NULL,
	"reconciliationEvidenceState" varchar(32) DEFAULT 'pending' NOT NULL,
	"bilateralAttestationReference" varchar(160),
	"evidenceNotes" text,
	"status" varchar(32) DEFAULT 'draft' NOT NULL,
	"submittedBy" varchar(64) NOT NULL,
	"submittedAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "provider_sandbox_acceptances_status_idx" ON "provider_sandbox_acceptances" USING btree ("status");--> statement-breakpoint
CREATE INDEX "provider_sandbox_acceptances_submittedAt_idx" ON "provider_sandbox_acceptances" USING btree ("submittedAt");