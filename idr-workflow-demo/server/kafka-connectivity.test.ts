import fs from "fs";
import { Kafka } from "kafkajs";
import { afterAll, describe, expect, it } from "vitest";

let admin: ReturnType<Kafka["admin"]> | null = null;
const caPath = process.env.KAFKA_SSL_CA_PATH;
const liveKafkaConfigured = Boolean(
  process.env.KAFKA_BROKERS &&
  process.env.KAFKA_SASL_USERNAME &&
  process.env.KAFKA_SASL_PASSWORD &&
  caPath &&
  fs.existsSync(caPath)
);
const describeLiveKafka = liveKafkaConfigured ? describe : describe.skip;

describeLiveKafka("configured Kafka endpoint", () => {
  it("authenticates over TLS and lists topic metadata without writing", async () => {
    const kafka = new Kafka({
      clientId: "idr-connectivity-test",
      brokers: (process.env.KAFKA_BROKERS || "").split(",").filter(Boolean),
      ssl: { ca: [fs.readFileSync(caPath!, "utf8")] },
      sasl: { mechanism: "scram-sha-512", username: process.env.KAFKA_SASL_USERNAME!, password: process.env.KAFKA_SASL_PASSWORD! },
    });
    admin = kafka.admin();
    await admin.connect();
    await expect(admin.listTopics()).resolves.toEqual(expect.any(Array));
  }, 15_000);
});

afterAll(async () => { if (admin) await admin.disconnect(); });
