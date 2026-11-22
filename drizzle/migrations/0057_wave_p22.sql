-- Wave p22 (Phase 22): closing the learning loop.
--
--   * model_versions.model_kind: distinguishes the P21 segment-statistics
--     models ("segment_stats") from the new bandit governance snapshots
--     ("bandit") and the trained outcome model ("outcome_model"). Existing
--     rows backfilled to "segment_stats".
--   * bandit_assignments: one row per bandit-eligible offerStrategy.recommendV2
--     serve — the arm-selection fact. Rewards are attributed NIGHTLY by the
--     learning-loop refresh worker (never online on the offer accept/reject
--     payment paths). Dollar amounts are offer amounts already stored in
--     cleartext on disputes/dispute_offers — no new PHI surface.
--   * bandit_arm_stats: Beta(a,b) posterior state per org x segment x arm.
--     org_id is in the unique key: NO cross-org pooling (P21 counsel flag).
--   * ranking_stats: Bayesian-smoothed act-rate per item for the next-action
--     (S2) and quarantine-suggestion (S3) rankers. Full nightly recompute
--     from suggestion_events — no incremental state drift.
--   * outcome_model_predictions: append-only calibration log for
--     outcome-model-v2 predictions (the legacy outcome_predictions table is
--     delete+insert, no history). actual_* columns are joined nightly when
--     the determination lands.

ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS model_kind varchar(24) NOT NULL DEFAULT 'segment_stats';
--> statement-breakpoint
UPDATE model_versions SET model_kind = 'segment_stats' WHERE model_kind IS NULL OR model_name = 'offer-strategy-v2';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS bandit_assignments (
  id                varchar(64) PRIMARY KEY,
  org_id            varchar(64) NOT NULL,
  suggestion_id     varchar(64) NOT NULL,
  dispute_id        varchar(64) NOT NULL,
  user_id           varchar(64) NOT NULL,
  segment_tier      varchar(48) NOT NULL,
  segment_key       varchar(191) NOT NULL,
  arm_id            varchar(16) NOT NULL,
  baseline_usd      numeric(12,2) NOT NULL,
  served_usd        numeric(12,2) NOT NULL,
  model_version_id  varchar(64),
  exploration       boolean NOT NULL,
  outcome           varchar(16),
  outcome_at        timestamp,
  created_at        timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS bandit_assignments_suggestion_uniq ON bandit_assignments (suggestion_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bandit_assignments_org_segment_arm_idx ON bandit_assignments (org_id, segment_key, arm_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bandit_assignments_dispute_idx ON bandit_assignments (dispute_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bandit_assignments_pending_idx ON bandit_assignments (outcome) WHERE outcome IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bandit_assignments_org_created_idx ON bandit_assignments (org_id, created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS bandit_arm_stats (
  id            varchar(64) PRIMARY KEY,
  org_id        varchar(64) NOT NULL,
  segment_tier  varchar(48) NOT NULL,
  segment_key   varchar(191) NOT NULL,
  arm_id        varchar(16) NOT NULL,
  alpha         integer NOT NULL DEFAULT 1,
  beta          integer NOT NULL DEFAULT 1,
  pulls         integer NOT NULL DEFAULT 0,
  served        integer NOT NULL DEFAULT 0,
  updated_at    timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS bandit_arm_stats_uniq ON bandit_arm_stats (org_id, segment_tier, segment_key, arm_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS ranking_stats (
  id          varchar(64) PRIMARY KEY,
  org_id      varchar(64) NOT NULL,
  ranker      varchar(32) NOT NULL,
  item_key    varchar(191) NOT NULL,
  presented   integer NOT NULL DEFAULT 0,
  acts        integer NOT NULL DEFAULT 0,
  negatives   integer NOT NULL DEFAULT 0,
  updated_at  timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS ranking_stats_uniq ON ranking_stats (org_id, ranker, item_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ranking_stats_org_ranker_idx ON ranking_stats (org_id, ranker);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS outcome_model_predictions (
  id                      varchar(64) PRIMARY KEY,
  dispute_id              varchar(64) NOT NULL,
  model_version_id        varchar(64) NOT NULL,
  predicted_win_prob      numeric(5,4) NOT NULL,
  predicted_award_p25_usd numeric(12,2),
  predicted_award_p50_usd numeric(12,2),
  predicted_award_p75_usd numeric(12,2),
  segment_tier            varchar(48),
  segment_key             varchar(191),
  source                  varchar(16) NOT NULL,
  actual_winner           varchar(32),
  actual_amount_usd       numeric(12,2),
  actual_joined_at        timestamp,
  created_at              timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS outcome_model_predictions_dispute_idx ON outcome_model_predictions (dispute_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS outcome_model_predictions_pending_idx ON outcome_model_predictions (id) WHERE actual_winner IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS outcome_model_predictions_model_idx ON outcome_model_predictions (model_version_id);
