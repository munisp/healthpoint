import fs from "fs";
import { Kafka } from "kafkajs";
import { afterAll, describe, expect, it } from "vitest";

let admin: ReturnType<Kafka["admin"]> | null = null;

describe("configured Kafka endpoint", () => {
  it("authenticates over TLS and lists topic metadata without writing", async () => {
    const caPath = process.env.KAFKA_SSL_CA_PATH;
    expect(caPath).toBeTruthy();
    expect(fs.existsSync(caPath!)).toBe(true);
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
