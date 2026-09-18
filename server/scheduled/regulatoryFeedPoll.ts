/**
 * Regulatory Feed Poll — STUB HOOK (wave W5-2)
 * Route: POST /api/scheduled/regulatory-feed-poll
 * Intended schedule: every 6 hours (cron: "0 star-slash-6 star star star" — every 6th hour)
 *
 * FUTURE: poll CMS/HHS sources for NSA/IDR regulatory updates and call the
 * same dedupe-ingest path as `regulatoryFeed.ingest` (dedupe key:
 * (source, title, effectiveDate→publishedAt-day)). Candidate sources:
 *   - https://www.cms.gov/newsroom (RSS)
 *   - https://www.cms.gov/nosurprises (IDR notices page)
 *   - Federal Register API: https://www.federalregister.gov/api/v1/documents.json?conditions[term]=independent+dispute+resolution
 *
 * This stub is intentionally a no-op until a source-of-record adapter is
 * implemented and approved; it exists so the scheduler wiring and ops
 * runbook can be finalized ahead of the adapter. Returns processed:false
 * with a machine-readable reason.
 */
import { Request, Response } from "express";

export async function regulatoryFeedPollHandler(_req: Request, res: Response) {
  return res.json({
    processed: false,
    reason: "stub: CMS/HHS feed adapter not yet implemented — see module docstring in server/scheduled/regulatoryFeedPoll.ts",
  });
}
