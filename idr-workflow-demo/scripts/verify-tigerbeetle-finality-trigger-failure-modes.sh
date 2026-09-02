#!/usr/bin/env bash
# Validates the current migration-0046 finality trigger functions against the
# disposable local PostgreSQL test database. Never target staging/production.
set -Eeuo pipefail

if [[ "${HEALTHPOINT_ALLOW_LOCAL_TRIGGER_TEST:-}" != "true" ]]; then
  echo "Refusing finality trigger test: HEALTHPOINT_ALLOW_LOCAL_TRIGGER_TEST=true is required." >&2
  exit 2
fi
if [[ "${NODE_ENV:-}" == "production" || "${HEALTHPOINT_ENVIRONMENT:-}" == "production" || "${HEALTHPOINT_ENVIRONMENT:-}" == "staging" ]]; then
  echo "Refusing finality trigger test outside an explicitly local test environment." >&2
  exit 2
fi
if [[ "${CI:-}" == "true" || "${GITHUB_ACTIONS:-}" == "true" ]]; then
  echo "Refusing finality trigger test from CI; run only from an approved local workstation." >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATION="$ROOT/drizzle/migrations/0046_tigerbeetle_durable_finality_reconciliation.sql"
DATABASE="${HEALTHPOINT_LOCAL_TRIGGER_TEST_DATABASE:-healthpoint_migration_test}"
APPROVAL_FILE="${HEALTHPOINT_LOCAL_TRIGGER_TEST_APPROVAL_FILE:-/etc/healthpoint/approved-local-trigger-test}"

if [[ ! -r "$MIGRATION" ]]; then
  echo "Missing canonical migration: $MIGRATION" >&2
  exit 2
fi
if [[ "$DATABASE" != "healthpoint_migration_test" ]]; then
  echo "Refusing non-disposable database target; only healthpoint_migration_test is permitted." >&2
  exit 2
fi
if [[ ! -f "$APPROVAL_FILE" || ! -r "$APPROVAL_FILE" ]]; then
  echo "Refusing finality trigger test: required local approval marker is absent or unreadable." >&2
  exit 2
fi
marker_owner="$(stat -c '%U' "$APPROVAL_FILE" 2>/dev/null || true)"
marker_mode="$(stat -c '%a' "$APPROVAL_FILE" 2>/dev/null || true)"
if [[ "$marker_owner" != "root" || ! "$marker_mode" =~ ^[0-7]{3,4}$ ]]; then
  echo "Refusing finality trigger test: local approval marker must be root-owned with an octal mode." >&2
  exit 2
