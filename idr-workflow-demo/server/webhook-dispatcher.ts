/**
 * server/webhook-dispatcher.ts
 * Dispatches outbound webhooks for IDR events with HMAC-SHA256 signing.
 * Called by the event bus consumer for every published event.
 */

import crypto from "crypto";
import { getDb } from "./db";
import { webhooks } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

type WebhookRow = {
  id: string;
  url: string;
  secret: string;
  events: string; // stored as JSON string in DB
  status: "active" | "paused" | "failed";
  failureCount: number;
};

/**
 * Dispatch webhooks for a given event type and payload.
 * Finds all active webhooks subscribed to this event and POSTs to each.
 */
export async function dispatchWebhooksForEvent(
  eventType: string,
  aggregateId: string,
  payload: Record<string, unknown>,
  eventId: string = crypto.randomUUID(),
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Webhook dispatch requires PostgreSQL");

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
  } catch (error) {
    throw new Error(`Unable to load active webhook subscriptions: ${error instanceof Error ? error.message : "unknown database error"}`);
  }

  if (!activeWebhooks.length) return;

  const body = JSON.stringify({
    id: eventId,
    event: eventType,
    aggregateId,
    timestamp: new Date().toISOString(),
    data: payload,
  });

  await Promise.all(
    activeWebhooks.map(webhook => deliverWebhook(webhook, body, eventType))
  );
}

async function deliverWebhook(webhook: WebhookRow, body: string, eventType: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Webhook delivery requires PostgreSQL");

  // HMAC-SHA256 signature
  const signature = crypto
    .createHmac("sha256", webhook.secret)
    .update(body)
    .digest("hex");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-HealthPoint-Signature": `sha256=${signature}`,
        "X-HealthPoint-Event": eventType,
        "User-Agent": "HealthPoint-Webhooks/1.0",
      },
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    // Reset failure count on success
    await db.update(webhooks)
      .set({ failureCount: 0, lastTriggeredAt: new Date() })
      .where(eq(webhooks.id, webhook.id));
  } catch (err) {
    const newCount = (webhook.failureCount ?? 0) + 1;
    const updates: Record<string, unknown> = {
      failureCount: newCount,
      lastTriggeredAt: new Date(),
    };

    // Auto-disable after 10 consecutive failures
    if (newCount >= 10) {
      updates.status = "failed";
      console.warn(`[Webhooks] Marked webhook ${webhook.id} failed after ${newCount} failures`);
    }

    await db.update(webhooks)
      .set(updates)
      .where(eq(webhooks.id, webhook.id));
  } finally {
    clearTimeout(timeout);
  }
}
