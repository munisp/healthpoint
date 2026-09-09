import { and, asc, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { eventLog } from "../drizzle/schema";
import { getDb } from "./db";
import { eventBus, type IDREvent, type IDREventType, type IDRTopic } from "./events/bus";

const MAX_RETRIES = 8;
const STALE_PROCESSING_MS = 5 * 60 * 1000;

export function nextOutboxAttempt(retryCount: number, now = new Date()): Date {
  const delayMs = Math.min(60_000 * 2 ** Math.min(retryCount, 8), 60 * 60 * 1000);
  return new Date(now.getTime() + delayMs);
}

function asEvent(row: typeof eventLog.$inferSelect): IDREvent {
  return {
    id: row.id,
    topic: row.topic as IDRTopic,
    eventType: row.eventType as IDREventType,
    aggregateId: row.aggregateId,
    aggregateType: row.aggregateType,
    payload: row.payload as Record<string, unknown>,
    metadata: row.metadata as IDREvent["metadata"],
  };
}

/**
 * Delivers pending events after their database transaction commits. Each row is
 * atomically claimed before dispatch, so multiple application instances provide
 * at-least-once delivery without concurrent duplicate dispatch by this worker.
 */
export async function dispatchOutboxBatch(limit = 25): Promise<{ claimed: number; delivered: number; failed: number }> {
  const db = await getDb();
  if (!db) return { claimed: 0, delivered: 0, failed: 0 };

  const now = new Date();
  const staleBefore = new Date(now.getTime() - STALE_PROCESSING_MS);
  // Recover work interrupted after it was claimed but before delivery completed.
  await db.update(eventLog)
    .set({ status: "failed", failureReason: "outbox worker lease expired", nextAttemptAt: now })
    .where(and(
      eq(eventLog.status, "processing"),
      lte(eventLog.lastAttemptAt, staleBefore),
      // Do not resurrect events that already exhausted their retry budget.
      lt(eventLog.retryCount, MAX_RETRIES),
    ));

  const candidates = await db.select().from(eventLog)
    .where(and(
      inArray(eventLog.status, ["pending", "failed"]),
      or(isNull(eventLog.nextAttemptAt), lte(eventLog.nextAttemptAt, now)),
      // Exhausted events (retryCount >= MAX_RETRIES) are terminal — their
      // nextAttemptAt is NULL, so without this guard they would be re-claimed
      // and re-dispatched forever.
      lt(eventLog.retryCount, MAX_RETRIES),
    ))
    .orderBy(asc(eventLog.createdAt))
    .limit(limit);

  const claimed: Array<typeof eventLog.$inferSelect> = [];
  for (const candidate of candidates) {
    const rows = await db.update(eventLog)
      .set({ status: "processing", lastAttemptAt: now, failureReason: null })
      .where(and(
        eq(eventLog.id, candidate.id),
        inArray(eventLog.status, ["pending", "failed"]),
        lt(eventLog.retryCount, MAX_RETRIES),
      ))
      .returning();
    if (rows[0]) claimed.push(rows[0]);
  }

  let delivered = 0;
  let failed = 0;
  for (const row of claimed) {
    try {
      await eventBus.deliverOutboxEvent(asEvent(row));
      await db.update(eventLog)
        .set({ status: "delivered", publishedAt: new Date(), failureReason: null, nextAttemptAt: null })
        .where(eq(eventLog.id, row.id));
      delivered++;
    } catch (error) {
      const retryCount = row.retryCount + 1;
      // On exhaustion the event becomes terminal: nextAttemptAt is cleared and
      // the retry-count guard in the claim query above permanently excludes it.
      await db.update(eventLog)
        .set({
          status: "failed",
          retryCount,
          failureReason: error instanceof Error ? error.message.slice(0, 2000) : "outbox delivery failed",
          nextAttemptAt: retryCount >= MAX_RETRIES ? null : nextOutboxAttempt(retryCount),
        })
        .where(eq(eventLog.id, row.id));
      failed++;
    }
  }
  return { claimed: claimed.length, delivered, failed };
}
