/**
 * server/webhook-dispatcher.ts
 * Dispatches outbound webhooks for IDR events with HMAC-SHA256 signing.
 * Called by the event bus consumer for every published event.
 *
 * W3 remediation (ops reliability):
 *  - Every delivery is persisted in webhook_deliveries BEFORE the first
 *    attempt, so failures are never invisible and manual replay reuses the
 *    same delivery row (idempotent — no fresh random-id duplicates).
 *  - Retry with bounded exponential backoff: attempts at 0 / 1m / 5m / 15m /
 *    1h. After the schedule is exhausted the delivery is terminally `failed`.
 *    The retry scan lives in server/scheduled/webhookRetryWorker.ts.
 *  - X-HealthPoint-Event carries the event TYPE only (never the full body).
 *  - Auto-disable writes the real schema column: webhooks.status = 'failed'
 *    (the previous code wrote a non-existent `active` column).
 *  - Every attempt records status code, error, durationMs and nextRetryAt.
 *    durationMs is a migration column (0039_wave_w3.sql) written via raw SQL
 *    because drizzle/schema.ts is owned by another wave.
 */

import crypto from "crypto";
import { getDb } from "./db";
import { webhooks, webhookDeliveries } from "../drizzle/schema";
import { eq, sql } from "drizzle-orm";

type WebhookRow = {
  id: string;
  url: string;
  secret: string;
  events: string; // stored as JSON string in DB
  status: "active" | "paused" | "failed";
  failureCount: number;
};

/** Delay schedule in ms: attempt 1 immediate, then 1m, 5m, 15m, 1h. */
export const WEBHOOK_RETRY_SCHEDULE_MS = [0, 60_000, 300_000, 900_000, 3_600_000] as const;

/** Max consecutive delivery failures before a webhook is auto-disabled. */
export const WEBHOOK_AUTO_DISABLE_THRESHOLD = 10;

/**
 * Next retry time for the attempt that just failed (1-based attempt number).
 * Returns null when the retry schedule is exhausted (terminal failure).
 */
export function computeNextRetryAt(attempts: number, now = new Date()): Date | null {
  // attempts is the count of attempts already made; index into the schedule.
  const delay = WEBHOOK_RETRY_SCHEDULE_MS[attempts] ?? null;
  if (delay === null || delay === undefined) return null;
  return new Date(now.getTime() + delay);
}

/**
 * Dispatch webhooks for a given event type and payload.
 * Finds all active webhooks subscribed to this event, creates a
 * webhook_deliveries row for each, and performs the first attempt inline.
 */
export async function dispatchWebhooksForEvent(
  eventType: string,
  aggregateId: string,
  payload: Record<string, unknown>
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  let activeWebhooks: WebhookRow[];
  try {
    const rows = await db
      .select()
      .from(webhooks)
      .where(eq(webhooks.status, "active"));

    // Filter to those subscribed to this event type
    activeWebhooks = (rows as WebhookRow[]).filter(w => {
      let events: string[] = [];
      try { events = JSON.parse(w.events); } catch { events = []; }
      return events.includes(eventType) || events.includes("*");
    });
  } catch {
    return;
  }

  if (!activeWebhooks.length) return;

  const body = JSON.stringify({
    id: crypto.randomUUID(),
    event: eventType,
    aggregateId,
    timestamp: new Date().toISOString(),
    data: payload,
  });

  await Promise.allSettled(
    activeWebhooks.map(async webhook => {
      // Persist the delivery first so every attempt is auditable and the
      // retry worker / manual replay share the same delivery row.
      let deliveryId: string;
      try {
        deliveryId = crypto.randomUUID();
        await db.insert(webhookDeliveries).values({
          id: deliveryId,
          webhookId: webhook.id,
          eventType,
          payload: body,
          status: "pending",
          attempts: 0,
        });
      } catch (err) {
        console.warn(`[Webhooks] Failed to persist delivery for webhook ${webhook.id}:`, err);
        return;
      }
      await attemptDelivery(deliveryId);
    })
  );
}

type DeliveryRow = {
  id: string;
  webhookId: string;
  eventType: string;
  payload: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
};

