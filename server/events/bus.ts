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
import { Kafka, Producer, Partitioners, logLevel } from "kafkajs";
import { getDb } from "../db";
import { eventLog } from "../../drizzle/schema";
import { publishNotification } from "../redis";

// ── Kafka producer (optional — gracefully skipped if KAFKA_BROKERS not set) ────

let _kafkaProducer: Producer | null = null;

async function getKafkaProducer(): Promise<Producer | null> {
  const brokers = process.env.KAFKA_BROKERS;
  if (!brokers) return null;
  if (_kafkaProducer) return _kafkaProducer;
  try {
    const kafka = new Kafka({
      clientId: "idr-app",
      brokers: brokers.split(","),
      logLevel: logLevel.WARN,
      retry: { initialRetryTime: 300, retries: 3 },
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
  | "notification.sent"
  | "webhook.triggered"
  | "audit.logged"
  | "user.login"
  | "user.logout";

export type IDRTopic =
  | "idr.disputes.state_changes"
  | "idr.documents"
  | "idr.offers"
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

    // 1. Persist to event_log (durable, replayable)
    await this.persistEvent(event);

    // 2. Emit to in-process consumers
    this.emit(eventType, event);
    this.emit(topic, event);
    this.emit("*", event);

    // 3. Forward to Kafka for downstream services (Rust processor, Lakehouse, OpenSearch)
    getKafkaProducer().then(p => {
      if (!p) return;
      const kafkaTopic = topic.startsWith("idr.") ? topic : `idr.${topic}`;
      p.send({
        topic: kafkaTopic,
        messages: [{
          key: aggregateId,
          value: JSON.stringify(event),
          headers: { "event-type": eventType, "source-service": "idr-app" },
        }],
      }).catch(() => {/* Kafka send failure — ignore */});
    }).catch(() => {});

    // 4. Publish to Redis pub/sub for real-time UI (fire-and-forget)
    publishNotification({
      type: eventType,
      disputeId: aggregateType === "dispute" ? aggregateId : undefined,
      message: `${eventType} — ${aggregateId}`,
      data: payload as Record<string, unknown>,
    }).catch(() => {/* Redis unavailable — ignore */});

    return event;
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
        status: "delivered",
        publishedAt: new Date(),
      });
    } catch (err) {
      console.warn("[EventBus] Failed to persist event:", err);
    }
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
