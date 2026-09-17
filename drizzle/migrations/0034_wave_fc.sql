-- wave-fc (money/ledger/settlements/data-integrity remediation)
-- 0034 is free on this branch (0033 and 0035 exist, no 0034).
--
-- M3/M5: overpayment-credit liability account. drizzle/schema.ts is owned by
-- another wave and intentionally NOT edited; server/ledger.ts uses a raw cast
-- (asDbAccountType) for this enum label.
ALTER TYPE "ledger_account_type" ADD VALUE IF NOT EXISTS 'overpayment_credit';
--> statement-breakpoint
-- M7: outbox dead-letter columns. Accessed exclusively via raw SQL in
-- server/outbox.ts + server/events/bus.ts (schema.ts unchanged).
ALTER TABLE "event_log" ADD COLUMN IF NOT EXISTS "deadLetterAt" timestamp;
--> statement-breakpoint
ALTER TABLE "event_log" ADD COLUMN IF NOT EXISTS "deadLetterReason" text;