/**
 * Perform a single delivery attempt for a persisted delivery row and record
 * the outcome (status, HTTP status code, error, durationMs, nextRetryAt).
 * Shared by first-attempt dispatch, the scheduled retry worker, and manual
 * replay — replay therefore reuses delivery-id semantics and never creates
 * duplicate deliveries with fresh random ids.
 */
export async function attemptDelivery(deliveryId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const [delivery] = (await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.id, deliveryId))
    .limit(1)) as DeliveryRow[];
  if (!delivery || delivery.status === "delivered") return;

  const [webhook] = (await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.id, delivery.webhookId))
    .limit(1)) as WebhookRow[];
  if (!webhook || webhook.status !== "active") return;

  const body = delivery.payload;

  // HMAC-SHA256 signature
  const signature = crypto
    .createHmac("sha256", webhook.secret)
    .update(body)
    .digest("hex");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  const attempts = (delivery.attempts ?? 0) + 1;
  const startedAt = Date.now();
  let responseStatus: number | null = null;
  let errorMessage: string | null = null;
  let delivered = false;

  try {
    const response = await fetch(webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-HealthPoint-Signature": `sha256=${signature}`,
        // Event TYPE only — the full body must never leak into a header.
        "X-HealthPoint-Event": delivery.eventType,
        "User-Agent": "HealthPoint-Webhooks/1.0",
      },
      body,
      signal: controller.signal,
    });
    responseStatus = response.status;
    if (!response.ok) {
      errorMessage = `HTTP ${response.status}`;
    } else {
      delivered = true;
    }
  } catch (err: any) {
    errorMessage = err?.message ?? String(err);
  } finally {
    clearTimeout(timeout);
  }
  const durationMs = Date.now() - startedAt;
  const now = new Date();
  const nextRetryAt = delivered ? null : computeNextRetryAt(attempts, now);
  const terminalFailed = !delivered && nextRetryAt === null;
  const newStatus = delivered ? "delivered" : terminalFailed ? "failed" : "pending";

  // Record the attempt on the delivery row. durationMs comes from migration
  // 0039 (raw SQL — see file header); the rest maps to schema columns.
  try {
    await db.update(webhookDeliveries)
      .set({
        attempts,
        lastAttemptAt: now,
        nextRetryAt,
        status: newStatus,
        responseStatus,
        errorMessage,
      })
      .where(eq(webhookDeliveries.id, delivery.id));
    await db.execute(sql`
      UPDATE webhook_deliveries SET "durationMs" = ${durationMs} WHERE id = ${delivery.id}
    `);
  } catch (err) {
    console.warn(`[Webhooks] Failed to record attempt for delivery ${delivery.id}:`, err);
  }

  // Maintain the webhook-level failure counter / auto-disable.
  const webhookUpdates: Record<string, unknown> = { lastTriggeredAt: now };
  if (delivered) {
    webhookUpdates.failureCount = 0;
  } else {
    const newCount = (webhook.failureCount ?? 0) + 1;
    webhookUpdates.failureCount = newCount;
    // Auto-disable after 10 consecutive failures — write the real column.
    if (newCount >= WEBHOOK_AUTO_DISABLE_THRESHOLD) {
      webhookUpdates.status = "failed";
      console.warn(`[Webhooks] Disabled webhook ${webhook.id} after ${newCount} consecutive failures`);
    }
  }
  try {
    await db.update(webhooks)
      .set(webhookUpdates)
      .where(eq(webhooks.id, webhook.id));
  } catch {
    // Non-fatal
  }
}

/**
 * Scan webhook_deliveries for pending retries whose nextRetryAt is due and
 * re-attempt them. Invoked by the scheduled worker
 * (server/scheduled/webhookRetryWorker.ts). Bounded batch to keep the
 * invocation short.
 */
export async function processWebhookRetries(limit = 100): Promise<{ attempted: number }> {
  const db = await getDb();
  if (!db) return { attempted: 0 };

  const now = new Date();
  const due = (await db
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(sql`${webhookDeliveries.status} = 'pending' AND ${webhookDeliveries.nextRetryAt} IS NOT NULL AND ${webhookDeliveries.nextRetryAt} <= ${now}`)
    .limit(limit)) as Array<{ id: string }>;

  let attempted = 0;
  for (const row of due) {
    await attemptDelivery(row.id);
    attempted += 1;
  }
  return { attempted };
}
