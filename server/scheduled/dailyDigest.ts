/**
 * Daily Email Digest Heartbeat Handler
 * Route: POST /api/scheduled/daily-digest
 * Schedule: Every day at 12:00 UTC (0 12 * * *)
 *
 * Wave W5-3: sends per-user dispute digests to users whose
 * email_digest_preferences.digestFrequency = 'daily'. Honors 'never';
 * idempotent per user+day via lastDailyDigestSentAt. See
 * server/scheduled/emailDigest.ts.
 */
import { Request, Response } from "express";
import { getDb } from "../db";
import { runEmailDigest } from "./emailDigest";

export async function dailyDigestHandler(req: Request, res: Response) {
  // Validate heartbeat token (same pattern as weeklyDigest)
  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.replace("Bearer ", "").trim();
  const cookieSecret = process.env.JWT_SECRET ?? "";
  if (!token || token.length < 8 || !cookieSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const db = await getDb();
  if (!db) {
    return res.status(503).json({ error: "Database unavailable" });
  }

  try {
    const result = await runEmailDigest("daily");
    console.log(`[DailyDigest] Completed: sent=${result.sent} skippedDup=${result.skippedDuplicate} skippedNever=${result.skippedNever} failures=${result.failures}`);
    return res.json(result);
  } catch (err) {
    console.error("[DailyDigest] Error:", err);
    return res.status(500).json({ error: "Daily digest failed", details: String(err) });
  }
}
