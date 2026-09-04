-- 0044: The ledger account balance is a cache derived exclusively from immutable
-- journal entries. Direct balance updates are forbidden. A nested update issued by
-- the ledger entry AFTER INSERT trigger remains permitted.

CREATE OR REPLACE FUNCTION "ledger_accounts_reject_direct_balance_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."balanceCents" <> OLD."balanceCents" AND pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'ledger account balances are derived from immutable entries and cannot be updated directly';
  END IF;
  IF NEW."disputeId" <> OLD."disputeId"
     OR NEW."accountType" <> OLD."accountType"
     OR NEW."currency" <> OLD."currency" THEN
    RAISE EXCEPTION 'ledger account identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "ledger_accounts_cache_guard_trigger" ON "ledger_accounts";
CREATE TRIGGER "ledger_accounts_cache_guard_trigger"
  BEFORE UPDATE ON "ledger_accounts"
  FOR EACH ROW EXECUTE FUNCTION "ledger_accounts_reject_direct_balance_mutation"();
