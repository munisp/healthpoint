CREATE TABLE "step_notes" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"disputeId" varchar(64) NOT NULL,
	"stepId" varchar(64) NOT NULL,
	"authorId" varchar(64) NOT NULL,
	"authorName" text,
	"note" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "step_notes_disputeId_idx" ON "step_notes" USING btree ("disputeId");--> statement-breakpoint
CREATE INDEX "step_notes_stepId_idx" ON "step_notes" USING btree ("stepId");