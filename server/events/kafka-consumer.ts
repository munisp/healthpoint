/**
 * server/events/kafka-consumer.ts
 * Kafka consumer for the IDR platform.
 *
 * Subscribes to all IDR topics and routes messages to in-process handlers:
 *   - idr.dispute.events  → dispute state change processing
 *   - idr.payments        → payment status updates
 *   - idr.audit           → audit log fan-out
 *   - idr.dlq             → dead-letter queue (failed messages after max retries)
 *
 * Retry policy: exponential back-off, max 3 retries, then DLQ.
 */

import { Kafka, Consumer, EachMessagePayload, logLevel } from "kafkajs";

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || "localhost:9092").split(",");
const CONSUMER_GROUP = process.env.KAFKA_CONSUMER_GROUP || "idr-app-consumer";
const MAX_RETRIES = 3;

const TOPICS = [
  "idr.dispute.events",
  "idr.payments",
  "idr.audit",
];

let _consumer: Consumer | null = null;
let _running = false;

function buildKafka(): Kafka {
  return new Kafka({
    clientId: "idr-app",
    brokers: KAFKA_BROKERS,
    logLevel: logLevel.WARN,
    retry: {
      initialRetryTime: 300,
      retries: 5,
    },
  });
}

// ── Message handlers ──────────────────────────────────────────────────────────

async function handleDisputeEvent(value: Record<string, unknown>): Promise<void> {
  const eventType = value.eventType as string | undefined;
  const aggregateId = value.aggregateId as string | undefined;
  if (!eventType || !aggregateId) return;

  // Index into OpenSearch on dispute state changes
  if (eventType.startsWith("dispute.")) {
    try {
      const { indexDispute } = await import("../search");
      await indexDispute(aggregateId, value.payload as Record<string, unknown> ?? {});
    } catch {
      // Non-fatal
    }
  }
}

async function handlePaymentEvent(value: Record<string, unknown>): Promise<void> {
  const type = value.type as string | undefined;
  const transferId = value.transferId as string | undefined;
  if (!type || !transferId) return;
  // Future: update payment status in DB, trigger notifications
  console.info(`[kafka-consumer] payment event: ${type} — ${transferId}`);
}

async function handleAuditEvent(_value: Record<string, unknown>): Promise<void> {
  // Audit events are already written by the event bus — no additional processing needed
}

async function sendToDLQ(kafka: Kafka, topic: string, message: Buffer | null, error: unknown): Promise<void> {
  try {
    const producer = kafka.producer();
    await producer.connect();
    await producer.send({
      topic: "idr.dlq",
      messages: [{
        key: topic,
        value: JSON.stringify({
          originalTopic: topic,
          payload: message?.toString("utf8") ?? null,
          error: String(error),
          failedAt: new Date().toISOString(),
        }),
      }],
    });
    await producer.disconnect();
  } catch {
    // DLQ write failure — log and continue
    console.error("[kafka-consumer] Failed to write to DLQ");
  }
}

async function processMessage(
  kafka: Kafka,
  topic: string,
  message: EachMessagePayload["message"]
): Promise<void> {
  const raw = message.value;
  if (!raw) return;

  let value: Record<string, unknown>;
  try {
    value = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
  } catch {
    console.warn(`[kafka-consumer] Non-JSON message on ${topic} — skipping`);
    return;
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (topic === "idr.dispute.events") {
        await handleDisputeEvent(value);
      } else if (topic === "idr.payments") {
        await handlePaymentEvent(value);
      } else if (topic === "idr.audit") {
        await handleAuditEvent(value);
      }
      return; // Success
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        const delay = 200 * Math.pow(2, attempt - 1); // 200ms, 400ms, 800ms
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  // All retries exhausted — send to DLQ
  console.error(`[kafka-consumer] Message failed after ${MAX_RETRIES} retries on ${topic}:`, lastError);
  await sendToDLQ(kafka, topic, raw, lastError);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start the Kafka consumer. Safe to call multiple times — only starts once.
 * Non-blocking: connection errors are logged but do not crash the server.
 */
export async function startKafkaConsumer(): Promise<void> {
  if (_running) return;
  if (!process.env.KAFKA_BROKERS) {
    console.info("[kafka-consumer] KAFKA_BROKERS not set — consumer disabled");
    return;
  }

  const kafka = buildKafka();
  _consumer = kafka.consumer({ groupId: CONSUMER_GROUP });

  try {
    await _consumer.connect();
    for (const topic of TOPICS) {
      await _consumer.subscribe({ topic, fromBeginning: false });
    }
    _running = true;

    await _consumer.run({
      eachMessage: async ({ topic, message }: EachMessagePayload) => {
        await processMessage(kafka, topic, message);
      },
    });

    console.info(`[kafka-consumer] Subscribed to: ${TOPICS.join(", ")}`);
  } catch (err) {
    console.warn("[kafka-consumer] Failed to connect (non-fatal):", err);
    _running = false;
  }
}

/**
 * Gracefully stop the Kafka consumer.
 */
export async function stopKafkaConsumer(): Promise<void> {
  if (_consumer) {
    await _consumer.disconnect();
    _consumer = null;
    _running = false;
  }
}
