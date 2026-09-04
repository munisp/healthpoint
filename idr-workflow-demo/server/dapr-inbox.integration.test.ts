import { randomUUID } from "node:crypto";
import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { daprEventInbox, eventLog } from "../drizzle/schema";

const live = process.env.HEALTHPOINT_LIVE_DAPR_INTEGRATION === "true";
const suite = live ? describe : describe.skip;
const appToken = process.env.DAPR_APP_API_TOKEN;
const pubsubName = process.env.DAPR_PUBSUB_NAME;

suite("durable Dapr inbox integration", () => {
  let server: Server;
  let endpoint: string;

  beforeAll(async () => {
    if (!appToken || !pubsubName || !process.env.DATABASE_URL) {
      throw new Error("Live Dapr inbox integration requires DATABASE_URL, DAPR_APP_API_TOKEN, and DAPR_PUBSUB_NAME");
    }
    const { createDaprEventHandler, DAPR_JSON_CONTENT_TYPES } = await import("./dapr-inbox");
    const app = express();
    app.post("/api/events/audit", express.json({ limit: "64kb", type: [...DAPR_JSON_CONTENT_TYPES] }), createDaprEventHandler("idr.audit"));
    server = await new Promise<Server>((resolve, reject) => {
      const candidate = app.listen(0, "127.0.0.1", () => resolve(candidate));
      candidate.on("error", reject);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Failed to bind disposable Dapr inbox test listener");
    endpoint = `http://127.0.0.1:${address.port}/api/events/audit`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  it("denies an unsigned request and persists one idempotent authenticated CloudEvent", async () => {
    const eventId = `dapr-integration-${randomUUID()}`;
    const body = {
      id: eventId,
      specversion: "1.0",
      type: "audit.dapr.integration_verified",
      source: "healthpoint.integration-test",
      subject: "operational-test",
      time: new Date().toISOString(),
      data: { verification: "durable-inbox" },
    };

    const unsigned = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/cloudevents+json" },
      body: JSON.stringify(body),
    });
    expect(unsigned.status).toBe(401);

    const headers = {
      "content-type": "application/cloudevents+json",
      "dapr-api-token": appToken!,
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    };
    const first = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ status: "SUCCESS" });

    const duplicate = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toEqual({ status: "SUCCESS" });

    const { getDb } = await import("./db");
    const db = await getDb();
    if (!db) throw new Error("PostgreSQL unavailable during live Dapr inbox integration");
    const inboxRows = await db.select().from(daprEventInbox).where(and(
      eq(daprEventInbox.id, eventId),
      eq(daprEventInbox.pubsubName, pubsubName!),
      eq(daprEventInbox.topic, "idr.audit"),
    ));
    expect(inboxRows).toHaveLength(1);
    expect(inboxRows[0]?.status).toBe("processed");
    const eventRows = await db.select().from(eventLog).where(eq(
      eventLog.idempotencyKey,
      `dapr:${pubsubName}:idr.audit:${eventId}`,
    ));
    expect(eventRows).toHaveLength(1);
  });
});
