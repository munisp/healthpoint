-- Wave p27 (Phase 26 Stream B, RLS wave 1): roles, grants, helper functions
-- for Postgres Row-Level Security. BINDING design: phase-26-rls-design.md.
--
-- DEVIATION FROM DESIGN (file naming): the design reserved journal idx 60 for
-- Stream A and named this stream's files 0061_wave_p26_rls_*. Stream A has
-- since landed 0060_wave_p26, so this wave uses the _wave_p27_rls_ tag to
-- avoid two streams sharing one wave tag. Journal idx 61-66 as designed.
--
-- Contents:
--   * hp_app role (LOGIN, NOSUPERUSER, NOBYPASSRLS — both are Postgres
--     defaults; stated explicitly for auditability). Owns NO tables.
--   * app_current_orgs() / app_current_user() / app_service_mode() — STABLE,
--     LANGUAGE SQL helper functions read by every wave-1 policy (design §3.1).
--     current_setting(..., true) yields '' when unset -> NULL -> fail-closed.
--   * GRANT SELECT/INSERT/UPDATE/DELETE on the 23 wave-1 tables to hp_app.
--
-- RUNBOOK (deployment):
--   1. Password is NOT set here — migrations must not embed secrets:
--        ALTER ROLE hp_app PASSWORD '<from secrets manager>';
--   2. GRANT hp_app TO <migration/owner role>;  (enables SET LOCAL ROLE hp_app
--      for audit-mode shadow probes, design §6.2).
--   3. Production DATABASE_URL / RLS_DATABASE_URL must point at NON-superuser
--      roles; superusers bypass RLS unconditionally (FORCE included).
--   4. Backups (pg_dump) must run as superuser or a pre-FORCE role — a
--      non-superuser dump under FORCE is RLS-filtered (design R11).
--
-- REVERT (manual; this repo has no down migrations — run in this order):
--   -- (0066/0065/0064/0063/0062 reverts first: policies and FORCE/ENABLE
--   --  must be gone before the role can be dropped)
--   DROP FUNCTION IF EXISTS app_current_orgs();
--   DROP FUNCTION IF EXISTS app_current_user();
--   DROP FUNCTION IF EXISTS app_service_mode();
--   -- Grants must be revoked in EVERY database where 0061 ran (roles are
--   -- cluster-global; DROP ROLE fails while any grant depends on it — the
--   -- desired safety ordering, design §6.4):
--   REVOKE SELECT, INSERT, UPDATE, DELETE ON
--     practice_claims, practice_claim_scores, remittance_835_files, remittance_lines,
--     manual_check_postings, bulk_upload_sessions, bulk_upload_chunks, claim_quarantine,
--     suggestion_events, next_action_dismissals, bandit_assignments, bandit_arm_stats,
--     ranking_stats, outcome_segment_sketches,
--     organizations, org_memberships, invite_tokens, api_keys, audit_share_tokens,
--     submitter_clients, delegation_attestations, submitter_invoices, submitter_invoice_lines
--   FROM hp_app;
--   REVOKE USAGE ON SCHEMA public FROM hp_app;
--   DROP ROLE IF EXISTS hp_app;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hp_app') THEN
    CREATE ROLE hp_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_current_orgs() RETURNS text[]
  LANGUAGE sql STABLE AS $$
    SELECT string_to_array(nullif(current_setting('app.current_orgs', true), ''), ',')
  $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_current_user() RETURNS text
  LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('app.current_user', true), '')
  $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_service_mode() RETURNS boolean
  LANGUAGE sql STABLE AS $$
    SELECT current_setting('app.service_mode', true) = 'on'
  $$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO hp_app;
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON
  practice_claims, practice_claim_scores, remittance_835_files, remittance_lines,
  manual_check_postings, bulk_upload_sessions, bulk_upload_chunks, claim_quarantine,
  suggestion_events, next_action_dismissals, bandit_assignments, bandit_arm_stats,
  ranking_stats, outcome_segment_sketches,
  organizations, org_memberships, invite_tokens, api_keys, audit_share_tokens,
  submitter_clients, delegation_attestations, submitter_invoices, submitter_invoice_lines
TO hp_app;
