-- Wave F-A statutory/regulatory remediation (2026-09):
--
-- 1. disputes."initialPaymentDate" — date of the initial payment (or notice
--    of denial) for the claim. Statutory anchor for the 30-business-day open
--    negotiation window (45 CFR § 149.510(b)(1)); nullable, backfilled from
--    "createdAt" for pre-existing rows.
--
-- 2. qpa_contracted_rates."contractId" — payer contract identifier. The
--    45 CFR 149.140(b)(1) median uses ONE rate per contract; rows sharing a
--    contractId are collapsed to the contract median before the overall
--    median is taken.

ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "initialPaymentDate" timestamp;--> statement-breakpoint
UPDATE "disputes" SET "initialPaymentDate" = "createdAt" WHERE "initialPaymentDate" IS NULL;--> statement-breakpoint
ALTER TABLE "qpa_contracted_rates" ADD COLUMN IF NOT EXISTS "contractId" varchar(128);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "qpa_rates_contract_idx" ON "qpa_contracted_rates" USING btree ("contractId");
