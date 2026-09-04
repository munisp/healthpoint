-- Native bigint settlement cents
-- Forward-only migration. PostgreSQL retains exact signed int8 cents; no float or numeric
-- conversion is performed. Schedule with a maintenance window for large live tables.

BEGIN;

LOCK TABLE settlement_callbacks,
           settlement_transfers,
           settlement_provider_reports,
           settlement_reconciliations,
           settlement_balance_proofs
  IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE settlement_callbacks
  ALTER COLUMN "amountCents" TYPE bigint USING "amountCents"::bigint;

ALTER TABLE settlement_transfers
  ALTER COLUMN "amountCents" TYPE bigint USING "amountCents"::bigint;

ALTER TABLE settlement_provider_reports
  ALTER COLUMN "amountCents" TYPE bigint USING "amountCents"::bigint;

ALTER TABLE settlement_reconciliations
  ALTER COLUMN "expectedAmountCents" TYPE bigint USING "expectedAmountCents"::bigint,
  ALTER COLUMN "reportedAmountCents" TYPE bigint USING "reportedAmountCents"::bigint;

ALTER TABLE settlement_balance_proofs
  ALTER COLUMN "ledgerPaymentCents" TYPE bigint USING "ledgerPaymentCents"::bigint,
  ALTER COLUMN "ledgerReversalCents" TYPE bigint USING "ledgerReversalCents"::bigint;

COMMIT;
