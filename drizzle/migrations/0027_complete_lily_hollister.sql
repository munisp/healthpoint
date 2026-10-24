CREATE TABLE "reconciliation_runs" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"runKey" varchar(128) NOT NULL,
	"status" varchar(32) NOT NULL,
	"tigerBeetleEnabled" boolean NOT NULL,
	"accountsCompared" integer DEFAULT 0 NOT NULL,
	"driftCount" integer DEFAULT 0 NOT NULL,
	"drifts" jsonb NOT NULL,
	"errorMessage" text,
	"triggeredBy" varchar(64) NOT NULL,
	"startedAt" timestamp NOT NULL,
	"completedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_runs_runKey_idx" ON "reconciliation_runs" USING btree ("runKey");--> statement-breakpoint
CREATE INDEX "reconciliation_runs_status_idx" ON "reconciliation_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reconciliation_runs_createdAt_idx" ON "reconciliation_runs" USING btree ("createdAt");
