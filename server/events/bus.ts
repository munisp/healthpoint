/**
 * server/events/bus.ts
 * In-process event bus with a Kafka-compatible interface.
 *
 * Architecture:
 * - Events are persisted to the `event_log` PostgreSQL table (durable, replayable)
 * - In-process EventEmitter delivers events synchronously to registered consumers
 * - When KAFKA_BROKER_URL is set, events are also published to Kafka topics
 * - Consumers (audit writer, webhook dispatcher, outcome trigger) register here
 *
 * This design allows a zero-dependency dev environment while being drop-in
 * replaceable with a real Kafka producer/consumer when scaling.
 */

import { EventEmitter } from "events";
import fs from "fs";
import { Kafka, Producer, Partitioners, logLevel } from "kafkajs";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { eventLog } from "../../drizzle/schema";
import { publishNotification } from "../redis";

// ── Kafka producer (optional — gracefully skipped if KAFKA_BROKERS not set) ────

let _kafkaProducer: Producer | null = null;

async function getKafkaProducer(): Promise<Producer | null> {
  const brokers = process.env.KAFKA_BROKERS;
  if (!brokers) return null;
  if (_kafkaProducer) return _kafkaProducer;
  const username = process.env.KAFKA_SASL_USERNAME;
  const password = process.env.KAFKA_SASL_PASSWORD;
  const caPath = process.env.KAFKA_SSL_CA_PATH;
  const ca = process.env.KAFKA_SSL_CA_PEM ?? (caPath && fs.existsSync(caPath) ? fs.readFileSync(caPath, "utf8") : undefined);
  const production = process.env.NODE_ENV === "production";
  if (production && (!username || !password || !ca)) {
    console.error("[EventBus] Kafka is configured but TLS CA and SASL credentials are required in production");
    return null;
  }
  try {
    const kafka = new Kafka({
      clientId: "idr-app",
      brokers: brokers.split(","),
      logLevel: logLevel.WARN,
      retry: { initialRetryTime: 300, retries: 3 },
      ssl: ca ? { ca: [ca] } : production,
      sasl: username && password ? {
        mechanism: "scram-sha-512" as const,
        username,
        password,
      } : undefined,
    });
    _kafkaProducer = kafka.producer({
      createPartitioner: Partitioners.LegacyPartitioner,
      allowAutoTopicCreation: true,
    });
    await _kafkaProducer.connect();
    return _kafkaProducer;
  } catch (err) {
    console.warn("[EventBus] Kafka unavailable:", err);
    return null;
  }
}

// ── Event types ──────────────────────────────────────────────────────────────

export type IDREventType =
  | "dispute.created"
  | "dispute.advanced"
  | "dispute.closed"
  | "dispute.offer_submitted"
  | "dispute.arbitrator_selected"
  | "document.uploaded"
  | "document.analyzed"
  | "offer.accepted"
  | "offer.rejected"
  | "determination.issued"
  | "payment.recorded"
  | "payment.settled"
  | "payment.settlement_failed"
  | "notification.sent"
  | "webhook.triggered"
  | "audit.logged"
  | "user.login"
  | "user.logout";

export type IDRTopic =
  | "idr.disputes.state_changes"
  | "idr.documents"
  | "idr.offers"
  | "idr.payments"
  | "idr.notifications"
  | "idr.audit"
  | "idr.users";

const EVENT_TOPIC_MAP: Record<IDREventType, IDRTopic> = {
  "dispute.created": "idr.disputes.state_changes",
  "dispute.advanced": "idr.disputes.state_changes",
  "dispute.closed": "idr.disputes.state_changes",
  "dispute.offer_submitted": "idr.offers",
  "dispute.arbitrator_selected": "idr.disputes.state_changes",
  "document.uploaded": "idr.documents",
  "document.analyzed": "idr.documents",
  "offer.accepted": "idr.offers",
  "offer.rejected": "idr.offers",
  "determination.issued": "idr.disputes.state_changes",
  "payment.recorded": "idr.payments",
  "payment.settled": "idr.payments",
  "payment.settlement_failed": "idr.payments",
  "notification.sent": "idr.notifications",
  "webhook.triggered": "idr.notifications",
  "audit.logged": "idr.audit",
  "user.login": "idr.users",
  "user.logout": "idr.users",
};

export interface IDREvent<T = Record<string, unknown>> {
  id: string;
  topic: IDRTopic;
  eventType: IDREventType;
  aggregateId: string;    // e.g. disputeId
  aggregateType: string;  // e.g. "dispute"
  payload: T;
  metadata?: {
    userId?: string;
    correlationId?: string;
    timestamp: string;
    source?: string;
  };
}

// ── Bus singleton ─────────────────────────────────────────────────────────────

class IDREventBus extends EventEmitter {
  private static instance: IDREventBus;

  static getInstance(): IDREventBus {
    if (!IDREventBus.instance) {
      IDREventBus.instance = new IDREventBus();
      IDREventBus.instance.setMaxListeners(50);
    }
    return IDREventBus.instance;
  }

