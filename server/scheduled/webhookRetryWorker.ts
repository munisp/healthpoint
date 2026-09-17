/**
 * Webhook Retry Worker
 * Route: POST /api/scheduled/webhook-retry
 * Schedule: every minute (* * * * *)
 *
 * Scans webhook_deliveries for pending rows whose nextRetryAt is due and
 * re-attempts delivery using the shared delivery path in
 * server/webhook-dispatcher.ts (attempts at 0/1m/5m/15m/1h, then terminal
 * `failed`). Manual replay (webhookReplay.replay/replayAll) requeues the
 * same delivery row, so it flows through this worker too — no duplicate
 * deliveries with fresh random ids.
 *
 * Auth: scheduledAuth (platform cron identity or bearer SCHEDULED_SECRET).
 */

import { Request, Response } from "express";
import { processWebhookRetries } from "../webhook-dispatcher";

export async function webhookRetryWorkerHandler(req: Request, res: Response) {
  try {
    const { attempted } = await processWebhookRetries();
    res.json({ ok: true, attempted });
  } catch (err: any) {
    console.error("[webhook-retry] worker failed:", err);
    res.status(500).json({ ok: false, error: err?.message ?? String(err) });
  }
}