fi
marker_group_digit="${marker_mode: -2:1}"
marker_other_digit="${marker_mode: -1}"
if (( (10#$marker_group_digit & 2) != 0 || (10#$marker_other_digit & 2) != 0 )); then
  echo "Refusing finality trigger test: local approval marker must not be group- or world-writable." >&2
  exit 2
fi
if [[ "$(cat "$APPROVAL_FILE")" != "healthpoint-local-trigger-test-approved-v1" ]]; then
  echo "Refusing finality trigger test: local approval marker content is invalid." >&2
  exit 2
fi

# Stream only the current trigger functions from the canonical migration into
# a peer-authenticated local PostgreSQL session. This avoids duplicating
# enforcement logic in a test fixture and leaves no persistent data.
extract_functions() {
  awk '
    /^CREATE OR REPLACE FUNCTION "tigerbeetle_finality_(reject_mapping_mutation|reject_intent_mutation|validate_authorization_transition|reject_attempt_mutation)"/ { emit=1 }
    emit { print }
    emit && /^\$\$;$/ { emit=0 }
  ' "$MIGRATION"
}

{
cat <<'SQL_HEADER'
\set ON_ERROR_STOP on
BEGIN;
SQL_HEADER
extract_functions
cat <<'SQL_TESTS'

CREATE TEMP TABLE finality_mapping_trigger_test (
  "provider" varchar(64) NOT NULL,
  "currency" varchar(3) NOT NULL,
  "debitAccountId" varchar(39) NOT NULL,
  "creditAccountId" varchar(39) NOT NULL,
  "ledger" integer NOT NULL,
  "code" integer NOT NULL,
  "mode" varchar(64) NOT NULL,
  "mappingVersion" integer NOT NULL,
  "approvedBy" varchar(64) NOT NULL,
  "approvalReference" varchar(128) NOT NULL
) ON COMMIT DROP;
CREATE TRIGGER finality_mapping_trigger_test_enforcement
  BEFORE UPDATE OR DELETE ON finality_mapping_trigger_test
  FOR EACH ROW EXECUTE FUNCTION "tigerbeetle_finality_reject_mapping_mutation"();
INSERT INTO finality_mapping_trigger_test VALUES ('provider-a', 'USD', '1', '2', 1, 1, 'single_phase_settlement', 1, 'creator-a', 'CHG-1001');

CREATE TEMP TABLE finality_intent_trigger_test (
  "settlementTransferId" varchar(64) NOT NULL,
  "providerReportId" varchar(64) NOT NULL,
  "mappingId" varchar(64) NOT NULL,
  "provider" varchar(64) NOT NULL,
  "currency" varchar(3) NOT NULL,
  "mode" varchar(64) NOT NULL,
  "tigerbeetleTransferId" varchar(39) NOT NULL,
  "debitAccountId" varchar(39) NOT NULL,
  "creditAccountId" varchar(39) NOT NULL,
  "ledger" integer NOT NULL,
  "code" integer NOT NULL,
  "amountCents" bigint NOT NULL,
  "payloadDigest" varchar(64) NOT NULL,
  "createdAt" timestamp NOT NULL
) ON COMMIT DROP;
CREATE TRIGGER finality_intent_trigger_test_enforcement
  BEFORE UPDATE OR DELETE ON finality_intent_trigger_test
  FOR EACH ROW EXECUTE FUNCTION "tigerbeetle_finality_reject_intent_mutation"();
INSERT INTO finality_intent_trigger_test VALUES ('transfer-a', 'report-a', 'mapping-a', 'provider-a', 'USD', 'single_phase_settlement', '1', '2', '3', 1, 1, 9007199254740993, repeat('a', 64), now());

CREATE TEMP TABLE finality_authorization_trigger_test (
  "intentId" varchar(64) NOT NULL,
  "changeTicket" varchar(128) NOT NULL,
  "requestReason" text NOT NULL,
  "requestedBy" varchar(64) NOT NULL,
  "requestedAt" timestamp NOT NULL,
  "approvedBy" varchar(64),
  "approvedAt" timestamp,
  "expiresAt" timestamp,
  "consumedAt" timestamp,
  "consumedBy" varchar(64),
  "cancelledAt" timestamp,
  "cancelledBy" varchar(64),
  "status" varchar(64) NOT NULL
) ON COMMIT DROP;
CREATE TRIGGER finality_authorization_trigger_test_enforcement
  BEFORE UPDATE OR DELETE ON finality_authorization_trigger_test
  FOR EACH ROW EXECUTE FUNCTION "tigerbeetle_finality_validate_authorization_transition"();
INSERT INTO finality_authorization_trigger_test VALUES ('intent-a', 'CHG-1001', 'Approved controlled test authorization', 'requester-a', now(), NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'pending_approval');

CREATE TEMP TABLE finality_attempt_trigger_test (
  "outcome" varchar(64) NOT NULL
) ON COMMIT DROP;
CREATE TRIGGER finality_attempt_trigger_test_enforcement
  BEFORE UPDATE OR DELETE ON finality_attempt_trigger_test
  FOR EACH ROW EXECUTE FUNCTION "tigerbeetle_finality_reject_attempt_mutation"();
INSERT INTO finality_attempt_trigger_test VALUES ('created');

DO $$
BEGIN
  BEGIN
    DELETE FROM finality_mapping_trigger_test;
    RAISE EXCEPTION 'mapping delete unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' OR SQLERRM <> 'TigerBeetle finality mappings are immutable; deactivate an old version instead of deleting it' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE finality_mapping_trigger_test SET "ledger" = 2;
    RAISE EXCEPTION 'mapping financial mutation unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' OR SQLERRM <> 'TigerBeetle finality mappings are immutable; add a new version and deactivate the old mapping' THEN RAISE; END IF;
  END;

  BEGIN
    DELETE FROM finality_intent_trigger_test;
    RAISE EXCEPTION 'intent delete unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' OR SQLERRM <> 'TigerBeetle finality intents are immutable; preserve the intent and record a terminal exception instead of deleting it' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE finality_intent_trigger_test SET "amountCents" = 1;
    RAISE EXCEPTION 'intent financial mutation unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' OR SQLERRM <> 'TigerBeetle finality intent financial fields are immutable' THEN RAISE; END IF;
  END;

  BEGIN
    DELETE FROM finality_authorization_trigger_test;
    RAISE EXCEPTION 'authorization delete unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' OR SQLERRM <> 'TigerBeetle finality submission authorizations are immutable; cancel or expire the authorization instead' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE finality_authorization_trigger_test
      SET "status" = 'consumed', "consumedAt" = now(), "consumedBy" = 'executor-a';
    RAISE EXCEPTION 'authorization invalid transition unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' OR SQLERRM <> 'invalid TigerBeetle finality authorization status transition' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE finality_attempt_trigger_test SET "outcome" = 'retryable_transport_error';
    RAISE EXCEPTION 'attempt mutation unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' OR SQLERRM <> 'TigerBeetle finality attempt evidence is immutable' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM finality_attempt_trigger_test;
    RAISE EXCEPTION 'attempt delete unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' OR SQLERRM <> 'TigerBeetle finality attempt evidence is immutable' THEN RAISE; END IF;
  END;
END;
$$;

SELECT 'PASS: mapping, intent, authorization, and attempt trigger failure modes rejected' AS result;
ROLLBACK;
SQL_TESTS
} | sudo -u postgres psql --no-psqlrc --set=ON_ERROR_STOP=1 -d "$DATABASE"
