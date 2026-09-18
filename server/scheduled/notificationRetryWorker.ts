/**
 * Notification Retry Worker
 * Route: POST /api/scheduled/notification-retry
 * Schedule: every 5 minutes (*‍/5 * * * *)
 *
 * Drains the notification_attempts outbox: failed email/SMS deliveries
 * (statutory deadline alerts must not be silently lost) are re-attempted
 * with bounded backoff (1m/5m/15m/1h/4h) then marked terminally failed.
 *
 * Auth: scheduledAuth (platform cron identity or bearer SCHEDULED_SECRET).
 */

import { Request, Response } from "express";
import { processNotificationRetries } from "../notifications";

export async function notificationRetryWorkerHandler(req: Request, res: Response) {
  try {
    const { attempted } = await processNotificationRetries();
    res.json({ ok: true, attempted });
  } catch (err: any) {
    console.error("[notification-retry] worker failed:", err);
    res.status(500).json({ ok: false, error: err?.message ?? String(err) });
  }
}
