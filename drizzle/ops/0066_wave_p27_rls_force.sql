-- Wave p27 (RLS wave 1), FINAL batch — FORCE ROW LEVEL SECURITY on all 23
-- wave-1 tables (design §2.3, §4.2). Separated from policy creation so it is
-- independently reversible: without FORCE the table owner bypasses RLS, and
-- the owner is exactly what scripts/*.mts and the Temporal journey worker
-- connect as — those paths would remain unenforced holes. FORCE governs DML
-- only; owner DDL is unaffected.
--
-- ⚠ OPS-GATED, MANUAL APPLY ONLY — this file is deliberately NOT in
-- drizzle/migrations/ and NOT in meta/_journal.json (fix F-1: the first
-- standard `drizzle-kit migrate` deploy would otherwise FORCE all 23 org
-- tables while every request path still connects as the table owner and
-- RLS_ENABLED=off, taking them down: SELECT → 0 rows / writes → 42501).
-- Applying this file is the "enforce" go decision.
--
-- ── PRE-APPLY CHECKLIST (all must hold) ─────────────────────────────────
--  1. 7-day staging soak with RLS_ENABLED=audit: 0 rls_shadow_diff audit
--     rows AND 0 orphan rows from the daily scanOrgOrphans worker
--     (audit_log action 'rls_orphan_scan'), covering a full
--     learningLoopRefresh/retentionWorker cycle and a J01-J36 journey pass.
--  2. hp_app runbook complete (0061 header): password issued via the
--     secrets manager, RLS_DATABASE_URL set to the hp_app connection, and
--     `GRANT hp_app TO <owner role>` executed so orgMemberships membership
--     verification keeps working under service contexts.
--  3. RLS_ENABLED=enforce staged and ready to roll with this deploy.
--
-- ── APPLY (psql, as a superuser or table owner) ─────────────────────────
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/ops/0066_wave_p27_rls_force.sql
-- The statement-breakpoint comment markers below are drizzle-kit artifacts;
-- psql treats them as comments. Idempotent — safe to re-run (FORCE is a
-- no-op when already forced).
--
-- ── REVERT (full) ───────────────────────────────────────────────────────
--   ALTER TABLE <each of the 23 tables> NO FORCE ROW LEVEL SECURITY;
-- (policies stay in place; audit mode remains functional). Per-tier
-- rollback granularity (design §6.3 step 5): comment out the tiers that
-- must stay un-FORCEd and re-run — statements are idempotent.

-- Tier A
ALTER TABLE practice_claims FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE practice_claim_scores FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE remittance_835_files FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE remittance_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE manual_check_postings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Tier B
ALTER TABLE bulk_upload_sessions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bulk_upload_chunks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE claim_quarantine FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Tier C
ALTER TABLE suggestion_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE next_action_dismissals FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bandit_assignments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bandit_arm_stats FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ranking_stats FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE outcome_segment_sketches FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Tier D
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE org_memberships FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invite_tokens FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_share_tokens FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE submitter_clients FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE delegation_attestations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE submitter_invoices FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE submitter_invoice_lines FORCE ROW LEVEL SECURITY;
