-- wave-w1 (statutory P1 remediation, assurance/remediation-2026-09-05)
--
-- W1-F1: dispute WITHDRAWAL — 'withdrawn' dispute_status label plus the
-- terminal FSM step STEP_20_DISPUTE_WITHDRAWN (reachable from any
-- pre-determination step with a mandatory withdrawalReason).
ALTER TYPE "dispute_status" ADD VALUE IF NOT EXISTS 'withdrawn';
--> statement-breakpoint
ALTER TYPE "idr_step" ADD VALUE IF NOT EXISTS 'STEP_20_DISPUTE_WITHDRAWN';
--> statement-breakpoint
-- W1-F8 (45 CFR 149.140(c)(3)): per-service-code first-seen tracking so the
-- 90-day new-service-code window is computable. One row per service code;
-- firstSeenDate is the earliest ingestion day observed for the code.
CREATE TABLE IF NOT EXISTS "qpa_service_code_first_seen" (
	"serviceCode" varchar(16) PRIMARY KEY NOT NULL,
	"firstSeenDate" varchar(10) NOT NULL,
	"batchId" varchar(64) NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
