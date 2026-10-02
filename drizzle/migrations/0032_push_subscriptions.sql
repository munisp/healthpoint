-- Web Push subscriptions (server/routers/push-subscriptions.ts): one row per
-- (userId, endpoint) holding the browser Push API subscription keys so the
-- server can deliver Web Push notifications (e.g. statutory deadline alerts).
-- See drizzle/schema-push.ts for the authoritative column comments.
-- NOT YET APPLIED — requires migration runner execution.

CREATE TABLE "push_subscriptions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"userId" varchar(64) NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_user_endpoint_idx" ON "push_subscriptions" USING btree ("userId","endpoint");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("userId");--> statement-breakpoint
