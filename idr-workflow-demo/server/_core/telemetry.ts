import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { ROOT_CONTEXT, context, metrics, propagation, trace, type Attributes, type Context, type Span, type TextMapGetter, type TextMapSetter } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { httpAgentFactoryFromOptions } from "@opentelemetry/otlp-exporter-base/node-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

/**
 * OpenTelemetry is an operational signal only. This module must never attach
 * PHI, raw tenant IDs, user IDs, email addresses, dispute IDs, document IDs,
 * object keys/URIs, payment identifiers, request bodies, or authorization
 * subjects/entities to telemetry.
 */

const TENANT_SCOPE_CONTEXT_KEY = Symbol.for("healthpoint.telemetry.tenant-scope");
const TRACEPARENT_PATTERN = /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/i;
type TraceCarrier = Record<string, string>;

/**
 * W3C propagation is restricted to `traceparent`. In particular, baggage is
 * never injected or extracted because it can carry arbitrary cross-service data.
 * Tenant scope remains process-local and must never cross a broker or workflow
 * carrier, even in keyed/HMAC form.
 */
const traceparentSetter: TextMapSetter<TraceCarrier> = {
  set(carrier, key, value) {
    if (key.toLowerCase() === "traceparent" && TRACEPARENT_PATTERN.test(value)) {
      carrier.traceparent = value.toLowerCase();
    }
  },
};
const traceparentGetter: TextMapGetter<TraceCarrier> = {
  get(carrier, key) { return key.toLowerCase() === "traceparent" ? carrier.traceparent : undefined; },
  keys(carrier) { return carrier.traceparent ? ["traceparent"] : []; },
};
// Register once at module load, including in test processes, so every carrier
// helper implements the same strict W3C Trace Context behavior.
propagation.setGlobalPropagator(new W3CTraceContextPropagator());

const telemetryState = {
  initialized: false,
  enabled: false,
  sdk: null as NodeSDK | null,
};

const meter = metrics.getMeter("healthpoint.runtime");
const operationCounter = meter.createCounter("healthpoint.operation.total", {
  description: "Bounded operational outcomes by component, operation, and status.",
});
const operationDuration = meter.createHistogram("healthpoint.operation.duration", {
  description: "Bounded operation latency in milliseconds; never tenant-labelled.",
  unit: "ms",
});
const traceValidationCounter = meter.createCounter("healthpoint.trace.validation.total", {
  description: "Rejected W3C trace-context carriers by bounded component and reason; never tenant-labelled.",
});

export type TelemetryOperation = {
  component:
    | "application"
    | "postgresql"
    | "redis"
    | "kafka"
    | "temporal"
    | "keycloak"
    | "permify"
    | "tigerbeetle"
    | "mojaloop"
    | "opensearch"
    | "dapr"
    | "document-analysis"
    | "cms-manual-handoff"
    | "lakehouse";
  operation: string;
  status: "ok" | "error" | "blocked";
  durationMs?: number;
};

function required(value: string | undefined, name: string, errors: string[]) {
  if (!value?.trim()) errors.push(`${name} is required when OpenTelemetry is enabled in production`);
}

function isHttps(value: string | undefined): boolean {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function assertTelemetryProductionConfig(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.OTEL_ENABLED !== "true") {
    throw new Error("OTEL_ENABLED=true is required in production");
  }

  const errors: string[] = [];
  required(process.env.OTEL_EXPORTER_OTLP_ENDPOINT, "OTEL_EXPORTER_OTLP_ENDPOINT", errors);
  required(process.env.OTEL_SERVICE_NAME, "OTEL_SERVICE_NAME", errors);
  required(process.env.OTEL_TENANT_HMAC_KEY, "OTEL_TENANT_HMAC_KEY", errors);
  required(process.env.OTEL_CLIENT_CERT_PATH, "OTEL_CLIENT_CERT_PATH", errors);
  required(process.env.OTEL_CLIENT_KEY_PATH, "OTEL_CLIENT_KEY_PATH", errors);
  required(process.env.OTEL_CA_PATH, "OTEL_CA_PATH", errors);
  if (!isHttps(process.env.OTEL_EXPORTER_OTLP_ENDPOINT)) {
    errors.push("OTEL_EXPORTER_OTLP_ENDPOINT must use https:// in production");
  }
  if ((process.env.OTEL_TENANT_HMAC_KEY?.length ?? 0) < 32) {
    errors.push("OTEL_TENANT_HMAC_KEY must contain at least 32 characters");
  }
  for (const name of ["OTEL_CLIENT_CERT_PATH", "OTEL_CLIENT_KEY_PATH", "OTEL_CA_PATH"]) {
    const path = process.env[name];
    if (path) {
      try { readFileSync(path); } catch { errors.push(`${name} must reference a readable mounted certificate file`); }
    }
  }
  if (process.env.OTEL_EXPORTER_OTLP_HEADERS?.match(/authorization\s*=\s*(?:basic|bearer)\s+[^$]/i)) {
    errors.push("OTEL_EXPORTER_OTLP_HEADERS must not embed literal credentials; use workload identity or a mounted secret");
  }
  if (errors.length) throw new Error(`OpenTelemetry production configuration invalid: ${errors.join("; ")}`);
}

