ALTER TABLE "users" ADD COLUMN "suspendedAt" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspendedUntil" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspendReason" text;