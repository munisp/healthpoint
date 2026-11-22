-- Wave p27 (RLS wave 1), batch B — ingest pipeline (design §1.3 tier B,
-- templates §3.2/§3.5). bulk_upload_chunks holds raw claim PHI as bytea; the
-- P24 cross-tenant finding was in this pipeline (design §1.1 T1).
--
-- Tables (3): bulk_upload_sessions (org_id), bulk_upload_chunks (EXISTS via
-- session_id), claim_quarantine (org_id). Role target is TO PUBLIC — see the
-- deviation note in 0062_wave_p27_rls_claims.sql.
--
-- REVERT:
--   DROP POLICY IF EXISTS org_isolation ON bulk_upload_sessions;
--   DROP POLICY IF EXISTS org_isolation ON bulk_upload_chunks;
--   DROP POLICY IF EXISTS org_isolation ON claim_quarantine;
--   ALTER TABLE bulk_upload_sessions DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE bulk_upload_chunks DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE claim_quarantine DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation ON bulk_upload_sessions;
--> statement-breakpoint
CREATE POLICY org_isolation ON bulk_upload_sessions
  FOR ALL TO PUBLIC
  USING ( org_id = ANY (app_current_orgs()) OR app_service_mode() )
  WITH CHECK ( org_id = ANY (app_current_orgs()) OR app_service_mode() );
--> statement-breakpoint
ALTER TABLE bulk_upload_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS org_isolation ON bulk_upload_chunks;
--> statement-breakpoint
CREATE POLICY org_isolation ON bulk_upload_chunks
  FOR ALL TO PUBLIC
  USING ( EXISTS (SELECT 1 FROM bulk_upload_sessions s
                  WHERE s.id = bulk_upload_chunks.session_id
                    AND s.org_id = ANY (app_current_orgs()))
          OR app_service_mode() )
  WITH CHECK ( EXISTS (SELECT 1 FROM bulk_upload_sessions s
                  WHERE s.id = bulk_upload_chunks.session_id
                    AND s.org_id = ANY (app_current_orgs()))
          OR app_service_mode() );
--> statement-breakpoint
ALTER TABLE bulk_upload_chunks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS org_isolation ON claim_quarantine;
--> statement-breakpoint
CREATE POLICY org_isolation ON claim_quarantine
  FOR ALL TO PUBLIC
  USING ( org_id = ANY (app_current_orgs()) OR app_service_mode() )
  WITH CHECK ( org_id = ANY (app_current_orgs()) OR app_service_mode() );
--> statement-breakpoint
ALTER TABLE claim_quarantine ENABLE ROW LEVEL SECURITY;
