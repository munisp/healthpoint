#!/usr/bin/env bash
set -euo pipefail

: "${MIGRATION_TEST_DATABASE_URL:?Set MIGRATION_TEST_DATABASE_URL to a disposable PostgreSQL database}"
: "${HEALTHPOINT_ALLOW_CLEAN_MIGRATION_TEST:?Set HEALTHPOINT_ALLOW_CLEAN_MIGRATION_TEST=true to acknowledge schema reset}"
if [[ "$HEALTHPOINT_ALLOW_CLEAN_MIGRATION_TEST" != "true" ]]; then
  echo "HEALTHPOINT_ALLOW_CLEAN_MIGRATION_TEST must equal true" >&2
  exit 2
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for PostgreSQL upgrade migration verification" >&2
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
mkdir -p artifacts/postgresql-upgrade-migration-verification
LOG_DIR="$(cd artifacts/postgresql-upgrade-migration-verification && pwd)"
TEMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TEMP_DIR"; }
trap cleanup EXIT

# Build an immutable copy of the pre-remediation migration state from the first 27
# canonical journal entries. Current metadata and migration files are untouched.
node - "$TEMP_DIR" <<'NODE'
const fs = require('fs');
const path = require('path');
const [target] = process.argv.slice(2);
const root = process.cwd();
const source = path.join(root, 'drizzle', 'migrations');
const journal = JSON.parse(fs.readFileSync(path.join(source, 'meta', '_journal.json'), 'utf8'));
const oldEntries = journal.entries.slice(0, 27);
const output = path.join(target, 'migrations');
fs.mkdirSync(path.join(output, 'meta'), { recursive: true });
for (const entry of oldEntries) {
  fs.copyFileSync(path.join(source, `${entry.tag}.sql`), path.join(output, `${entry.tag}.sql`));
}
for (const file of fs.readdirSync(path.join(source, 'meta'))) {
  if (file.endsWith('_snapshot.json')) fs.copyFileSync(path.join(source, 'meta', file), path.join(output, 'meta', file));
}
fs.writeFileSync(path.join(output, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: oldEntries }, null, 2) + '\n');
NODE

cat > "$TEMP_DIR/drizzle.upgrade.config.ts" <<EOF
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "${ROOT}/drizzle/schema.ts",
  out: "${TEMP_DIR}/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
EOF

psql "$MIGRATION_TEST_DATABASE_URL" --set ON_ERROR_STOP=1 <<'SQL' | tee "$LOG_DIR/reset.log"
DROP SCHEMA IF EXISTS drizzle CASCADE;
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO public;
SQL

pnpm exec drizzle-kit migrate --config "$TEMP_DIR/drizzle.upgrade.config.ts" | tee "$LOG_DIR/pre_remediation_migrate.log"
PRE_COUNT="$(psql "$MIGRATION_TEST_DATABASE_URL" --tuples-only --no-align -c 'SELECT count(*) FROM drizzle.__drizzle_migrations')"
if [[ "$PRE_COUNT" -ne 27 ]]; then
  echo "Expected 27 pre-remediation migrations; found $PRE_COUNT" >&2
  exit 1
fi

pnpm exec drizzle-kit migrate | tee "$LOG_DIR/upgrade_migrate.log"
POST_COUNT="$(psql "$MIGRATION_TEST_DATABASE_URL" --tuples-only --no-align -c 'SELECT count(*) FROM drizzle.__drizzle_migrations')"
if [[ "$POST_COUNT" -ne "$EXPECTED_MIGRATION_ROWS" ]]; then
  echo "Expected $EXPECTED_MIGRATION_ROWS migrations after upgrade; found $POST_COUNT" >&2
  exit 1
fi

psql "$MIGRATION_TEST_DATABASE_URL" --set ON_ERROR_STOP=1 --tuples-only --no-align <<'SQL' | tee "$LOG_DIR/verification.txt"
SELECT 'upgrade_migration_rows=' || count(*) FROM drizzle.__drizzle_migrations;
SELECT 'governance_tables=' || count(*)
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN (
     'cms_submissions', 'cms_submission_outbox', 'document_analysis_jobs',
     'model_governance_models', 'model_validation_runs',
     'document_validation_runs', 'document_validation_step_evidence',
     'stakeholder_claim_evidence_bundles',
     'stakeholder_claim_evidence_artifacts',
     'stakeholder_claim_reviewer_attestations',
     'stakeholder_claim_signing_keys',
     'model_data_use_approvals',
     'cms_pilot_authorizations'
   );
SQL

GOVERNANCE_TABLES="$(grep '^governance_tables=' "$LOG_DIR/verification.txt" | cut -d= -f2)"
if [[ "$GOVERNANCE_TABLES" -ne 13 ]]; then
  echo "Expected 13 governance/release-control tables after upgrade; found $GOVERNANCE_TABLES" >&2
  exit 1
fi

echo "PostgreSQL upgrade migration verification passed: 27 -> $EXPECTED_MIGRATION_ROWS migrations, 13 governance/release-control tables."
