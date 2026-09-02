-- Enforce the authorized human CMS portal handoff at the submission boundary.
-- Historical records are preserved by NOT VALID constraints; all new and changed
-- records must meet this contract. No API submission capability is introduced.

ALTER TABLE cms_submissions
  ADD COLUMN "pilotAuthorizationId" varchar(64)
    REFERENCES cms_pilot_authorizations(id) ON DELETE RESTRICT,
  ADD COLUMN "handoffOperatorId" varchar(128),
  ADD COLUMN "portalReceiptSha256" varchar(64),
  ADD COLUMN "portalReceiptRecordedBy" varchar(128),
  ADD COLUMN "portalReceiptReceivedAt" timestamptz;

CREATE INDEX cms_submissions_pilot_authorization_idx
  ON cms_submissions ("pilotAuthorizationId");
CREATE INDEX cms_submissions_handoff_operator_idx
  ON cms_submissions ("handoffOperatorId");

ALTER TABLE cms_submissions
  ADD CONSTRAINT cms_submissions_manual_handoff_shape_chk
  CHECK (
    "pilotAuthorizationId" IS NOT NULL
    AND "handoffOperatorId" IS NOT NULL
    AND (
      (
        status = 'pending'
        AND "cmsReference" IS NULL
        AND "portalReceiptSha256" IS NULL
        AND "portalReceiptRecordedBy" IS NULL
        AND "portalReceiptReceivedAt" IS NULL
      )
      OR
      (
        status IN ('acknowledged', 'rejected_validation')
        AND "cmsReference" IS NOT NULL
        AND "portalReceiptSha256" ~ '^[a-fA-F0-9]{64}$'
        AND "portalReceiptRecordedBy" IS NOT NULL
        AND "portalReceiptReceivedAt" IS NOT NULL
      )
    )
  ) NOT VALID;

CREATE OR REPLACE FUNCTION enforce_cms_manual_handoff_authorization()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  pilot_auth cms_pilot_authorizations%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'New CMS handoffs must begin as pending human portal work';
    END IF;
    SELECT * INTO pilot_auth
      FROM cms_pilot_authorizations
      WHERE id = NEW."pilotAuthorizationId";
    IF NOT FOUND
      OR pilot_auth.status <> 'approved'
      OR pilot_auth."stopDecision" <> 'proceed'
      OR pilot_auth."expiresAt" IS NULL
      OR pilot_auth."expiresAt" <= now() THEN
      RAISE EXCEPTION 'CMS handoff requires an active approved pilot authorization';
    END IF;
    IF pilot_auth."operatorId" <> NEW."handoffOperatorId" THEN
      RAISE EXCEPTION 'CMS handoff operator does not match pilot authorization';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."pilotAuthorizationId" IS DISTINCT FROM NEW."pilotAuthorizationId"
    OR OLD."handoffOperatorId" IS DISTINCT FROM NEW."handoffOperatorId"
    OR OLD."disputeId" IS DISTINCT FROM NEW."disputeId"
    OR OLD."idempotencyKey" IS DISTINCT FROM NEW."idempotencyKey"
    OR OLD."payloadHash" IS DISTINCT FROM NEW."payloadHash"
    OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt" THEN
    RAISE EXCEPTION 'CMS handoff identity, authorization, and payload fields are immutable';
  END IF;

  IF OLD.status <> 'pending' THEN
    IF OLD.status IS DISTINCT FROM NEW.status
      OR OLD."cmsReference" IS DISTINCT FROM NEW."cmsReference"
      OR OLD."portalReceiptSha256" IS DISTINCT FROM NEW."portalReceiptSha256"
      OR OLD."portalReceiptRecordedBy" IS DISTINCT FROM NEW."portalReceiptRecordedBy"
      OR OLD."portalReceiptReceivedAt" IS DISTINCT FROM NEW."portalReceiptReceivedAt" THEN
      RAISE EXCEPTION 'Recorded CMS portal receipt state is immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('acknowledged', 'rejected_validation') THEN
    RAISE EXCEPTION 'Pending CMS handoff may only transition after a human records a portal receipt';
  END IF;
  IF NEW."portalReceiptRecordedBy" <> NEW."handoffOperatorId" THEN
    RAISE EXCEPTION 'CMS portal receipt must be recorded by the authorized handoff operator';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cms_manual_handoff_authorization_trigger
  BEFORE INSERT OR UPDATE ON cms_submissions
  FOR EACH ROW EXECUTE FUNCTION enforce_cms_manual_handoff_authorization();

CREATE OR REPLACE FUNCTION reconcile_cms_manual_handoff_outbox()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'pending' AND NEW.status IN ('acknowledged', 'rejected_validation') THEN
    UPDATE cms_submission_outbox
      SET status = CASE WHEN NEW.status = 'acknowledged' THEN 'succeeded'::cms_outbox_status ELSE 'dead_letter'::cms_outbox_status END,
          "lockedAt" = NULL,
          "lockedBy" = NULL,
          "lastError" = CASE WHEN NEW.status = 'rejected_validation' THEN 'Human operator recorded portal rejection' ELSE NULL END,
          "updatedAt" = now()
      WHERE "submissionId" = NEW."submissionId";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cms_manual_handoff_outbox_reconciliation_trigger
  AFTER UPDATE ON cms_submissions
  FOR EACH ROW EXECUTE FUNCTION reconcile_cms_manual_handoff_outbox();

CREATE OR REPLACE FUNCTION enforce_cms_feedback_handoff_binding()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM cms_submissions submission
    WHERE submission."cmsReference" = NEW."cmsReference"
      AND submission."disputeId" = NEW."disputeId"
      AND submission.status IN ('acknowledged', 'rejected_validation')
  ) THEN
    RAISE EXCEPTION 'CMS feedback must bind to a receipt-recorded manual handoff';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cms_feedback_handoff_binding_trigger
  BEFORE INSERT ON cms_feedback_events
  FOR EACH ROW EXECUTE FUNCTION enforce_cms_feedback_handoff_binding();
