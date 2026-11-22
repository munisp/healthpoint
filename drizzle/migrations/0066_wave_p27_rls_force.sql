-- Wave p27 (RLS wave 1), FINAL batch — FORCE ROW LEVEL SECURITY on all 23
-- wave-1 tables (design §2.3, §4.2). Separated from policy creation so it is
-- independently reversible: without FORCE the table owner bypasses RLS, and
-- the owner is exactly what scripts/*.mts and the Temporal journey worker
-- connect as — those paths would remain unenforced holes. FORCE governs DML
-- only; owner DDL is unaffected.
--
-- SHIPS ONLY AFTER the design §6.3 audit exit criteria are met (0
-- rls_shadow_diff events and 0 orphan rows over a 7-day staging soak covering
-- a full learningLoopRefresh/retentionWorker cycle and a J01-J36 journey
-- pass). Activating this migration is the "enforce" go decision.
--
-- Per-tier rollback granularity (design §6.3 step 5): comment out the tiers
-- that must stay un-FORCEd and re-run — statements are idempotent.
--
-- REVERT (full):
--   ALTER TABLE <each of the 23 tables> NO FORCE ROW LEVEL SECURITY;
-- (policies stay in place; audit mode remains functional)

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
