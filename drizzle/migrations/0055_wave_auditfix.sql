-- Wave auditfix (A): durable persistence for the portal RPA driver and
-- settlement-callback replay protection.
--
--   * idr_portal_rpa_runs / idr_portal_rpa_checkpoints replace the module-scope
--     in-memory store/queue in server/idr/portal-rpa/routes.ts (audit finding:
--     runs, checkpoints and ownership were lost on process restart). Ownership
--     is folded into owner_user_id columns (was server/idr/portal-rpa/run-owners.ts
--     process-local maps).
--   * resume tokens are stored ONLY as sha256 hashes (never plaintext).
--   * idr_portal_rpa_runs.version implements CAS optimistic concurrency.
--   * settlement_callback_nonces rejects byte-identical replays of signed
--     /api/settlement/* callbacks inside the HMAC timestamp window.

CREATE TABLE IF NOT EXISTS idr_portal_rpa_runs (
  run_id             varchar(64) PRIMARY KEY,
  submission_id      varchar(128) NOT NULL,
  owner_user_id      varchar(128),
  status             varchar(32) NOT NULL,
  mode               varchar(8) NOT NULL,
  resume_token_hash  varchar(64),
  payload            jsonb NOT NULL,
  version            integer NOT NULL DEFAULT 1,
  created_at         timestamp NOT NULL DEFAULT now(),
  updated_at         timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idr_portal_rpa_runs_submission_idx ON idr_portal_rpa_runs (submission_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idr_portal_rpa_runs_owner_idx ON idr_portal_rpa_runs (owner_user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idr_portal_rpa_runs_status_idx ON idr_portal_rpa_runs (status);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idr_portal_rpa_runs_resume_token_hash_idx ON idr_portal_rpa_runs (resume_token_hash);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS idr_portal_rpa_checkpoints (
  checkpoint_id      varchar(64) PRIMARY KEY,
  run_id             varchar(64) NOT NULL REFERENCES idr_portal_rpa_runs(run_id) ON DELETE CASCADE,
  submission_id      varchar(128) NOT NULL,
  owner_user_id      varchar(128),
  checkpoint         jsonb NOT NULL,
  resume_token_hash  varchar(64),
  expires_at         timestamp NOT NULL,
  claimed_by         varchar(128),
  resolved_at        timestamp,
  resolution         jsonb,
  created_at         timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idr_portal_rpa_checkpoints_run_idx ON idr_portal_rpa_checkpoints (run_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idr_portal_rpa_checkpoints_submission_idx ON idr_portal_rpa_checkpoints (submission_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idr_portal_rpa_checkpoints_expires_idx ON idr_portal_rpa_checkpoints (expires_at);
--> statement-breakpoint
-- One live (unresolved) checkpoint per run; re-enqueue replaces the live entry.
CREATE UNIQUE INDEX IF NOT EXISTS idr_portal_rpa_checkpoints_live_run_idx ON idr_portal_rpa_checkpoints (run_id) WHERE resolved_at IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS settlement_callback_nonces (
  nonce       varchar(128) PRIMARY KEY,
  seen_at     timestamp NOT NULL DEFAULT now(),
  expires_at  timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS settlement_callback_nonces_expires_idx ON settlement_callback_nonces (expires_at);
