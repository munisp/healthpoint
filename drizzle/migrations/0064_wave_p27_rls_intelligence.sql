-- Wave p27 (RLS wave 1), batch C — intelligence org tables (design §1.3 tier
-- C, templates §3.2/§3.3). These tables are also legitimately read ACROSS orgs
-- by the nightly learning loop (design §0.5) — that path is the service-mode
-- clause, NOT a cross-org read policy (design §3.8: none created in wave 1).
--
-- Tables (6): suggestion_events, bandit_assignments, bandit_arm_stats,
-- ranking_stats, outcome_segment_sketches (org_id NOT NULL), and
-- next_action_dismissals (org_id NULLABLE — null-org rows are legacy/
-- user-scoped and pinned to the owning user, never visible org-wide).
-- Role target is TO PUBLIC — see the deviation note in
-- 0062_wave_p27_rls_claims.sql.
--
-- Index guard (design §5.1): next_action_dismissals(org_id) had NO org-leading
-- index (verified against pg_indexes); enforced reads would seq-scan without
-- it. Created here, idempotently.
--
-- REVERT:
--   DROP POLICY IF EXISTS org_isolation ON suggestion_events;
--   DROP POLICY IF EXISTS org_isolation ON next_action_dismissals;
--   DROP POLICY IF EXISTS org_isolation ON bandit_assignments;
--   DROP POLICY IF EXISTS org_isolation ON bandit_arm_stats;
--   DROP POLICY IF EXISTS org_isolation ON ranking_stats;
--   DROP POLICY IF EXISTS org_isolation ON outcome_segment_sketches;
--   ALTER TABLE suggestion_events DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE next_action_dismissals DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE bandit_assignments DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE bandit_arm_stats DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE ranking_stats DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE outcome_segment_sketches DISABLE ROW LEVEL SECURITY;
--   DROP INDEX IF EXISTS next_action_dismissals_org_idx;

CREATE INDEX IF NOT EXISTS next_action_dismissals_org_idx ON next_action_dismissals (org_id);
--> statement-breakpoint

DROP POLICY IF EXISTS org_isolation ON suggestion_events;
--> statement-breakpoint
CREATE POLICY org_isolation ON suggestion_events
  FOR ALL TO PUBLIC
  USING ( org_id = ANY (app_current_orgs()) OR app_service_mode() )
  WITH CHECK ( org_id = ANY (app_current_orgs()) OR app_service_mode() );
--> statement-breakpoint
ALTER TABLE suggestion_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS org_isolation ON next_action_dismissals;
--> statement-breakpoint
CREATE POLICY org_isolation ON next_action_dismissals
  FOR ALL TO PUBLIC
  USING ( org_id = ANY (app_current_orgs())
          OR user_id = app_current_user()
          OR app_service_mode() )
  WITH CHECK ( org_id = ANY (app_current_orgs())
          OR user_id = app_current_user()
          OR app_service_mode() );
--> statement-breakpoint
ALTER TABLE next_action_dismissals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS org_isolation ON bandit_assignments;
--> statement-breakpoint
CREATE POLICY org_isolation ON bandit_assignments
  FOR ALL TO PUBLIC
  USING ( org_id = ANY (app_current_orgs()) OR app_service_mode() )
  WITH CHECK ( org_id = ANY (app_current_orgs()) OR app_service_mode() );
--> statement-breakpoint
ALTER TABLE bandit_assignments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS org_isolation ON bandit_arm_stats;
--> statement-breakpoint
CREATE POLICY org_isolation ON bandit_arm_stats
  FOR ALL TO PUBLIC
  USING ( org_id = ANY (app_current_orgs()) OR app_service_mode() )
  WITH CHECK ( org_id = ANY (app_current_orgs()) OR app_service_mode() );
--> statement-breakpoint
ALTER TABLE bandit_arm_stats ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS org_isolation ON ranking_stats;
--> statement-breakpoint
CREATE POLICY org_isolation ON ranking_stats
  FOR ALL TO PUBLIC
  USING ( org_id = ANY (app_current_orgs()) OR app_service_mode() )
  WITH CHECK ( org_id = ANY (app_current_orgs()) OR app_service_mode() );
--> statement-breakpoint
ALTER TABLE ranking_stats ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS org_isolation ON outcome_segment_sketches;
--> statement-breakpoint
CREATE POLICY org_isolation ON outcome_segment_sketches
  FOR ALL TO PUBLIC
  USING ( org_id = ANY (app_current_orgs()) OR app_service_mode() )
  WITH CHECK ( org_id = ANY (app_current_orgs()) OR app_service_mode() );
--> statement-breakpoint
ALTER TABLE outcome_segment_sketches ENABLE ROW LEVEL SECURITY;