function endpoint(path: "v1/traces" | "v1/metrics"): string {
  const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/$/, "");
  if (!base) return `http://127.0.0.1:4318/${path}`;
  return `${base}/${path}`;
}

function createMtlsAgentFactory() {
  const certPath = process.env.OTEL_CLIENT_CERT_PATH?.trim();
  const keyPath = process.env.OTEL_CLIENT_KEY_PATH?.trim();
  const caPath = process.env.OTEL_CA_PATH?.trim();
  if (!certPath || !keyPath || !caPath) return undefined;
  return httpAgentFactoryFromOptions({
    cert: readFileSync(certPath),
    key: readFileSync(keyPath),
    ca: readFileSync(caPath),
    rejectUnauthorized: true,
    minVersion: "TLSv1.2",
  });
}

function parseHeaders(): Record<string, string> {
  const raw = process.env.OTEL_EXPORTER_OTLP_HEADERS?.trim();
  if (!raw) return {};
  return Object.fromEntries(
    raw.split(",").flatMap(entry => {
      const separator = entry.indexOf("=");
      if (separator < 1) return [];
      return [[entry.slice(0, separator).trim(), entry.slice(separator + 1).trim()]];
    })
  );
}

/** Returns a non-reversible tenant correlation scope for traces/logs only. */
export function tenantTelemetryScope(tenantId: string): string {
  const key = process.env.OTEL_TENANT_HMAC_KEY;
  if (!key || key.length < 32) {
    throw new Error("OTEL_TENANT_HMAC_KEY is required before a tenant scope can be attached");
  }
  return crypto.createHmac("sha256", key).update(tenantId, "utf8").digest("hex").slice(0, 24);
}

/**
 * Runs an operation with a keyed tenant scope. Use only after a trusted
 * server-side relationship has resolved the tenant; never derive this value
 * from a browser header or arbitrary request payload.
 */
export function withTenantTelemetryScope<T>(tenantId: string, fn: () => T): T {
  const scope = tenantTelemetryScope(tenantId);
  const scoped = context.active().setValue(TENANT_SCOPE_CONTEXT_KEY, scope);
  return context.with(scoped, fn);
}

export function applyTenantScope(span: Span, tenantId: string): void {
  span.setAttribute("healthpoint.tenant.scope", tenantTelemetryScope(tenantId));
}

export function activeTenantTelemetryScope(): string | undefined {
  return context.active().getValue(TENANT_SCOPE_CONTEXT_KEY) as string | undefined;
}

/** Injects only a valid W3C traceparent for an authenticated internal carrier. */
export function injectTrustedTraceparent(parent: Context = context.active()): TraceCarrier {
  const carrier: TraceCarrier = {};
  propagation.inject(parent, carrier, traceparentSetter);
  return carrier;
}

/**
 * Extracts a strict W3C parent from a carrier already authenticated by the
 * transport (for example, a SASL/TLS Kafka broker or mTLS Dapr sidecar).
 * Untrusted public input must start a new trace instead.
 */
export type TraceValidationFailureReason = "duplicate" | "malformed" | "oversized" | "untrusted_transport";
type TraceparentValue = string | Buffer | Array<string | Buffer> | undefined;

/** Returns a bounded reason without retaining or logging the supplied carrier. */
export function traceparentValidationFailure(value: TraceparentValue, transportTrusted = true): TraceValidationFailureReason | undefined {
  if (!value) return undefined;
  if (!transportTrusted) return "untrusted_transport";
  // Repeated trace headers are ambiguous and are treated as untrusted rather than
  // choosing an attacker-controlled first/last value.
  if (Array.isArray(value)) return "duplicate";
  const candidate = Buffer.isBuffer(value) ? value.toString("ascii") : value;
  if (candidate.length > 55) return "oversized";
  return TRACEPARENT_PATTERN.test(candidate) ? undefined : "malformed";
}

/** Records a finite validation-failure outcome without carrier content or identity. */
export function recordTraceValidationFailure(
  component: "kafka" | "dapr" | "api-gateway",
  reason: TraceValidationFailureReason,
): void {
  traceValidationCounter.add(1, {
    "healthpoint.component": component,
    "healthpoint.reason": reason,
  });
}

