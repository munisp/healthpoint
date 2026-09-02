CREATE TABLE "settlement_job_configs" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"cronExpression" varchar(64) NOT NULL,
	"scheduleCronTaskUid" varchar(65),
	"isEnabled" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_job_configs_name_idx" ON "settlement_job_configs" USING btree ("name");--> statement-breakpoint
CREATE INDEX "settlement_job_configs_task_uid_idx" ON "settlement_job_configs" USING btree ("scheduleCronTaskUid");