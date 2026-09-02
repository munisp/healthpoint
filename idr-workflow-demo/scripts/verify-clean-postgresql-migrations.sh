#!/usr/bin/env bash
set -euo pipefail

# This script is intentionally destructive only to an explicitly named test DB.
: "${MIGRATION_TEST_DATABASE_URL:?Set MIGRATION_TEST_DATABASE_URL to a disposable PostgreSQL database}"
: "${HEALTHPOINT_ALLOW_CLEAN_MIGRATION_TEST:?Set HEALTHPOINT_ALLOW_CLEAN_MIGRATION_TEST=true to acknowledge schema reset}"
if [[ "${HEALTHPOINT_ALLOW_CLEAN_MIGRATION_TEST}" != "true" ]]; then
  echo "HEALTHPOINT_ALLOW_CLEAN_MIGRATION_TEST must equal true" >&2
  exit 2
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for clean PostgreSQL migration verification" >&2
  exit 2
fi

DATABASE_NAME="$(node -e 'const u=new URL(process.argv[1]); console.log(decodeURIComponent(u.pathname.replace(/^\//,"")))' "$MIGRATION_TEST_DATABASE_URL")"
if [[ ! "$DATABASE_NAME" =~ (test|migration|ci) ]]; then
  echo "Refusing to reset database '$DATABASE_NAME'; a disposable test/migration/ci database name is required" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
EXPECTED_MIGRATION_ROWS="$(node -e 'const j=require("./drizzle/migrations/meta/_journal.json"); console.log(j.entries.length)')"
export DATABASE_URL="$MIGRATION_TEST_DATABASE_URL"

mkdir -p artifacts/clean-postgresql-migration-verification
LOG_DIR="$(cd artifacts/clean-postgresql-migration-verification && pwd)"

pnpm --ignore-workspace run validate:migration-journal 2>&1 | tee "$LOG_DIR/journal.json"
psql "$MIGRATION_TEST_DATABASE_URL" --set ON_ERROR_STOP=1 <<'SQL' | tee "$LOG_DIR/reset.log"
DROP SCHEMA IF EXISTS drizzle CASCADE;
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO public;
SQL

pnpm --ignore-workspace exec drizzle-kit migrate 2>&1 | tee "$LOG_DIR/migrate.log"
psql "$MIGRATION_TEST_DATABASE_URL" --set ON_ERROR_STOP=1 --tuples-only --no-align <<'SQL' | tee "$LOG_DIR/verification.txt"
SELECT 'drizzle_migration_rows=' || count(*) FROM drizzle.__drizzle_migrations;
SELECT 'required_tables=' || count(*)
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN (
     'disputes', 'dispute_workflow_transitions', 'cms_submissions',
     'cms_submission_outbox', 'document_analysis_jobs',
     'model_governance_models', 'model_validation_runs',
     'document_validation_runs', 'document_validation_step_evidence',
     'stakeholder_claim_evidence_bundles',
     'stakeholder_claim_evidence_artifacts',
     'stakeholder_claim_reviewer_attestations',
     'stakeholder_claim_signing_keys',
     'model_data_use_approvals',
     'cms_pilot_authorizations',
     'tigerbeetle_finality_account_mappings',
     'tigerbeetle_finality_intents',
     'tigerbeetle_finality_submission_authorizations',
     'tigerbeetle_finality_attempts'
   );
SELECT 'required_triggers=' || count(*)
  FROM pg_trigger
 WHERE NOT tgisinternal
   AND tgname IN (
     'stakeholder_claim_evidence_bundle_integrity_trigger',
     'stakeholder_claim_attestation_key_binding_trigger',
     'tigerbeetle_finality_mapping_immutable_trigger',
     'tigerbeetle_finality_mapping_activation_evidence_trigger',
     'tigerbeetle_finality_intent_immutable_trigger',
     'tigerbeetle_finality_authorization_transition_trigger',
     'tigerbeetle_finality_attempt_immutable_trigger'
   );
SQL

MIGRATION_ROWS="$(grep '^drizzle_migration_rows=' "$LOG_DIR/verification.txt" | cut -d= -f2)"
TABLES="$(grep '^required_tables=' "$LOG_DIR/verification.txt" | cut -d= -f2)"
TRIGGERS="$(grep '^required_triggers=' "$LOG_DIR/verification.txt" | cut -d= -f2)"
if [[ "$MIGRATION_ROWS" -ne "$EXPECTED_MIGRATION_ROWS" ]]; then
  echo "Expected $EXPECTED_MIGRATION_ROWS rows in drizzle.__drizzle_migrations; found $MIGRATION_ROWS" >&2
  exit 1
fi
if [[ "$TABLES" -ne 18 ]]; then
  echo "Expected 18 required tables; found $TABLES" >&2
  exit 1
fi
if [[ "$TRIGGERS" -ne 7 ]]; then
  echo "Expected 7 required evidence/finality triggers; found $TRIGGERS" >&2
  exit 1
fi

echo "Clean PostgreSQL migration verification passed: $EXPECTED_MIGRATION_ROWS migrations, 18 required tables, 7 required evidence/finality triggers."
