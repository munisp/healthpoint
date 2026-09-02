import fs from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { initializeTelemetry, shutdownTelemetry } from "./_core/telemetry";
import { listTemporalWorkflows, resetTemporalClientForTests } from "./temporal";

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
  process.env.TEMPORAL_ADDRESS &&
  process.env.TEMPORAL_AUTH_TOKEN &&
  process.env.TEMPORAL_TLS_SERVER_NAME &&
  process.env.TEMPORAL_NAMESPACE &&
  process.env.TEMPORAL_TASK_QUEUE &&
  process.env.TEMPORAL_WORKFLOW_TYPE &&
  readable(process.env.TEMPORAL_CA_PATH)
);
const describeLiveHarness = liveHarnessConfigured ? describe : describe.skip;

describeLiveHarness("Temporal OpenTelemetry integration harness", () => {
  afterAll(async () => {
    await resetTemporalClientForTests();
    await shutdownTelemetry();
  });

  it("exports a bounded Temporal workflow-list span over the configured OTLP mTLS channel", async () => {
    await expect(initializeTelemetry()).resolves.toBe(true);
    await expect(listTemporalWorkflows(1)).resolves.toEqual(expect.any(Array));
  }, 20_000);
});
