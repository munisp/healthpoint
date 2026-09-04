#!/usr/bin/env bash
# Verifies migration 0043 in a rollback-only PostgreSQL transaction.
# Required: MIGRATION_TEST_DATABASE_URL points to a disposable database with the
# canonical migrations applied. This script never changes Drizzle metadata.
set -euo pipefail

: "${MIGRATION_TEST_DATABASE_URL:?MIGRATION_TEST_DATABASE_URL is required}"
if [[ "${MIGRATION_TEST_DATABASE_URL}" != *"healthpoint_migration_test"* ]]; then
  echo "Refusing ledger verifier: database URL must target the disposable healthpoint_migration_test database" >&2
  exit 64
fi

psql "$MIGRATION_TEST_DATABASE_URL" --set=ON_ERROR_STOP=1 --tuples-only --no-align <<'SQL'
BEGIN;

INSERT INTO "ledger_accounts" ("id", "disputeId", "accountType", "balanceCents", "currency") VALUES
  ('ledger-verify-debit', 'ledger-verify-dispute-a', 'billed', 0, 'USD'),
  ('ledger-verify-credit', 'ledger-verify-dispute-a', 'adjustment', 0, 'USD'),
  ('ledger-verify-foreign', 'ledger-verify-dispute-b', 'billed', 0, 'USD');

INSERT INTO "ledger_entries" (
  "id", "disputeId", "debitAccountId", "creditAccountId", "amountCents", "currency", "entryType", "description"
) VALUES (
  'ledger-verify-entry', 'ledger-verify-dispute-a', 'ledger-verify-debit', 'ledger-verify-credit', 9007199254740993, 'USD', 'debit', 'rollback-only ledger verifier above JavaScript safe integer'
);

DO $$
DECLARE
  debit_balance bigint;
  credit_balance bigint;
  conserved_balance bigint;
BEGIN
  SELECT "balanceCents" INTO debit_balance FROM "ledger_accounts" WHERE "id" = 'ledger-verify-debit';
  SELECT "balanceCents" INTO credit_balance FROM "ledger_accounts" WHERE "id" = 'ledger-verify-credit';
  SELECT SUM("balanceCents") INTO conserved_balance FROM "ledger_accounts" WHERE "disputeId" = 'ledger-verify-dispute-a';
  IF debit_balance <> 9007199254740993 OR credit_balance <> -9007199254740993 OR conserved_balance <> 0 THEN
    RAISE EXCEPTION 'signed balance failure debit=% credit=% conserved=%', debit_balance, credit_balance, conserved_balance;
  END IF;
END;
$$;

DO $$
DECLARE
  non_bigint_count integer;
BEGIN
  SELECT COUNT(*) INTO non_bigint_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND (table_name, column_name) IN (
      ('ledger_accounts', 'balanceCents'),
      ('ledger_entries', 'amountCents'),
      ('settlement_callbacks', 'amountCents'),
      ('settlement_transfers', 'amountCents'),
      ('settlement_provider_reports', 'amountCents'),
      ('settlement_reconciliations', 'expectedAmountCents'),
      ('settlement_reconciliations', 'reportedAmountCents'),
      ('settlement_balance_proofs', 'ledgerPaymentCents'),
      ('settlement_balance_proofs', 'ledgerReversalCents')
    ) AND data_type <> 'bigint';
  IF non_bigint_count <> 0 THEN
    RAISE EXCEPTION 'active monetary columns not bigint: %', non_bigint_count;
  END IF;

  BEGIN
    INSERT INTO "ledger_entries" (
      "id", "disputeId", "debitAccountId", "creditAccountId", "amountCents", "currency", "entryType", "description"
    ) VALUES (
      'ledger-verify-cross-dispute', 'ledger-verify-dispute-a', 'ledger-verify-debit', 'ledger-verify-foreign', 1, 'USD', 'debit', 'must reject cross-dispute posting'
    );
    RAISE EXCEPTION 'cross-dispute posting was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF position('account/dispute/currency mismatch' in SQLERRM) = 0 THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE "ledger_entries" SET "description" = 'mutation' WHERE "id" = 'ledger-verify-entry';
    RAISE EXCEPTION 'immutable ledger entry was modified';
  EXCEPTION WHEN OTHERS THEN
    IF position('ledger entries are immutable' in SQLERRM) = 0 THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE "ledger_accounts" SET "balanceCents" = 1 WHERE "id" = 'ledger-verify-debit';
    RAISE EXCEPTION 'direct ledger cache mutation was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF position('ledger account balances are derived from immutable entries' in SQLERRM) = 0 THEN RAISE; END IF;
  END;
END;
$$;

SELECT 'ledger_db_enforcement=passed';
SELECT 'ledger_high_value_cents=9007199254740993';
SELECT 'ledger_active_monetary_columns=int8';
ROLLBACK;
SQL
