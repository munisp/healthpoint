CREATE TYPE "public"."emr_status" AS ENUM('active', 'inactive', 'error', 'testing');--> statement-breakpoint
CREATE TABLE "emr_connections" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"emrSystem" varchar(64) NOT NULL,
	"authType" varchar(32) NOT NULL,
	"baseUrl" text NOT NULL,
	"fhirVersion" varchar(8) DEFAULT 'R4',
	"credentialsEncrypted" text,
	"fieldMappings" jsonb NOT NULL,
	"status" "emr_status" DEFAULT 'inactive' NOT NULL,
	"lastTestAt" timestamp,
	"lastTestSuccess" boolean,
	"lastTestMessage" text,
	"aiConfidenceScore" numeric(4, 3),
	"resourcesFound" jsonb,
	"createdBy" varchar(64) NOT NULL,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "emr_connections_user_idx" ON "emr_connections" USING btree ("createdBy");--> statement-breakpoint
CREATE INDEX "emr_connections_status_idx" ON "emr_connections" USING btree ("status");--> statement-breakpoint
CREATE INDEX "emr_connections_system_idx" ON "emr_connections" USING btree ("emrSystem");