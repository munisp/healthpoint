import { afterEach, describe, expect, it, vi } from "vitest";
import { ROOT_CONTEXT, context, trace } from "@opentelemetry/api";
import {
  assertTelemetryProductionConfig,
  extractTrustedTraceparent,
  injectTrustedTraceparent,
  traceparentValidationFailure,
  tenantTelemetryScope,
} from "./telemetry";

describe("OpenTelemetry production controls", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("fails closed in production when the OTLP endpoint is missing", () => {
    process.env.NODE_ENV = "production";
    process.env.OTEL_ENABLED = "true";
    process.env.OTEL_SERVICE_NAME = "healthpoint-api";
    process.env.OTEL_TENANT_HMAC_KEY = "x".repeat(32);
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

    expect(assertTelemetryProductionConfig).toThrow("OTEL_EXPORTER_OTLP_ENDPOINT");
  });

  it("rejects production telemetry without readable mutual-TLS credential mounts", () => {
    process.env.NODE_ENV = "production";
    process.env.OTEL_ENABLED = "true";
    process.env.OTEL_SERVICE_NAME = "healthpoint-api";
    process.env.OTEL_TENANT_HMAC_KEY = "x".repeat(32);
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://collector.internal:4318";
    delete process.env.OTEL_CLIENT_CERT_PATH;
    delete process.env.OTEL_CLIENT_KEY_PATH;
    delete process.env.OTEL_CA_PATH;

    expect(assertTelemetryProductionConfig).toThrow("OTEL_CLIENT_CERT_PATH");
  });

  it("rejects non-TLS OTLP transport in production", () => {
    process.env.NODE_ENV = "production";
    process.env.OTEL_ENABLED = "true";
    process.env.OTEL_SERVICE_NAME = "healthpoint-api";
    process.env.OTEL_TENANT_HMAC_KEY = "x".repeat(32);
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://collector.internal:4318";

    expect(assertTelemetryProductionConfig).toThrow("https://");
  });

  it("creates a deterministic opaque tenant scope only within trusted execution context", () => {
    process.env.OTEL_TENANT_HMAC_KEY = "x".repeat(32);
    const scope = tenantTelemetryScope("tenant-sensitive-123");

    expect(scope).toMatch(/^[a-f0-9]{24}$/);
    expect(scope).not.toContain("tenant-sensitive-123");
    expect(tenantTelemetryScope("tenant-sensitive-123")).toBe(scope);
  });

  it("refuses tenant correlation without a sufficiently strong keyed secret", () => {
    process.env.OTEL_TENANT_HMAC_KEY = "short";
    expect(() => tenantTelemetryScope("tenant-sensitive-123")).toThrow("OTEL_TENANT_HMAC_KEY");
  });

  it("injects only W3C traceparent and never a tenant scope or baggage carrier", () => {
    const span = trace.wrapSpanContext({
      traceId: "a".repeat(32),
      spanId: "b".repeat(16),
      traceFlags: 1,
      isRemote: false,
    });
    const carrier = injectTrustedTraceparent(trace.setSpan(ROOT_CONTEXT, span));

    expect(carrier).toEqual({ traceparent: `00-${"a".repeat(32)}-${"b".repeat(16)}-01` });
    expect(Object.keys(carrier)).not.toContain("baggage");
    expect(JSON.stringify(carrier)).not.toContain("tenant");
  });

  it("accepts a strict authenticated W3C parent and rejects ambiguous or malformed carriers", () => {
    const valid = `00-${"c".repeat(32)}-${"d".repeat(16)}-01`;
    expect(trace.getSpanContext(extractTrustedTraceparent(valid))?.traceId).toBe("c".repeat(32));
    expect(trace.getSpanContext(extractTrustedTraceparent([valid, valid]))).toBeUndefined();
    expect(trace.getSpanContext(extractTrustedTraceparent("00-not-a-traceparent"))).toBeUndefined();
  });

  it("classifies malicious carriers using finite non-sensitive reasons", () => {
    const valid = `00-${"e".repeat(32)}-${"f".repeat(16)}-01`;
    expect(traceparentValidationFailure([valid, valid])).toBe("duplicate");
    expect(traceparentValidationFailure("not-a-traceparent")).toBe("malformed");
    expect(traceparentValidationFailure(`${valid}${"x".repeat(256)}`)).toBe("oversized");
    expect(traceparentValidationFailure(valid, false)).toBe("untrusted_transport");
  });
});
