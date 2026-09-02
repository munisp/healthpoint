#!/usr/bin/env bash
set -Eeuo pipefail

: "${MIGRATION_TEST_DATABASE_URL:?Set MIGRATION_TEST_DATABASE_URL to a disposable PostgreSQL database}"
if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for release-control enforcement verification" >&2
  exit 2
fi

DATABASE_NAME="$(node -e 'const u=new URL(process.argv[1]); console.log(decodeURIComponent(u.pathname.replace(/^\//,"")))' "$MIGRATION_TEST_DATABASE_URL")"
if [[ ! "$DATABASE_NAME" =~ (test|migration|ci) ]]; then
  echo "Refusing database '$DATABASE_NAME'; a disposable test/migration/ci database is required" >&2
  exit 2
fi

psql "$MIGRATION_TEST_DATABASE_URL" --set ON_ERROR_STOP=1 <<'SQL'
BEGIN;

INSERT INTO model_data_use_approvals (
  id, "datasetId", "datasetSha256", "approvedPurpose", "approvedScope",
  "dataController", "privacyReviewerId", "legalReviewerId", status,
  "stopDecision", "stopDecisionReason", "retentionPolicyUri", "redactionMethod",
  "evidenceSha256", "approvedBy", "approvedAt", "expiresAt", "createdBy"
) VALUES (
  'data-use-control-verified', 'validation-dataset-1', repeat('a', 64),
  'model_validation', 'approved pilot cohort only', 'data-controller-1',
  'privacy-reviewer-1', 'legal-reviewer-1', 'approved', 'proceed',
  'approval is active and scope-bound', 's3://controlled/policy',
  'approved de-identification method', repeat('b', 64), 'approval-owner-1',
  now(), now() + interval '30 days', 'control-verifier'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO model_data_use_approvals (
      id, "datasetId", "datasetSha256", "approvedPurpose", "approvedScope",
      "dataController", "privacyReviewerId", "legalReviewerId", status,
      "stopDecision", "stopDecisionReason", "retentionPolicyUri", "redactionMethod",
      "evidenceSha256", "approvedBy", "approvedAt", "expiresAt", "createdBy"
    ) VALUES (
      'data-use-control-invalid-state', 'validation-dataset-2', repeat('c', 64),
      'model_validation', 'invalid', 'data-controller-1', 'privacy-reviewer-1',
      'legal-reviewer-1', 'approved', 'hold', 'must not proceed',
      's3://controlled/policy', 'approved method', repeat('d', 64),
      'approval-owner-1', now(), now() + interval '30 days', 'control-verifier'
    );
    RAISE EXCEPTION 'Expected invalid model data-use state to be rejected';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    UPDATE model_data_use_approvals
      SET "approvedScope" = 'mutated scope'
      WHERE id = 'data-use-control-verified';
    RAISE EXCEPTION 'Expected immutable model data-use scope update to be rejected';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%immutable%' THEN RAISE; END IF;
  END;
END $$;

INSERT INTO cms_pilot_authorizations (
  id, "approvedScope", "approvedBy", "operatorId",
  "operatorTrainingRecordSha256", "operatorTrainingRecordUri", "sopSha256", "sopUri",
  "escalationOwnerId", status, "stopDecision", "stopDecisionReason", "evidenceSha256",
  "approvedAt", "expiresAt", "createdBy"
) VALUES (
  'cms-pilot-control-verified', 'approved redacted pilot scope', 'pilot-approver-1',
  'operator-1', repeat('e', 64), 's3://controlled/training', repeat('f', 64),
  's3://controlled/sop', 'cms-ops-owner-1', 'approved', 'proceed',
  'pilot authorization is active', repeat('1', 64), now(), now() + interval '30 days',
  'control-verifier'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO cms_pilot_authorizations (
      id, "approvedScope", "approvedBy", "operatorId",
      "operatorTrainingRecordSha256", "operatorTrainingRecordUri", "sopSha256", "sopUri",
      "escalationOwnerId", status, "stopDecision", "stopDecisionReason", "evidenceSha256",
      "approvedAt", "expiresAt", "createdBy"
    ) VALUES (
      'cms-pilot-control-invalid-state', 'invalid pilot', 'pilot-approver-1', 'operator-1',
      repeat('2', 64), 's3://controlled/training', repeat('3', 64), 's3://controlled/sop',
      'cms-ops-owner-1', 'approved', 'hold', 'must not proceed', repeat('4', 64), now(),
      now() + interval '30 days', 'control-verifier'
    );
    RAISE EXCEPTION 'Expected invalid CMS pilot state to be rejected';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    UPDATE cms_pilot_authorizations
      SET "operatorId" = 'operator-2'
      WHERE id = 'cms-pilot-control-verified';
    RAISE EXCEPTION 'Expected immutable CMS operator update to be rejected';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%immutable%' THEN RAISE; END IF;
  END;
END $$;

INSERT INTO cms_submissions (
  "submissionId", "disputeId", "idempotencyKey", "payloadHash",
  "pilotAuthorizationId", "handoffOperatorId", status, attempts
) VALUES (
  'manual-handoff-control-verified', 'dispute-control-1', 'handoff-control-1', repeat('5', 64),
  'cms-pilot-control-verified', 'operator-1', 'pending', 0
);
INSERT INTO cms_submission_outbox (
  "outboxId", "submissionId", "disputeId", "idempotencyKey", payload, status,
  "attemptCount", "availableAt", "createdAt", "updatedAt"
) VALUES (
  'manual-handoff-outbox-control-verified', 'manual-handoff-control-verified',
  'dispute-control-1', 'handoff-control-1', '{"manualPortalActionRequired":true}'::jsonb,
  'pending', 0, now(), now(), now()
);

DO $$
BEGIN
  BEGIN
    INSERT INTO cms_submissions (
      "submissionId", "disputeId", "idempotencyKey", "payloadHash",
      "pilotAuthorizationId", "handoffOperatorId", status, attempts
    ) VALUES (
      'manual-handoff-control-wrong-operator', 'dispute-control-1', 'handoff-control-2', repeat('6', 64),
      'cms-pilot-control-verified', 'operator-2', 'pending', 0
    );
    RAISE EXCEPTION 'Expected mismatched CMS handoff operator to be rejected';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%operator does not match%' THEN RAISE; END IF;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    UPDATE cms_submissions
      SET status = 'submitted'
      WHERE "submissionId" = 'manual-handoff-control-verified';
    RAISE EXCEPTION 'Expected automatic CMS submission state to be rejected';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%only transition after a human records a portal receipt%' THEN RAISE; END IF;
  END;
END $$;

UPDATE cms_submissions
  SET status = 'acknowledged',
      "cmsReference" = 'cms-receipt-control-1',
      "portalReceiptSha256" = repeat('7', 64),
      "portalReceiptRecordedBy" = 'operator-1',
      "portalReceiptReceivedAt" = now(),
      attempts = 1
  WHERE "submissionId" = 'manual-handoff-control-verified';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cms_submission_outbox
    WHERE "submissionId" = 'manual-handoff-control-verified' AND status = 'succeeded'
  ) THEN
    RAISE EXCEPTION 'Expected receipt transition to reconcile the durable manual handoff outbox';
  END IF;
END $$;

DO $$
BEGIN
  BEGIN
    UPDATE cms_submissions
      SET "portalReceiptSha256" = repeat('8', 64)
      WHERE "submissionId" = 'manual-handoff-control-verified';
    RAISE EXCEPTION 'Expected immutable CMS receipt update to be rejected';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%receipt state is immutable%' THEN RAISE; END IF;
  END;
END $$;

INSERT INTO cms_feedback_events (
  "eventId", "cmsReference", "disputeId", type, "occurredAt", "keyId", payload, "payloadHash"
) VALUES (
  'cms-feedback-control-verified', 'cms-receipt-control-1', 'dispute-control-1',
  'determination', now(), 'manual-verification-control', '{"status":"verified"}'::jsonb, repeat('9', 64)
);

DO $$
BEGIN
  BEGIN
    INSERT INTO cms_feedback_events (
      "eventId", "cmsReference", "disputeId", type, "occurredAt", "keyId", payload, "payloadHash"
    ) VALUES (
      'cms-feedback-control-unbound', 'cms-receipt-unbound', 'dispute-control-1',
      'determination', now(), 'manual-verification-control', '{"status":"unverified"}'::jsonb, repeat('a', 64)
    );
    RAISE EXCEPTION 'Expected unbound CMS feedback to be rejected';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%receipt-recorded manual handoff%' THEN RAISE; END IF;
  END;
END $$;

SELECT 'data_use_approval_db_enforcement=passed';
SELECT 'cms_pilot_authorization_db_enforcement=passed';
SELECT 'cms_manual_handoff_db_enforcement=passed';
SELECT 'cms_manual_handoff_outbox_reconciliation=passed';
SELECT 'cms_feedback_binding_db_enforcement=passed';
ROLLBACK;
SQL
