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

import fs from "fs";
import { createHash } from "node:crypto";
import { Kafka, Consumer, EachMessagePayload, logLevel } from "kafkajs";
import { recordTraceValidationFailure, traceparentValidationFailure, withTrustedTraceparent } from "../_core/telemetry";

const configuredBrokers = (): string[] => (process.env.KAFKA_BROKERS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
const CONSUMER_GROUP = process.env.KAFKA_CONSUMER_GROUP || "idr-app-consumer";
const MAX_RETRIES = 3;

const TOPICS = [
  "idr.dispute.events",
  "idr.payments",
  "idr.audit",
];

let _consumer: Consumer | null = null;
let _running = false;

function acceptsTrustedTraceContext(): boolean {
  // W3C parents are accepted only from a broker protected by mTLS/SASL and an
  // explicit configuration acknowledgement. A browser/public producer must not
  // be able to select the parent of internal traces.
  return process.env.KAFKA_TRACE_CONTEXT_TRUSTED === "true"
    && Boolean(process.env.KAFKA_SASL_USERNAME?.trim())
    && Boolean(process.env.KAFKA_SASL_PASSWORD)
    && Boolean(process.env.KAFKA_SSL_CA_PEM?.trim() || process.env.KAFKA_SSL_CA_PATH?.trim());
}

type KafkaTraceHeader = string | Buffer | Array<string | Buffer> | undefined;

/**
 * Selects a trace parent only after the broker trust gate is satisfied. Duplicate
 * header values are rejected here and malformed/oversized values are rejected by
 * `withTrustedTraceparent` before the consumer handler runs.
 */
export function selectTrustedKafkaTraceparent(headers: { traceparent?: KafkaTraceHeader } | undefined): KafkaTraceHeader {
  if (!acceptsTrustedTraceContext()) return undefined;
  const value = headers?.traceparent;
  return Array.isArray(value) ? undefined : value;
}

function buildKafka(): Kafka {
  const caPath = process.env.KAFKA_SSL_CA_PATH;
  const ca = process.env.KAFKA_SSL_CA_PEM ?? (caPath && fs.existsSync(caPath) ? fs.readFileSync(caPath, "utf8") : undefined);
  const username = process.env.KAFKA_SASL_USERNAME;
  const password = process.env.KAFKA_SASL_PASSWORD;
  return new Kafka({
    clientId: "idr-app",
    brokers: configuredBrokers(),
    logLevel: logLevel.WARN,
    retry: {
      initialRetryTime: 300,
      retries: 5,
    },
    ssl: ca ? { ca: [ca] } : undefined,
    sasl: username && password ? { mechanism: "scram-sha-512", username, password } : undefined,
  });
}

// ── Message handlers ──────────────────────────────────────────────────────────

async function handleDisputeEvent(value: Record<string, unknown>): Promise<void> {
  const eventType = value.eventType as string | undefined;
  const aggregateId = value.aggregateId as string | undefined;
  if (!eventType || !aggregateId) throw new Error("Kafka dispute event is missing eventType or aggregateId");

  // OpenSearch is a durable required index. An indexing failure must be retried
  // through Kafka/DLQ rather than silently producing stale search results.
  if (eventType.startsWith("dispute.")) {
    const { indexDispute } = await import("../search");
    await indexDispute(aggregateId, value.payload as Record<string, unknown> ?? {});
  }
}

async function handlePaymentEvent(value: Record<string, unknown>): Promise<void> {
  const eventType = value.eventType as string | undefined;
  const payload = (value.payload && typeof value.payload === "object") ? value.payload as Record<string, unknown> : value;
  const transferId = payload.transferId as string | undefined;
  if (!eventType || !transferId) throw new Error("Kafka payment event is missing eventType or transferId");
  const { getSettlementTransfer } = await import("../settlement-lifecycle");
  const transfer = await getSettlementTransfer(transferId);
  if (!transfer) throw new Error("Kafka payment event references no durable settlement transfer");
  // Provider status changes are accepted only through the authenticated settlement
  // callback/reconciliation path. This consumer validates the durable reference and
  // never mutates financial state from an arbitrary broker message.
}

async function handleAuditEvent(value: Record<string, unknown>): Promise<void> {
  if (typeof value.eventType !== "string" || typeof value.aggregateId !== "string") {
    throw new Error("Kafka audit event is missing durable event identity");
  }
  // The transactional outbox has already persisted the canonical audit record. This
  // consumer intentionally performs no second mutable audit write.
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
          payloadSha256: message ? createHash("sha256").update(message).digest("hex") : null,
          errorCode: error instanceof Error ? error.name : "delivery_error",
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
  if (!raw) throw new Error(`Kafka message on ${topic} is empty`);

  let value: Record<string, unknown>;
  try {
    value = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new Error(`Kafka message on ${topic} is not valid JSON`);
  }

  const brokerTrusted = acceptsTrustedTraceContext();
  const traceHeader = message.headers?.traceparent;
  const traceFailure = traceparentValidationFailure(traceHeader, brokerTrusted);
  if (traceFailure) recordTraceValidationFailure("kafka", traceFailure);
  const trustedTraceparent = selectTrustedKafkaTraceparent(message.headers);
  let lastError: unknown;
  await withTrustedTraceparent(trustedTraceparent, async () => {
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
  });

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
    if (process.env.NODE_ENV === "production") throw new Error("KAFKA_BROKERS is required for the production Kafka consumer");
    console.info("[kafka-consumer] KAFKA_BROKERS not set — consumer disabled outside production");
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
    _running = false;
    if (process.env.NODE_ENV === "production") throw err;
    console.warn("[kafka-consumer] Failed to connect outside production:", err);
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
