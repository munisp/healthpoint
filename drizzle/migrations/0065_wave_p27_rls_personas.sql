-- Wave p27 (RLS wave 1), batch D — tenancy machinery (design §1.3 tier D;
-- templates §3.3 nullable-org, §3.6 two-org, §3.7 bootstrap-safe). Enforced
-- LAST, after audit mode proves clean on tiers A-C, because these tables
-- couple to bootstrap (org_memberships self-read makes withOrgContext's
-- membership verification legal under enforcement), invites, and bearer auth.
-- Role target is TO PUBLIC — see the deviation note in
-- 0062_wave_p27_rls_claims.sql.
--
-- Tables (9): organizations, org_memberships, invite_tokens, api_keys,
-- audit_share_tokens, submitter_clients, delegation_attestations,
-- submitter_invoices, submitter_invoice_lines.
--
-- Index guard (design §5.1): invite_tokens("orgId") had NO org index
-- (verified against pg_indexes); created here, idempotently.
--
-- REVERT:
--   DROP POLICY IF EXISTS org_isolation ON organizations;
--   DROP POLICY IF EXISTS org_isolation ON org_memberships;
--   DROP POLICY IF EXISTS org_isolation ON invite_tokens;
--   DROP POLICY IF EXISTS org_isolation ON api_keys;
--   DROP POLICY IF EXISTS org_isolation ON audit_share_tokens;
--   DROP POLICY IF EXISTS org_isolation ON submitter_clients;
--   DROP POLICY IF EXISTS org_isolation ON delegation_attestations;
--   DROP POLICY IF EXISTS org_isolation ON submitter_invoices;
--   DROP POLICY IF EXISTS org_isolation ON submitter_invoice_lines;
--   ALTER TABLE organizations DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE org_memberships DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE invite_tokens DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE api_keys DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE audit_share_tokens DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE submitter_clients DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE delegation_attestations DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE submitter_invoices DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE submitter_invoice_lines DISABLE ROW LEVEL SECURITY;
--   DROP INDEX IF EXISTS invite_tokens_org_idx;

CREATE INDEX IF NOT EXISTS invite_tokens_org_idx ON invite_tokens ("orgId");
--> statement-breakpoint

-- organizations: members may read their own orgs' rows; writes stay
-- service-mode (org creation/suspension are admin/service flows).
DROP POLICY IF EXISTS org_isolation ON organizations;
--> statement-breakpoint
CREATE POLICY org_isolation ON organizations
  FOR ALL TO PUBLIC
  USING ( id = ANY (app_current_orgs()) OR app_service_mode() )
  WITH CHECK ( app_service_mode() );
