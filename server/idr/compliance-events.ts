/**
 * server/idr/compliance-events.ts
 * Shared audit/outbox emission for IDR compliance events (deadline alerts,
 * fee assessments, attestations).
 *
 * Why not eventBus.publish()? The bus's IDREventType union is owned by
 * server/events/bus.ts, which is outside this change's scope. Instead we
 * write the SAME two tables the bus maintains:
 *   - audit_log        — the durable HIPAA audit record (45 CFR § 164.312(b))
 *   - event_log (pending) — the transactional outbox; the outbox worker
 *     (server/outbox.ts → server/outbox-worker.ts) claims and delivers any
 *     pending row to in-process consumers, Kafka, and Redis notification
 *     fan-out, so downstream delivery semantics are identical to bus events.
 * An optional deterministic idempotencyKey uses the event_log unique index
 * so retried schedulers never double-emit.
 */

import { getDb } from "../db";
import { auditLog, eventLog } from "../../drizzle/schema";

export type ComplianceEventType =
  | "deadline.warning"
  | "deadline.overdue"
  | "fee.assessed"
  | "fee.payment_status_changed"
  | "attestation.recorded"
  | "attestation.superseded";

export interface ComplianceEvent {
  eventType: ComplianceEventType;
  aggregateId: string; // e.g. disputeId
  aggregateType: string; // "dispute" | "fee_assessment" | "attestation"
  topic: "idr.notifications" | "idr.audit" | "idr.payments";
  payload: Record<string, unknown>;
  userId?: string;
  idempotencyKey?: string;
}

/**
 * Write the audit record and queue the outbox event. Returns the event id,
 * or null when the event was already emitted (idempotency key conflict).
 * Never throws on audit failure — matches the bus consumer's non-fatal
 * posture — but outbox insert conflicts are caught and reported as null.
 */
export async function emitComplianceEvent(evt: ComplianceEvent): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const id = crypto.randomUUID();
  const now = new Date();

  try {
    await db.insert(auditLog).values({
      id: crypto.randomUUID(),
      userId: evt.userId ?? "system",
      action: evt.eventType,
      entityType: evt.aggregateType,
      entityId: evt.aggregateId,
      newValue: JSON.stringify(evt.payload).slice(0, 2000),
      ipAddress: null,
      createdAt: now,
    });
  } catch {
    // Audit write failure is non-fatal (mirrors server/events/bus.ts consumer)
  }

  try {
    await db.insert(eventLog).values({
      id,
      topic: evt.topic,
      eventType: evt.eventType,
      aggregateId: evt.aggregateId,
      aggregateType: evt.aggregateType,
      payload: evt.payload,
      metadata: { timestamp: now.toISOString(), source: "idr-compliance", userId: evt.userId },
      idempotencyKey: evt.idempotencyKey,
      status: "pending",
      nextAttemptAt: now,
    });
    return id;
  } catch (err) {
    // Unique-conflict on idempotencyKey → already emitted; treat as dedupe.
    if (evt.idempotencyKey && err instanceof Error && /duplicate|unique/i.test(err.message)) {
      return null;
    }
    throw err;
  }
}
