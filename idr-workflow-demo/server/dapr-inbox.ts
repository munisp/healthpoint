import { createHash, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { daprEventInbox, eventLog } from "../drizzle/schema";
import { getDb } from "./db";
import { observeDependencyOperation, recordTraceValidationFailure, traceparentValidationFailure, withTrustedTraceparent } from "./_core/telemetry";

export const DAPR_EVENT_TOPICS = ["idr.dispute.events", "idr.payments", "idr.audit"] as const;
export type DaprEventTopic = (typeof DAPR_EVENT_TOPICS)[number];
export const DAPR_JSON_CONTENT_TYPES = ["application/json", "application/cloudevents+json"] as const;

const cloudEventSchema = z.object({
  id: z.string().trim().min(1).max(128),
  specversion: z.literal("1.0"),
  type: z.string().trim().regex(/^[a-z][a-z0-9._-]{0,127}$/),
  source: z.string().trim().min(1).max(256),
  subject: z.string().trim().max(256).optional(),
  time: z.string().datetime({ offset: true }).optional(),
  data: z.record(z.string(), z.unknown()),
}).strict();

type CloudEvent = z.infer<typeof cloudEventSchema>;

function configuredDaprToken(): string {
  const token = process.env.DAPR_APP_API_TOKEN?.trim();
  if (!token) throw new Error("DAPR_APP_API_TOKEN is required for Dapr event ingress");
  return token;
}

function timingSafeTokenEquals(expected: string, received: string | undefined): boolean {
  if (!received) return false;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

function isDaprTopic(value: string): value is DaprEventTopic {
  return (DAPR_EVENT_TOPICS as readonly string[]).includes(value);
}

function stableEventLogId(topic: DaprEventTopic, event: CloudEvent): string {
  return `dapr-${createHash("sha256").update(`${topic}:${event.id}`).digest("hex").slice(0, 59)}`;
}

function payloadHash(event: CloudEvent): string {
  return createHash("sha256").update(JSON.stringify(event.data)).digest("hex");
}

async function indexDaprDisputeEvent(event: CloudEvent): Promise<void> {
  if (!event.type.startsWith("dispute.")) return;
  const aggregateId = typeof event.data.disputeId === "string" ? event.data.disputeId : undefined;
  if (!aggregateId) throw new Error("Dapr dispute event lacks a disputeId");
  const { indexDispute } = await import("./search");
  await indexDispute(aggregateId, event.data);
}

async function processDaprEvent(topic: DaprEventTopic, event: CloudEvent): Promise<"inserted" | "duplicate"> {
  const db = await getDb();
  if (!db) throw new Error("PostgreSQL is required for Dapr event ingress");
  const hash = payloadHash(event);
  const existing = await db.select().from(daprEventInbox)
    .where(and(eq(daprEventInbox.pubsubName, configuredDaprPubsubName()), eq(daprEventInbox.topic, topic), eq(daprEventInbox.id, event.id)))
    .limit(1);
  if (existing[0]?.status === "processed") return "duplicate";
  if (existing[0] && existing[0].payloadSha256 !== hash) {
    throw new Error("Dapr event ID was replayed with a different payload");
  }
  if (!existing[0]) {
    await db.insert(daprEventInbox).values({
      id: event.id,
      pubsubName: configuredDaprPubsubName(),
      topic,
      eventType: event.type,
      subject: event.subject ?? null,
      payload: event.data,
      payloadSha256: hash,
      status: "received",
      retryCount: 0,
    });
  }

  try {
    if (topic === "idr.dispute.events") await indexDaprDisputeEvent(event);
    // Payment state is changed only through authenticated provider callbacks and
    // settlement reconciliation, never from a Dapr broker message.
    await db.transaction(async (tx) => {
      await tx.insert(eventLog).values({
        id: stableEventLogId(topic, event),
        topic,
        eventType: event.type,
        aggregateId: typeof event.data.disputeId === "string" ? event.data.disputeId : event.id,
        aggregateType: topic === "idr.payments" ? "settlement_transfer" : "dapr_event",
        payload: event.data,
        metadata: { source: "dapr", cloudEventId: event.id, payloadSha256: hash },
        idempotencyKey: `dapr:${configuredDaprPubsubName()}:${topic}:${event.id}`,
        status: "delivered",
        retryCount: 0,
        publishedAt: new Date(),
      }).onConflictDoNothing();
      await tx.update(daprEventInbox).set({ status: "processed", processedAt: new Date(), failureReason: null })
        .where(and(eq(daprEventInbox.pubsubName, configuredDaprPubsubName()), eq(daprEventInbox.topic, topic), eq(daprEventInbox.id, event.id)));
    });
    return existing[0] ? "duplicate" : "inserted";
  } catch (error) {
    await db.update(daprEventInbox).set({
      status: "failed",
      retryCount: (existing[0]?.retryCount ?? 0) + 1,
      failureReason: error instanceof Error ? error.name : "dapr_event_processing_failed",
    }).where(and(eq(daprEventInbox.pubsubName, configuredDaprPubsubName()), eq(daprEventInbox.topic, topic), eq(daprEventInbox.id, event.id)));
    throw error;
  }
}

function configuredDaprPubsubName(): string {
  const value = process.env.DAPR_PUBSUB_NAME?.trim();
  if (!value || !/^[a-z][a-z0-9-]{0,127}$/.test(value)) throw new Error("DAPR_PUBSUB_NAME must be a valid configured component name");
  return value;
}

export function daprSubscriptionManifest(): Array<{ pubsubname: string; topic: DaprEventTopic; route: string }> {
  if (!process.env.DAPR_ENABLED || process.env.DAPR_ENABLED !== "true") return [];
  const pubsubname = configuredDaprPubsubName();
  configuredDaprToken();
  return [
    { pubsubname, topic: "idr.dispute.events", route: "/api/events/dispute" },
    { pubsubname, topic: "idr.payments", route: "/api/events/payment" },
    { pubsubname, topic: "idr.audit", route: "/api/events/audit" },
  ];
}

/**
 * Authenticates an internal Dapr sidecar request, rejects untrusted W3C carriers,
 * and returns `SUCCESS` only after a PostgreSQL inbox/event-log transition commits.
 */
export function createDaprEventHandler(topic: DaprEventTopic): RequestHandler {
  return async (req: Request, res: Response) => {
    try {
      if (!timingSafeTokenEquals(configuredDaprToken(), req.header("dapr-api-token"))) {
        res.status(401).json({ status: "RETRY", error: "Dapr event authentication failed" });
        return;
      }
      const parsed = cloudEventSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ status: "DROP", error: "Invalid CloudEvent envelope" });
        return;
      }
      const header = req.header("traceparent") ?? undefined;
      const validationFailure = traceparentValidationFailure(header, true);
      if (validationFailure) recordTraceValidationFailure("dapr", validationFailure);
      await withTrustedTraceparent(validationFailure ? undefined : header, async () => {
        await observeDependencyOperation("dapr", "durable_event_ingress", () => processDaprEvent(topic, parsed.data));
      });
      res.status(200).json({ status: "SUCCESS" });
    } catch (error) {
      console.error("[dapr] durable event processing failed", error instanceof Error ? error.name : "unknown_error");
      res.status(503).json({ status: "RETRY", error: "Dapr event processing unavailable" });
    }
  };
}

export function assertDaprIngressConfiguration(): void {
  if (process.env.DAPR_ENABLED === "true") {
    configuredDaprToken();
    configuredDaprPubsubName();
  }
}
