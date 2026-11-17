-- Wave p23 (Phase 23): Apache DataSketches (KLL/HLL) adoption.
--
--   * outcome_segment_sketches: per-org × segment KLL double-sketch state
--     for outcome-model-v2 award quantiles. `sketch` is NULL whenever the
--     datasketches extension is absent/gated off or the segment is below
--     SKETCH_MIN_ROWS; `row_count` is ALWAYS exact. Refreshed nightly as a
--     full recompute (state derives from facts — ranking_stats precedent).
--
-- NO CREATE EXTENSION here: datasketches is not bundled with stock Postgres
-- and managed offerings (RDS/Cloud SQL) do not provide it. Capability is
-- discovered at runtime by probing pg_extension (server/idr/sketches.ts);
-- when absent every path falls back to exact aggregates. org_id is
-- varchar(64) with no FK — organizations.id is varchar(64) (the design
-- sketch's uuid+FK is not expressible against the real PK type).

CREATE TABLE IF NOT EXISTS outcome_segment_sketches (
  id          varchar(64) PRIMARY KEY,
  org_id      varchar(64) NOT NULL,
  segment_key varchar(191) NOT NULL,
  sketch      bytea,
  row_count   bigint NOT NULL DEFAULT 0,
  updated_at  timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS outcome_segment_sketches_uniq ON outcome_segment_sketches (org_id, segment_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS outcome_segment_sketches_segment_idx ON outcome_segment_sketches (segment_key);
