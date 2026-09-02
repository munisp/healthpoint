import { afterEach, describe, expect, it } from "vitest";
import { trace } from "@opentelemetry/api";
import { extractTrustedTraceparent } from "../_core/telemetry";
import { selectTrustedKafkaTraceparent } from "./kafka-consumer";

const valid = `00-${"a".repeat(32)}-${"b".repeat(16)}-01`;
const originalEnvironment = { ...process.env };

function configureTrustedKafka() {
  process.env.KAFKA_TRACE_CONTEXT_TRUSTED = "true";
  process.env.KAFKA_SASL_USERNAME = "consumer";
  process.env.KAFKA_SASL_PASSWORD = "test-only-not-a-production-secret";
  process.env.KAFKA_SSL_CA_PEM = "-----BEGIN CERTIFICATE-----\ntest-only\n-----END CERTIFICATE-----";
}

describe("Kafka consumer W3C traceparent trust boundary", () => {
  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it("refuses a valid-looking parent when the broker trust acknowledgement is absent", () => {
    delete process.env.KAFKA_TRACE_CONTEXT_TRUSTED;
    process.env.KAFKA_SASL_USERNAME = "consumer";
    process.env.KAFKA_SASL_PASSWORD = "test-only";
    process.env.KAFKA_SSL_CA_PEM = "test-only-ca";

    expect(selectTrustedKafkaTraceparent({ traceparent: valid })).toBeUndefined();
  });

  it("accepts a single valid traceparent only from the explicitly trusted broker path", () => {
    configureTrustedKafka();
    const selected = selectTrustedKafkaTraceparent({ traceparent: Buffer.from(valid, "ascii") });

    expect(trace.getSpanContext(extractTrustedTraceparent(selected))?.traceId).toBe("a".repeat(32));
  });

  it("rejects duplicate traceparent values before consumer handler context creation", () => {
    configureTrustedKafka();
    const selected = selectTrustedKafkaTraceparent({ traceparent: [Buffer.from(valid), Buffer.from(valid)] });

    expect(selected).toBeUndefined();
    expect(trace.getSpanContext(extractTrustedTraceparent(selected))).toBeUndefined();
  });

  it("rejects malformed and oversized traceparents even on a trusted broker", () => {
    configureTrustedKafka();
    const malformed = selectTrustedKafkaTraceparent({ traceparent: "00-not-a-valid-traceparent" });
    const oversized = selectTrustedKafkaTraceparent({ traceparent: `00-${"c".repeat(32)}-${"d".repeat(16)}-01${"x".repeat(1024)}` });

    expect(trace.getSpanContext(extractTrustedTraceparent(malformed))).toBeUndefined();
    expect(trace.getSpanContext(extractTrustedTraceparent(oversized))).toBeUndefined();
  });
});
