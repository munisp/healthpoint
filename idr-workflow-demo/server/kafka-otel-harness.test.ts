import fs from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import {
  initializeTelemetry,
  observeDependencyOperation,
  shutdownTelemetry,
} from "./_core/telemetry";

const readable = (value: string | undefined) => Boolean(value && fs.existsSync(value));
const liveHarnessConfigured = Boolean(
  process.env.OTEL_HARNESS_ENABLED === "true" &&
  process.env.NODE_ENV === "integration" &&
  process.env.OTEL_ENABLED === "true" &&
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.startsWith("https://") &&
  (process.env.OTEL_TENANT_HMAC_KEY?.length ?? 0) >= 32 &&
  readable(process.env.OTEL_CLIENT_CERT_PATH) &&
  readable(process.env.OTEL_CLIENT_KEY_PATH) &&
  readable(process.env.OTEL_CA_PATH) &&
  process.env.KAFKA_BROKERS &&
  process.env.KAFKA_SASL_USERNAME &&
  process.env.KAFKA_SASL_PASSWORD &&
  readable(process.env.KAFKA_SSL_CA_PATH)
);
const describeLiveHarness = liveHarnessConfigured ? describe : describe.skip;

describeLiveHarness("Kafka OpenTelemetry integration harness", () => {
  let disconnect: (() => Promise<void>) | undefined;

  afterAll(async () => {
    await disconnect?.();
    await shutdownTelemetry();
  });

  it("exports a bounded Kafka metadata-operation span over the configured OTLP mTLS channel", async () => {
    await expect(initializeTelemetry()).resolves.toBe(true);
    const { Kafka } = await import("kafkajs");
    const kafka = new Kafka({
      clientId: "healthpoint-otel-harness",
      brokers: process.env.KAFKA_BROKERS!.split(",").map(value => value.trim()).filter(Boolean),
      ssl: { ca: [fs.readFileSync(process.env.KAFKA_SSL_CA_PATH!, "utf8")] },
      sasl: {
        mechanism: "scram-sha-512",
        username: process.env.KAFKA_SASL_USERNAME!,
        password: process.env.KAFKA_SASL_PASSWORD!,
      },
    });
    const admin = kafka.admin();
    disconnect = () => admin.disconnect();
    await admin.connect();
    await expect(
      observeDependencyOperation("kafka", "admin_list_topics", () => admin.listTopics())
    ).resolves.toEqual(expect.any(Array));
  }, 20_000);
});
