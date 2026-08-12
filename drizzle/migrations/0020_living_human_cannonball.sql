ALTER TABLE "disputes" ADD COLUMN "paidAmount" numeric(12, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN "idempotencyKey" varchar(64);--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_dispute_idempotency_idx" ON "ledger_entries" USING btree ("disputeId","idempotencyKey");