-- Wave p27 (RLS wave 1), batch A — PHI claims/remittance (design §1.3 tier A,
-- policy templates §3.2/§3.5). One policy per table, FOR ALL, WITH CHECK so
-- cross-org WRITES fail loudly (42501) instead of writing invisible rows.
--
-- DEVIATION FROM DESIGN (policy role target): the design's binding SQL says
-- `FOR ALL TO hp_app`, but design R4 simultaneously requires owner-connected
-- scripts / Temporal journeys to function under FORCE via app.service_mode.
-- Under FORCE, a policy scoped TO hp_app does not apply to the table owner at
-- all, so the owner would be default-denied and the service-mode GUC could
-- never take effect — the two requirements contradict. Resolved fail-safe:
-- policies are `TO PUBLIC` (deny-by-default for EVERY role unless the org GUC
-- matches or service mode is set). No role gains access it did not already
-- have via GRANTs; hp_app and the owner are equally constrained.
--
-- Tables (5): practice_claims ("orgId"), practice_claim_scores (EXISTS via
-- "claimId"), remittance_835_files ("orgId"), remittance_lines (EXISTS via
-- "fileId"), manual_check_postings ("orgId"). Index guard: none needed — all
-- org/FK columns already indexed (design §0.2/§5.1, verified against
-- information_schema at implementation time).
--
-- REVERT:
--   ALTER TABLE practice_claims NO FORCE ROW LEVEL SECURITY;  -- no-op if 0066 not applied
--   DROP POLICY IF EXISTS org_isolation ON practice_claims;
--   DROP POLICY IF EXISTS org_isolation ON practice_claim_scores;
--   DROP POLICY IF EXISTS org_isolation ON remittance_835_files;
--   DROP POLICY IF EXISTS org_isolation ON remittance_lines;
--   DROP POLICY IF EXISTS org_isolation ON manual_check_postings;
--   ALTER TABLE practice_claims DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE practice_claim_scores DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE remittance_835_files DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE remittance_lines DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE manual_check_postings DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation ON practice_claims;
--> statement-breakpoint
CREATE POLICY org_isolation ON practice_claims
  FOR ALL TO PUBLIC
  USING ( "orgId" = ANY (app_current_orgs()) OR app_service_mode() )
  WITH CHECK ( "orgId" = ANY (app_current_orgs()) OR app_service_mode() );
--> statement-breakpoint
ALTER TABLE practice_claims ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS org_isolation ON practice_claim_scores;
--> statement-breakpoint
CREATE POLICY org_isolation ON practice_claim_scores
  FOR ALL TO PUBLIC
  USING ( EXISTS (SELECT 1 FROM practice_claims c
                  WHERE c.id = practice_claim_scores."claimId"
                    AND c."orgId" = ANY (app_current_orgs()))
          OR app_service_mode() )
  WITH CHECK ( EXISTS (SELECT 1 FROM practice_claims c
                  WHERE c.id = practice_claim_scores."claimId"
                    AND c."orgId" = ANY (app_current_orgs()))
          OR app_service_mode() );
--> statement-breakpoint
ALTER TABLE practice_claim_scores ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS org_isolation ON remittance_835_files;
--> statement-breakpoint
CREATE POLICY org_isolation ON remittance_835_files
  FOR ALL TO PUBLIC
  USING ( "orgId" = ANY (app_current_orgs()) OR app_service_mode() )
  WITH CHECK ( "orgId" = ANY (app_current_orgs()) OR app_service_mode() );
--> statement-breakpoint
ALTER TABLE remittance_835_files ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS org_isolation ON remittance_lines;
--> statement-breakpoint
CREATE POLICY org_isolation ON remittance_lines
  FOR ALL TO PUBLIC
  USING ( EXISTS (SELECT 1 FROM remittance_835_files f
                  WHERE f.id = remittance_lines."fileId"
                    AND f."orgId" = ANY (app_current_orgs()))
          OR app_service_mode() )
  WITH CHECK ( EXISTS (SELECT 1 FROM remittance_835_files f
                  WHERE f.id = remittance_lines."fileId"
                    AND f."orgId" = ANY (app_current_orgs()))
          OR app_service_mode() );
--> statement-breakpoint
ALTER TABLE remittance_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS org_isolation ON manual_check_postings;
--> statement-breakpoint
CREATE POLICY org_isolation ON manual_check_postings
  FOR ALL TO PUBLIC
  USING ( "orgId" = ANY (app_current_orgs()) OR app_service_mode() )
  WITH CHECK ( "orgId" = ANY (app_current_orgs()) OR app_service_mode() );
--> statement-breakpoint
ALTER TABLE manual_check_postings ENABLE ROW LEVEL SECURITY;
