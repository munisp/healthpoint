-- Wave p21 (Phase 21): intelligence & learning loop.
--
--   * suggestion_events: immutable, PHI-free analytics facts for every
--     AI/learned suggestion (prefill field, quarantine-repair value, offer
--     recommendation, next-action card). Values are stored ONLY as sha256
--     hashes; context is a correlation hash. Dedicated table, NOT the
--     event_log outbox (design §2.1).
--   * suggestion_events_terminal_uniq: partial unique index on terminal
--     actions (accepted/edited/rejected) makes FE retry / offline-queue
--     replays idempotent — a replayed terminal event can never double-count.
--     COALESCE(field_name, '') so whole-suggestion events (no field) dedupe
--     exactly like per-field ones.
--   * model_versions: governance record for in-repo statistical models
--     (offer-strategy-v2). parameters holds AGGREGATE segment statistics
--     only; segments with n < 5 are suppressed before write (small-cell
--     suppression, HIPAA de-id safe-harbor analog). Never purged.
--   * next_action_dismissals: per-user next-action card dismissals with
--     expiry; purged by the retention worker on expires_at.

CREATE TABLE IF NOT EXISTS suggestion_events (
  id                    varchar(64) PRIMARY KEY,
  org_id                varchar(64) NOT NULL,
  user_id               varchar(64) NOT NULL,
  suggestion_id         varchar(64) NOT NULL,
  surface               varchar(48) NOT NULL,
  action                varchar(16) NOT NULL,
  model_name            varchar(64) NOT NULL,
  model_version_id      varchar(64),
  confidence            numeric(5,4),
  context_hash          varchar(64),
  field_name            varchar(64),
  suggested_value_hash  varchar(64),
  final_value_hash      varchar(64),
  keystroke_count       integer,
  latency_ms            integer,
  metadata              jsonb,
  created_at            timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS suggestion_events_org_surface_idx ON suggestion_events (org_id, surface, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS suggestion_events_suggestion_idx ON suggestion_events (suggestion_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS suggestion_events_model_idx ON suggestion_events (model_name, model_version_id);
--> statement-breakpoint
-- Idempotency: one terminal event per (suggestion, field, action).
CREATE UNIQUE INDEX IF NOT EXISTS suggestion_events_terminal_uniq
  ON suggestion_events (suggestion_id, COALESCE(field_name, ''), action)
  WHERE action IN ('accepted', 'edited', 'rejected');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS model_versions (
  id                    varchar(64) PRIMARY KEY,
  model_name            varchar(64) NOT NULL,
  version               integer NOT NULL,
  status                varchar(24) NOT NULL,
  trained_on            varchar(32) NOT NULL,
  training_sample_size  integer NOT NULL DEFAULT 0,
  segment_count         integer NOT NULL DEFAULT 0,
  honesty_label         varchar(32) NOT NULL,
  parameters            jsonb NOT NULL,
  trained_at            timestamp,
  activated_at          timestamp,
  created_at            timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS model_versions_name_version_idx ON model_versions (model_name, version);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS model_versions_name_status_idx ON model_versions (model_name, status);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS next_action_dismissals (
  id          varchar(64) PRIMARY KEY,
  org_id      varchar(64),
  user_id     varchar(64) NOT NULL,
  action_key  varchar(191) NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS next_action_dismissals_user_key_idx ON next_action_dismissals (user_id, action_key);