  /**
   * Publish an event to the bus.
   * - Persists to event_log table
   * - Emits to in-process consumers
   * - Publishes to Redis pub/sub for real-time UI notifications
   */
  async publish<T = Record<string, unknown>>(
    eventType: IDREventType,
    aggregateId: string,
    aggregateType: string,
    payload: T,
    metadata?: IDREvent["metadata"]
  ): Promise<IDREvent<T>> {
    const id = crypto.randomUUID();
    const topic = EVENT_TOPIC_MAP[eventType];
    const ts = new Date().toISOString();

    const event: IDREvent<T> = {
      id,
      topic,
      eventType,
      aggregateId,
      aggregateType,
      payload,
      metadata: {
        timestamp: ts,
        ...metadata,
      },
    };

    // 1. Persist to event_log before dispatch. Business transactions use the
    // same table as a transactional outbox and are dispatched after commit.
    await this.persistEvent(event);

    try {
      await this.deliverOutboxEvent(event);
      await this.markDelivered(event.id);
    } catch (error) {
      await this.markFailed(event.id, error);
    }
    return event;
  }

  /** Dispatches an already-persisted outbox event without writing a duplicate. */
  async deliverOutboxEvent<T = Record<string, unknown>>(event: IDREvent<T>): Promise<void> {
    // 1. Emit to in-process consumers
    this.emit(event.eventType, event);
    this.emit(event.topic, event);
    this.emit("*", event);

    // 2. Forward to Kafka for downstream services. Kafka failure leaves the
    // outbox event pending/failed for a later retry instead of being ignored.
    const producer = await getKafkaProducer();
    if (producer) {
      await producer.send({
        topic: event.topic,
        messages: [{
          key: event.aggregateId,
          value: JSON.stringify(event),
          headers: { "event-type": event.eventType, "source-service": "idr-app" },
        }],
      });
    }

    // 3. Redis notification is non-authoritative UI fan-out. Delivery failure
    // must not alter financial reconciliation state.
    publishNotification({
      type: event.eventType,
      disputeId: event.aggregateType === "dispute" ? event.aggregateId : undefined,
      message: `${event.eventType} — ${event.aggregateId}`,
      data: event.payload as Record<string, unknown>,
    }).catch(() => {});
  }

  private async persistEvent<T>(event: IDREvent<T>): Promise<void> {
    const db = await getDb();
    if (!db) return;

    try {
      await db.insert(eventLog).values({
        id: event.id,
        topic: event.topic,
        eventType: event.eventType,
        aggregateId: event.aggregateId,
        aggregateType: event.aggregateType,
        payload: event.payload as Record<string, unknown>,
        metadata: event.metadata as Record<string, unknown>,
        status: "pending",
        nextAttemptAt: new Date(),
      });
    } catch (err) {
      throw new Error(`Failed to persist event: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  private async markDelivered(eventId: string): Promise<void> {
    const db = await getDb();
    if (!db) return;
    await db.update(eventLog).set({ status: "delivered", publishedAt: new Date(), failureReason: null, nextAttemptAt: null })
      .where(eq(eventLog.id, eventId));
  }

  private async markFailed(eventId: string, error: unknown): Promise<void> {
    const db = await getDb();
    if (!db) return;
    await db.update(eventLog).set({
      status: "failed",
      retryCount: sql`${eventLog.retryCount} + 1`,
      lastAttemptAt: new Date(),
      failureReason: error instanceof Error ? error.message.slice(0, 2000) : "event delivery failed",
    }).where(eq(eventLog.id, eventId));
  }

  /**
   * Subscribe to a specific event type.
   */
  on(eventType: IDREventType | IDRTopic | "*", listener: (event: IDREvent) => void): this {
    return super.on(eventType, listener);
  }

  /**
   * Subscribe to a specific event type once.
   */
  once(eventType: IDREventType | IDRTopic | "*", listener: (event: IDREvent) => void): this {
    return super.once(eventType, listener);
  }
}

export const eventBus = IDREventBus.getInstance();

// ── Built-in consumers ────────────────────────────────────────────────────────

/**
 * Audit log consumer — writes all events to the audit_log table.
 * This replaces the need to manually call audit.log in every procedure.
 */
import { getDb as getDbForAudit } from "../db";
import { auditLog } from "../../drizzle/schema";

eventBus.on("*", async (event: IDREvent) => {
  const db = await getDbForAudit();
  if (!db) return;

  try {
    await db.insert(auditLog).values({
      id: crypto.randomUUID(),
      userId: event.metadata?.userId ?? "system",
      action: event.eventType,
      entityType: event.aggregateType,
      entityId: event.aggregateId,
      newValue: JSON.stringify(event.payload).slice(0, 2000),
      ipAddress: null,
      createdAt: new Date(),
    });
  } catch {
    // Audit log write failure is non-fatal
  }
});

/**
 * Webhook dispatcher consumer — fires outbound webhooks for subscribed events.
 */
import { dispatchWebhooksForEvent } from "../webhook-dispatcher";

eventBus.on("*", async (event: IDREvent) => {
  try {
    await dispatchWebhooksForEvent(event.eventType, event.aggregateId, event.payload as Record<string, unknown>);
  } catch {
    // Webhook dispatch failure is non-fatal
  }
});

/**
 * Outcome prediction trigger — regenerates predictions when dispute state changes.
 */
eventBus.on("dispute.advanced", async (event: IDREvent) => {
  // Trigger async prediction regeneration (fire-and-forget)
  setTimeout(async () => {
    try {
      const db = await getDb();
      if (!db) return;
      // Mark existing prediction as stale so it gets regenerated on next view
      const { outcomePredictions } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      await db.update(outcomePredictions)
        .set({ updatedAt: new Date() })
        .where(eq(outcomePredictions.disputeId, event.aggregateId));
    } catch {
      // Non-fatal
    }
  }, 100);
});
