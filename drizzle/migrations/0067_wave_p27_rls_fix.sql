-- Wave p27 fix wave (adversarial-review findings F-6/F-7) — policy holes in
-- the pushed 0064/0065. Append-only fix migration: 0064/0065 are NOT edited
-- (already deployed); the fixes are DROP POLICY IF EXISTS + CREATE POLICY
-- replacements, matching the wave style. Idempotent; safe to re-run.
-- Role targets stay TO PUBLIC — see the deviation note in
-- 0062_wave_p27_rls_claims.sql.
--
-- F-6 (next_action_dismissals WITH CHECK): the 0064 check allowed
-- `user_id = app_current_user()` UNCONDITIONALLY, so any user could plant
-- dismissal rows carrying an arbitrary org_id (reviewer repro: user-a
-- inserted org_id='org-b' rows). The user clause now applies ONLY to
-- null-org (legacy/user-scoped) rows; org-bound rows must satisfy the org
-- check. USING is unchanged: reading one's own dismissal rows across orgs
-- is intended self-read behavior.
--
-- F-7 (organizations DELETE): 0064/0065 left DELETE governed only by the
-- permissive org_isolation USING clause, so any member (viewer included)
-- could DELETE their own org row and orphan every child row (reviewer
-- repro). Adds a RESTRICTIVE service-only DELETE policy — DELETE now
-- requires app.service_mode on top of the permissive clause.
--
-- REVERT:
--   DROP POLICY IF EXISTS organizations_service_delete ON organizations;
--   DROP POLICY IF EXISTS org_isolation ON next_action_dismissals;
--   CREATE POLICY org_isolation ON next_action_dismissals
--     FOR ALL TO PUBLIC
--     USING ( org_id = ANY (app_current_orgs())
--             OR user_id = app_current_user()
--             OR app_service_mode() )
--     WITH CHECK ( org_id = ANY (app_current_orgs())
--             OR user_id = app_current_user()
--             OR app_service_mode() );

DROP POLICY IF EXISTS org_isolation ON next_action_dismissals;
--> statement-breakpoint
CREATE POLICY org_isolation ON next_action_dismissals
  FOR ALL TO PUBLIC
  USING ( org_id = ANY (app_current_orgs())
          OR user_id = app_current_user()
          OR app_service_mode() )
  WITH CHECK ( (org_id IS NOT NULL AND org_id = ANY (app_current_orgs()))
          OR (org_id IS NULL AND user_id = app_current_user())
          OR app_service_mode() );
--> statement-breakpoint

DROP POLICY IF EXISTS organizations_service_delete ON organizations;
--> statement-breakpoint
CREATE POLICY organizations_service_delete ON organizations
  AS RESTRICTIVE
  FOR DELETE TO PUBLIC
  USING ( app_service_mode() );