--> statement-breakpoint
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- org_memberships: a user can always read THEIR OWN membership rows (this is
-- what makes withOrgContext's bootstrap query legal under enforcement), plus
-- rows of orgs in context. Writes require org context or service mode.
DROP POLICY IF EXISTS org_isolation ON org_memberships;
--> statement-breakpoint
CREATE POLICY org_isolation ON org_memberships
  FOR ALL TO PUBLIC
  USING ( "userId" = app_current_user() OR "orgId" = ANY (app_current_orgs()) OR app_service_mode() )
  WITH CHECK ( "orgId" = ANY (app_current_orgs()) OR app_service_mode() );
--> statement-breakpoint
ALTER TABLE org_memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- invite_tokens ("orgId" NULL for payer_invite purpose): read by org context
-- or by the inviting user; writes are service-mode only. Rationale (design
-- §3.3): invite ACCEPTANCE looks rows up by tokenHash before the acceptor has
-- any membership; that path is bearer-token-authorized by the token itself
-- and must run under withServiceContext('invite-accept').
DROP POLICY IF EXISTS org_isolation ON invite_tokens;
--> statement-breakpoint
CREATE POLICY org_isolation ON invite_tokens
  FOR ALL TO PUBLIC
  USING ( "orgId" = ANY (app_current_orgs())
          OR "invitedByUserId" = app_current_user()
          OR app_service_mode() )
  WITH CHECK ( app_service_mode() );
--> statement-breakpoint
ALTER TABLE invite_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- api_keys ("orgId" NULL for legacy pre-org-binding keys): legacy NULL-org
-- rows stay readable by their owning user; new keys MUST be org-bound
-- (matches the documented contract at drizzle/schema.ts apiKeys).
DROP POLICY IF EXISTS org_isolation ON api_keys;
--> statement-breakpoint
CREATE POLICY org_isolation ON api_keys
  FOR ALL TO PUBLIC
  USING ( "orgId" = ANY (app_current_orgs())
          OR ("orgId" IS NULL AND "userId" = app_current_user())
          OR app_service_mode() )
  WITH CHECK ( "orgId" IS NOT NULL AND ("orgId" = ANY (app_current_orgs()) OR app_service_mode()) );
--> statement-breakpoint
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS org_isolation ON audit_share_tokens;
--> statement-breakpoint
CREATE POLICY org_isolation ON audit_share_tokens
  FOR ALL TO PUBLIC
  USING ( "orgId" = ANY (app_current_orgs()) OR app_service_mode() )
  WITH CHECK ( "orgId" = ANY (app_current_orgs()) OR app_service_mode() );
--> statement-breakpoint
ALTER TABLE audit_share_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- submitter_clients links a biller org and a provider org (design §3.6):
-- visible from EITHER side; writes anchored on the submitter side (row
-- creator). clientOrgId is nullable (pending acceptance) — NULL = ANY(...) is
-- NULL, so pending rows are read-visible only via the submitter side.
DROP POLICY IF EXISTS org_isolation ON submitter_clients;
--> statement-breakpoint
CREATE POLICY org_isolation ON submitter_clients
  FOR ALL TO PUBLIC
  USING ( "submitterOrgId" = ANY (app_current_orgs())
          OR "clientOrgId"   = ANY (app_current_orgs())
          OR app_service_mode() )
  WITH CHECK ( "submitterOrgId" = ANY (app_current_orgs()) OR app_service_mode() );
--> statement-breakpoint
ALTER TABLE submitter_clients ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Child tables of submitter_clients: EXISTS with the dual-org predicate
-- inlined for reads; writes anchored on the submitter side (design §3.6).
DROP POLICY IF EXISTS org_isolation ON delegation_attestations;
--> statement-breakpoint
CREATE POLICY org_isolation ON delegation_attestations
  FOR ALL TO PUBLIC
  USING ( EXISTS (SELECT 1 FROM submitter_clients sc
                  WHERE sc.id = delegation_attestations."submitterClientId"
                    AND ( sc."submitterOrgId" = ANY (app_current_orgs())
                          OR sc."clientOrgId" = ANY (app_current_orgs()) ))
          OR app_service_mode() )
  WITH CHECK ( EXISTS (SELECT 1 FROM submitter_clients sc
                  WHERE sc.id = delegation_attestations."submitterClientId"
                    AND sc."submitterOrgId" = ANY (app_current_orgs()))
          OR app_service_mode() );
--> statement-breakpoint
ALTER TABLE delegation_attestations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS org_isolation ON submitter_invoices;
--> statement-breakpoint
CREATE POLICY org_isolation ON submitter_invoices
  FOR ALL TO PUBLIC
  USING ( EXISTS (SELECT 1 FROM submitter_clients sc
                  WHERE sc.id = submitter_invoices."submitterClientId"
                    AND ( sc."submitterOrgId" = ANY (app_current_orgs())
                          OR sc."clientOrgId" = ANY (app_current_orgs()) ))
          OR app_service_mode() )
  WITH CHECK ( EXISTS (SELECT 1 FROM submitter_clients sc
                  WHERE sc.id = submitter_invoices."submitterClientId"
                    AND sc."submitterOrgId" = ANY (app_current_orgs()))
          OR app_service_mode() );
--> statement-breakpoint
ALTER TABLE submitter_invoices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS org_isolation ON submitter_invoice_lines;
--> statement-breakpoint
CREATE POLICY org_isolation ON submitter_invoice_lines
  FOR ALL TO PUBLIC
  USING ( EXISTS (SELECT 1 FROM submitter_invoices si
                  JOIN submitter_clients sc ON sc.id = si."submitterClientId"
                  WHERE si.id = submitter_invoice_lines."invoiceId"
                    AND ( sc."submitterOrgId" = ANY (app_current_orgs())
                          OR sc."clientOrgId" = ANY (app_current_orgs()) ))
          OR app_service_mode() )
  WITH CHECK ( EXISTS (SELECT 1 FROM submitter_invoices si
                  JOIN submitter_clients sc ON sc.id = si."submitterClientId"
                  WHERE si.id = submitter_invoice_lines."invoiceId"
                    AND sc."submitterOrgId" = ANY (app_current_orgs()))
          OR app_service_mode() );
--> statement-breakpoint
ALTER TABLE submitter_invoice_lines ENABLE ROW LEVEL SECURITY;