export function extractTrustedTraceparent(value: TraceparentValue): Context {
  if (!value || Array.isArray(value) || traceparentValidationFailure(value)) return ROOT_CONTEXT;
  const candidate = Buffer.isBuffer(value) ? value.toString("ascii") : value;
  return propagation.extract(ROOT_CONTEXT, { traceparent: candidate!.toLowerCase() }, traceparentGetter);
}

/** Runs an authenticated asynchronous handler in the extracted W3C parent context. */
export async function withTrustedTraceparent<T>(
  traceparent: string | Buffer | Array<string | Buffer> | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return await context.with(extractTrustedTraceparent(traceparent), fn);
}

/**
 * Records only bounded operational dimensions. Do not add IDs, free-form error
 * strings, routes with IDs, user input, or tenant scope to metric attributes.
 */
export function recordTelemetryOperation(operation: TelemetryOperation): void {
  const attributes: Attributes = {
    "healthpoint.component": operation.component,
    "healthpoint.operation": operation.operation,
    "healthpoint.status": operation.status,
  };
  operationCounter.add(1, attributes);
  if (typeof operation.durationMs === "number" && Number.isFinite(operation.durationMs)) {
    operationDuration.record(operation.durationMs, attributes);
  }
}

export function startTelemetrySpan(name: string, attributes: Attributes = {}) {
  const span = trace.getTracer("healthpoint.runtime").startSpan(name, {
    attributes,
  });
  const tenantScope = activeTenantTelemetryScope();
  if (tenantScope) span.setAttribute("healthpoint.tenant.scope", tenantScope);
  return span;
}

/** Executes a dependency operation with bounded metrics and a privacy-safe span. */
export async function observeDependencyOperation<T>(
  component: TelemetryOperation["component"],
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  const span = startTelemetrySpan(`healthpoint.${component}.${operation}`, {
    "healthpoint.component": component,
    "healthpoint.operation": operation,
  });
  try {
    const result = await fn();
    span.setStatus({ code: 1 });
    recordTelemetryOperation({ component, operation, status: "ok", durationMs: performance.now() - startedAt });
    return result;
  } catch (error) {
    // Error messages can contain endpoint, query, provider, or user-derived detail.
    // Record a fixed classification only; the original error remains available to the caller's protected logs.
    span.recordException(new Error("dependency operation failed"));
    span.setStatus({ code: 2, message: "dependency operation failed" });
    recordTelemetryOperation({ component, operation, status: "error", durationMs: performance.now() - startedAt });
    throw error;
  } finally {
    span.end();
  }
}

export async function initializeTelemetry(): Promise<boolean> {
  if (telemetryState.initialized) return telemetryState.enabled;
  telemetryState.initialized = true;

  const enabled = process.env.OTEL_ENABLED === "true";
  if (!enabled) return false;
  assertTelemetryProductionConfig();

  const headers = parseHeaders();
  const agentFactory = createMtlsAgentFactory();
  const exporterOptions = {
    url: endpoint("v1/traces"),
    headers,
    ...(agentFactory ? { agentFactory } : {}),
  };
  const metricExporterOptions = {
    url: endpoint("v1/metrics"),
    headers,
    ...(agentFactory ? { agentFactory } : {}),
  };
  const serviceName = process.env.OTEL_SERVICE_NAME || "healthpoint-api";
  const serviceVersion = process.env.OTEL_SERVICE_VERSION || process.env.GIT_SHA || "unknown";
  const environment = process.env.OTEL_DEPLOYMENT_ENVIRONMENT || process.env.NODE_ENV || "development";

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: serviceVersion,
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: environment,
      "healthpoint.telemetry.privacy": "tenant-hmac-no-phi",
    }),
    traceExporter: new OTLPTraceExporter(exporterOptions),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(metricExporterOptions),
      exportIntervalMillis: Number.parseInt(process.env.OTEL_METRIC_EXPORT_INTERVAL_MS || "30000", 10),
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-dns": { enabled: false },
      }),
    ],
  });
  await sdk.start();
  telemetryState.sdk = sdk;
  telemetryState.enabled = true;

  const shutdown = async () => {
    await shutdownTelemetry();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  return true;
}

export async function shutdownTelemetry(): Promise<void> {
  const sdk = telemetryState.sdk;
  telemetryState.sdk = null;
  telemetryState.enabled = false;
  if (sdk) await sdk.shutdown();
}

export function isTelemetryEnabled(): boolean {
  return telemetryState.enabled;
}
