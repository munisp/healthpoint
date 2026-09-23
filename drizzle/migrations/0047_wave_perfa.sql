-- phase14-perfa: composite/covering indexes for the proven hot read paths
-- (disputes list scoped by party + createdAt ordering, dashboard status
-- aggregates, unread-notification count, dispute detail child timelines).
-- All statements are idempotent (IF NOT EXISTS) and add no constraints, so
-- they are safe to apply online on a live database.
-- NOTE: at the seed/bench scale (60 disputes / ~170 notifications) the
-- planner still chooses seq scans (verified via EXPLAIN ANALYZE); these
-- indexes are preventative for production-scale tables.

-- disputes.list (non-admin scope): WHERE initiatingPartyId = ? OR createdBy = ?
-- ORDER BY "createdAt" DESC LIMIT/OFFSET
CREATE INDEX IF NOT EXISTS "disputes_initiating_createdAt_idx"
  ON "disputes" ("initiatingPartyId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "disputes_createdBy_createdAt_idx"
  ON "disputes" ("createdBy", "createdAt" DESC);

-- disputes.list status filter + dashboard status aggregates
CREATE INDEX IF NOT EXISTS "disputes_status_createdAt_idx"
  ON "disputes" ("status", "createdAt" DESC);

-- dashboard outcomeAnalytics / cohortAnalysis:
-- WHERE "determinationWinner" IS NOT NULL (partial covering index)
CREATE INDEX IF NOT EXISTS "disputes_determinationWinner_partial_idx"
  ON "disputes" ("serviceType", "determinationWinner", "determinationAmount", "billedAmount")
  WHERE "determinationWinner" IS NOT NULL;

-- dashboard.stats unread count: WHERE "userId" = ? AND "isRead" = false
-- (previously two single-column indexes notif_user_idx / notif_read_idx)
CREATE INDEX IF NOT EXISTS "notif_user_read_idx"
  ON "notifications" ("userId", "isRead");

-- disputes.getById child timelines: WHERE "disputeId" = ? ORDER BY created/…
CREATE INDEX IF NOT EXISTS "events_dispute_created_idx"
  ON "dispute_events" ("disputeId", "createdAt");
CREATE INDEX IF NOT EXISTS "offers_dispute_submitted_idx"
  ON "dispute_offers" ("disputeId", "submittedAt");
CREATE INDEX IF NOT EXISTS "docs_dispute_uploaded_idx"
  ON "dispute_documents" ("disputeId", "uploadedAt");
