DO $$ BEGIN
  CREATE TYPE cms_submission_status AS ENUM (
    'pending', 'submitted', 'acknowledged', 'rejected_validation',
    'accepted_pending_reconciliation', 'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cms_outbox_status AS ENUM (
    'pending', 'processing', 'succeeded', 'retryable', 'dead_letter'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS cms_submissions (
  "submissionId" varchar(64) PRIMARY KEY,
  "disputeId" varchar(64) NOT NULL,
  "idempotencyKey" varchar(191) NOT NULL,
  "payloadHash" varchar(64) NOT NULL,
  "status" cms_submission_status NOT NULL DEFAULT 'pending',
  "cmsReference" varchar(128),
  "attempts" integer NOT NULL DEFAULT 0,
  "lastError" text,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cms_submissions_dispute_idempotency_idx
  ON cms_submissions ("disputeId", "idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS cms_submissions_cms_reference_idx
  ON cms_submissions ("cmsReference") WHERE "cmsReference" IS NOT NULL;
CREATE INDEX IF NOT EXISTS cms_submissions_dispute_idx ON cms_submissions ("disputeId");
CREATE INDEX IF NOT EXISTS cms_submissions_status_idx ON cms_submissions ("status");

CREATE TABLE IF NOT EXISTS cms_submission_outbox (
  "outboxId" varchar(64) PRIMARY KEY,
  "submissionId" varchar(64) NOT NULL UNIQUE REFERENCES cms_submissions("submissionId") ON DELETE CASCADE,
  "disputeId" varchar(64) NOT NULL,
  "idempotencyKey" varchar(191) NOT NULL,
  "payload" jsonb NOT NULL,
  "status" cms_outbox_status NOT NULL DEFAULT 'pending',
  "attemptCount" integer NOT NULL DEFAULT 0,
  "availableAt" timestamp NOT NULL DEFAULT now(),
  "lockedAt" timestamp,
  "lockedBy" varchar(128),
  "lastError" text,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cms_outbox_claim_idx
  ON cms_submission_outbox ("status", "availableAt");
CREATE INDEX IF NOT EXISTS cms_outbox_lease_idx
  ON cms_submission_outbox ("status", "lockedAt");

CREATE TABLE IF NOT EXISTS cms_feedback_events (
  "eventId" varchar(128) PRIMARY KEY,
  "cmsReference" varchar(128) NOT NULL,
  "disputeId" varchar(64) NOT NULL,
  "type" varchar(64) NOT NULL,
  "occurredAt" timestamp NOT NULL,
  "keyId" varchar(128) NOT NULL,
  "payload" jsonb NOT NULL,
  "payloadHash" varchar(64) NOT NULL,
  "receivedAt" timestamp NOT NULL DEFAULT now(),
  "processedAt" timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS cms_feedback_reference_event_idx
  ON cms_feedback_events ("cmsReference", "eventId");
CREATE INDEX IF NOT EXISTS cms_feedback_dispute_idx ON cms_feedback_events ("disputeId");
CREATE INDEX IF NOT EXISTS cms_feedback_unprocessed_idx ON cms_feedback_events ("processedAt");
