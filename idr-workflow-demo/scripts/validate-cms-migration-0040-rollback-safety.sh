#!/usr/bin/env bash
# Validates whether migration 0040 schema reversal would be safe in a disposable
# environment. This script never executes DDL and never alters Drizzle metadata.
# Production recovery must be a reviewed forward migration that preserves receipt
# and feedback evidence; do not use a destructive down migration for audit data.
set -Eeuo pipefail

: "${MIGRATION_ROLLBACK_DATABASE_URL:?Set MIGRATION_ROLLBACK_DATABASE_URL to a PostgreSQL database URL}"
: "${HEALTHPOINT_ALLOW_0040_ROLLBACK_SAFETY_CHECK:?Set HEALTHPOINT_ALLOW_0040_ROLLBACK_SAFETY_CHECK=true to acknowledge the safety check}"
: "${ROLLBACK_CHANGE_TICKET:?Set ROLLBACK_CHANGE_TICKET to an approved change identifier}"

if [[ "$HEALTHPOINT_ALLOW_0040_ROLLBACK_SAFETY_CHECK" != "true" ]]; then
  echo "HEALTHPOINT_ALLOW_0040_ROLLBACK_SAFETY_CHECK must equal true" >&2
  exit 2
fi
if [[ ! "$ROLLBACK_CHANGE_TICKET" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]{2,127}$ ]]; then
  echo "ROLLBACK_CHANGE_TICKET must be a nonempty approved change identifier" >&2
  exit 2
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for rollback safety validation" >&2
  exit 2
fi

DATABASE_NAME="$(node -e 'const u=new URL(process.argv[1]); console.log(decodeURIComponent(u.pathname.replace(/^\//,"")))' "$MIGRATION_ROLLBACK_DATABASE_URL")"
if [[ ! "$DATABASE_NAME" =~ (test|migration|ci|staging) ]]; then
  echo "Refusing destructive-rollback safety analysis for '$DATABASE_NAME'. Production CMS recovery requires a reviewed forward migration that preserves audit evidence." >&2
  exit 2
fi

RESULT="$(psql "$MIGRATION_ROLLBACK_DATABASE_URL" --set ON_ERROR_STOP=1 --tuples-only --no-align <<'SQL'
WITH schema_state AS (
  SELECT
    to_regclass('public.cms_submissions') IS NOT NULL AS submissions_table,
    to_regclass('public.cms_feedback_events') IS NOT NULL AS feedback_table,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'cms_submissions'
        AND column_name = 'pilotAuthorizationId'
    ) AS has_0040_columns
), evidence_state AS (
  SELECT
    COALESCE((SELECT count(*) FROM cms_submissions WHERE "pilotAuthorizationId" IS NOT NULL), 0) AS authorization_bound_handoffs,
    COALESCE((SELECT count(*) FROM cms_submissions WHERE "portalReceiptSha256" IS NOT NULL), 0) AS receipt_recorded_handoffs,
    COALESCE((SELECT count(*) FROM cms_feedback_events feedback
      JOIN cms_submissions submission
        ON submission."cmsReference" = feedback."cmsReference"
       AND submission."disputeId" = feedback."disputeId"
      WHERE submission."pilotAuthorizationId" IS NOT NULL), 0) AS receipt_bound_feedback
)
SELECT concat_ws('|',
  (SELECT submissions_table::text FROM schema_state),
  (SELECT feedback_table::text FROM schema_state),
  (SELECT has_0040_columns::text FROM schema_state),
  (SELECT authorization_bound_handoffs::text FROM evidence_state),
  (SELECT receipt_recorded_handoffs::text FROM evidence_state),
  (SELECT receipt_bound_feedback::text FROM evidence_state)
);
SQL
)"

IFS='|' read -r HAS_SUBMISSIONS HAS_FEEDBACK HAS_0040_COLUMNS BOUND_HANDOFFS RECEIPT_HANDOFFS BOUND_FEEDBACK <<<"$RESULT"

if [[ "$HAS_SUBMISSIONS" != "true" || "$HAS_FEEDBACK" != "true" || "$HAS_0040_COLUMNS" != "true" ]]; then
  echo "Migration 0040 schema is not fully present; do not attempt a down migration. Reconcile the canonical Drizzle journal first." >&2
  exit 2
fi
if (( BOUND_HANDOFFS > 0 || RECEIPT_HANDOFFS > 0 || BOUND_FEEDBACK > 0 )); then
  cat >&2 <<EOF
0040 schema reversal is blocked by durable CMS evidence:
  authorization-bound handoffs: $BOUND_HANDOFFS
  receipt-recorded handoffs: $RECEIPT_HANDOFFS
  receipt-bound feedback events: $BOUND_FEEDBACK

Do not drop 0040 columns, constraints, triggers, or indexes. Preserve the records,
disable the affected feature with a reviewed forward migration/configuration change,
and follow the incident/change-management record $ROLLBACK_CHANGE_TICKET.
EOF
  exit 3
fi

cat <<EOF
0040 rollback safety check passed for disposable database '$DATABASE_NAME'.
No authorization-bound handoffs, receipt-recorded handoffs, or receipt-bound feedback exist.

This result authorizes only a separately reviewed non-production schema-reset procedure.
It does not authorize deletion from drizzle.__drizzle_migrations and must not be used in production.
Change ticket: $ROLLBACK_CHANGE_TICKET
EOF
