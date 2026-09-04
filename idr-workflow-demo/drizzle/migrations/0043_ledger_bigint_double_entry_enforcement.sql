-- 0043: Convert the ledger cache to signed bigint cents and make journal postings immutable.
-- This is a forward-only financial correction. Do not roll this migration back on a
-- populated production database; restore from an approved backup or ship an audited
-- forward corrective migration if reconciliation identifies an issue.

LOCK TABLE "ledger_entries", "ledger_accounts" IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE "ledger_accounts"
  ALTER COLUMN "balanceCents" TYPE bigint USING "balanceCents"::bigint;
ALTER TABLE "ledger_entries"
  ALTER COLUMN "amountCents" TYPE bigint USING "amountCents"::bigint;

-- Stop before rebuilding the cache if historic journal entries are structurally
-- inconsistent. This prevents a silent conversion of bad financial data.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ledger_entries" entry
    LEFT JOIN "ledger_accounts" debit ON debit."id" = entry."debitAccountId"
    LEFT JOIN "ledger_accounts" credit ON credit."id" = entry."creditAccountId"
    WHERE entry."amountCents" <= 0
       OR entry."debitAccountId" = entry."creditAccountId"
       OR debit."id" IS NULL
       OR credit."id" IS NULL
       OR debit."disputeId" <> entry."disputeId"
       OR credit."disputeId" <> entry."disputeId"
       OR debit."currency" <> entry."currency"
       OR credit."currency" <> entry."currency"
  ) THEN
    RAISE EXCEPTION 'ledger integrity failure: entries must be positive, use distinct accounts, and reference same-dispute same-currency accounts';
  END IF;
END;
$$;

ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_positive_amount"
  CHECK ("amountCents" > 0) NOT VALID,
  ADD CONSTRAINT "ledger_entries_distinct_accounts"
  CHECK ("debitAccountId" <> "creditAccountId") NOT VALID;
ALTER TABLE "ledger_entries" VALIDATE CONSTRAINT "ledger_entries_positive_amount";
ALTER TABLE "ledger_entries" VALIDATE CONSTRAINT "ledger_entries_distinct_accounts";

-- Rebuild the denormalized signed balance cache from the immutable journal. Debit
-- balances are positive and credit balances are negative; the aggregate across all
-- accounts of each dispute is exactly zero after this migration.
UPDATE "ledger_accounts" SET "balanceCents" = 0, "updatedAt" = now();
WITH postings AS (
  SELECT "debitAccountId" AS account_id, "amountCents" AS delta FROM "ledger_entries"
  UNION ALL
  SELECT "creditAccountId" AS account_id, -"amountCents" AS delta FROM "ledger_entries"
), totals AS (
  SELECT account_id, SUM(delta) AS balance_cents FROM postings GROUP BY account_id
)
UPDATE "ledger_accounts" account
SET "balanceCents" = totals.balance_cents,
    "updatedAt" = now()
FROM totals
WHERE account."id" = totals.account_id;

CREATE OR REPLACE FUNCTION "ledger_entries_validate_posting"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  debit_account record;
  credit_account record;
BEGIN
  SELECT "disputeId", "currency" INTO debit_account
    FROM "ledger_accounts" WHERE "id" = NEW."debitAccountId" FOR KEY SHARE;
  SELECT "disputeId", "currency" INTO credit_account
    FROM "ledger_accounts" WHERE "id" = NEW."creditAccountId" FOR KEY SHARE;
  IF debit_account."disputeId" IS NULL OR credit_account."disputeId" IS NULL THEN
    RAISE EXCEPTION 'ledger posting references missing account';
  END IF;
  IF NEW."amountCents" <= 0 OR NEW."debitAccountId" = NEW."creditAccountId" THEN
    RAISE EXCEPTION 'ledger posting amount must be positive and accounts distinct';
  END IF;
  IF debit_account."disputeId" <> NEW."disputeId"
     OR credit_account."disputeId" <> NEW."disputeId"
     OR debit_account."currency" <> NEW."currency"
     OR credit_account."currency" <> NEW."currency" THEN
    RAISE EXCEPTION 'ledger posting account/dispute/currency mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "ledger_entries_apply_signed_balances"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "ledger_accounts"
    SET "balanceCents" = "balanceCents" + NEW."amountCents", "updatedAt" = now()
    WHERE "id" = NEW."debitAccountId";
  UPDATE "ledger_accounts"
    SET "balanceCents" = "balanceCents" - NEW."amountCents", "updatedAt" = now()
    WHERE "id" = NEW."creditAccountId";
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "ledger_entries_reject_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ledger entries are immutable; post an audited correcting entry instead';
END;
$$;

DROP TRIGGER IF EXISTS "ledger_entries_validate_posting_trigger" ON "ledger_entries";
CREATE TRIGGER "ledger_entries_validate_posting_trigger"
  BEFORE INSERT ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "ledger_entries_validate_posting"();
DROP TRIGGER IF EXISTS "ledger_entries_apply_signed_balances_trigger" ON "ledger_entries";
CREATE TRIGGER "ledger_entries_apply_signed_balances_trigger"
  AFTER INSERT ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "ledger_entries_apply_signed_balances"();
DROP TRIGGER IF EXISTS "ledger_entries_immutable_trigger" ON "ledger_entries";
CREATE TRIGGER "ledger_entries_immutable_trigger"
  BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "ledger_entries_reject_mutation"();

-- Fail the migration if the rebuilt cache does not prove balance conservation.
DO $$
BEGIN
  IF EXISTS (
    SELECT "disputeId"
    FROM "ledger_accounts"
    GROUP BY "disputeId"
    HAVING SUM("balanceCents") <> 0
  ) THEN
    RAISE EXCEPTION 'ledger integrity failure: signed balances do not conserve to zero';
  END IF;
END;
$$;
