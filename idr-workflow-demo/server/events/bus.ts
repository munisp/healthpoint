/**
 * server/events/bus.ts
 * PostgreSQL transactional-outbox publisher with Kafka delivery.
 *
 * Architecture:
 * - Events are persisted to the `event_log` PostgreSQL table before return.
 * - The durable outbox worker claims records and performs side effects after commit.
 * - Kafka is the sole inter-service transport; in-process EventEmitter delivery is
 *   intentionally prohibited because it is lost on restart and diverges by replica.
 */
import fs from "fs";
import { Kafka, Producer, Partitioners, logLevel } from "kafkajs";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { auditLog, eventLog, outcomePredictions } from "../../drizzle/schema";
import { dispatchWebhooksForEvent } from "../webhook-dispatcher";
import { publishNotification } from "../redis";
import { injectTrustedTraceparent } from "../_core/telemetry";

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
      allowAutoTopicCreation: false,
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

class IDREventBus {
  private static instance: IDREventBus;

  static getInstance(): IDREventBus {
    if (!IDREventBus.instance) IDREventBus.instance = new IDREventBus();
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

    // Delivery is performed by the PostgreSQL-backed outbox worker after commit.
    // Do not dispatch synchronously or through process memory; callers receive the
    // durable pending record and eventual delivery state is auditable in event_log.
    return event;
  }

  /** Dispatches an already-persisted outbox event without writing a duplicate. */
  async deliverOutboxEvent<T = Record<string, unknown>>(event: IDREvent<T>): Promise<void> {
    // Kafka failure leaves the durable outbox event pending/failed for a later retry.
    const producer = await getKafkaProducer();
    if (!producer) throw new Error("Kafka producer is unavailable for durable outbox delivery");
    await producer.send({
      topic: event.topic,
      messages: [{
        key: event.aggregateId,
        value: JSON.stringify(event),
        headers: {
          "event-type": event.eventType,
          "source-service": "idr-app",
          ...injectTrustedTraceparent(),
        },
      }],
    });

    const db = await getDb();
    if (!db) throw new Error("PostgreSQL is unavailable for durable event side effects");
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
    await dispatchWebhooksForEvent(event.eventType, event.aggregateId, event.payload as Record<string, unknown>, event.id);
    if (event.eventType === "dispute.advanced") {
      await db.update(outcomePredictions)
        .set({ updatedAt: new Date() })
        .where(eq(outcomePredictions.disputeId, event.aggregateId));
    }
    await publishNotification({
      type: event.eventType,
      disputeId: event.aggregateType === "dispute" ? event.aggregateId : undefined,
      message: event.eventType,
      data: { eventId: event.id },
    });
  }

  private async persistEvent<T>(event: IDREvent<T>): Promise<void> {
    const db = await getDb();
    if (!db) throw new Error("PostgreSQL is unavailable for event persistence");

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

}

export const eventBus = IDREventBus.getInstance();
