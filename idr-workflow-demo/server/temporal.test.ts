import { afterEach, describe, expect, it } from "vitest";
import { describeTemporalFailure, getTemporalConfiguration, isTemporalDispatchEnabled, resetTemporalClientForTests, runControlledTemporalDispatchDrill, startDisputeTemporalWorkflow, summarizeTemporalConnectionFailures, withTemporalConnectionRetry } from "./temporal";

const originalEnvironment = { ...process.env };

afterEach(async () => {
  await resetTemporalClientForTests();
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
});

describe("Temporal client configuration", () => {
  it("uses explicit development defaults but leaves dispatch disabled", () => {
    process.env.NODE_ENV = "test";
    delete process.env.TEMPORAL_ADDRESS;
    delete process.env.TEMPORAL_TLS_SERVER_NAME;
    delete process.env.TEMPORAL_NAMESPACE;
    delete process.env.TEMPORAL_TASK_QUEUE;
    delete process.env.TEMPORAL_WORKFLOW_TYPE;
    delete process.env.TEMPORAL_EXECUTION_ENABLED;

    const config = getTemporalConfiguration();
    expect(config).toMatchObject({
      address: "127.0.0.1:7233",
      serverName: "temporal.newfire.app",
      namespace: "default",
      taskQueue: "healthpoint-idr",
      workflowType: "idrDisputeWorkflow",
      usingDevelopmentDefaults: true,
    });
    expect(isTemporalDispatchEnabled()).toBe(false);
  });

  it("marks an entirely operator-provided non-production worker identity as verified configuration", () => {
    process.env.NODE_ENV = "test";
    process.env.TEMPORAL_ADDRESS = "temporal.approved.example:7233";
    process.env.TEMPORAL_TLS_SERVER_NAME = "temporal.approved.example";
    process.env.TEMPORAL_NAMESPACE = "healthpoint";
    process.env.TEMPORAL_TASK_QUEUE = "healthpoint-approved-worker";
    process.env.TEMPORAL_WORKFLOW_TYPE = "ApprovedHealthPointWorkflow";

    expect(getTemporalConfiguration().usingDevelopmentDefaults).toBe(false);
  });

  it("rejects production configuration that tries to rely on development defaults", () => {
    process.env.NODE_ENV = "production";
    delete process.env.TEMPORAL_ADDRESS;
    delete process.env.TEMPORAL_AUTH_TOKEN;
    delete process.env.TEMPORAL_TLS_SERVER_NAME;
    delete process.env.TEMPORAL_NAMESPACE;
    delete process.env.TEMPORAL_TASK_QUEUE;
    delete process.env.TEMPORAL_WORKFLOW_TYPE;

    expect(() => getTemporalConfiguration()).toThrow("TEMPORAL_AUTH_TOKEN is required for Temporal in production");
  });

  it("refuses a workflow dispatch before attempting a connection when execution is disabled", async () => {
    process.env.NODE_ENV = "test";
    process.env.TEMPORAL_EXECUTION_ENABLED = "false";

    await expect(startDisputeTemporalWorkflow("dispute-123", "admin-123"))
      .rejects.toThrow("Temporal workflow dispatch is disabled");
  });

  it("runs the controlled drill exclusively with synthetic data and no network dispatch", () => {
    process.env.PAYMENT_EXECUTION_MODE = "disabled";
    const result = runControlledTemporalDispatchDrill("admin-123", new Date("2026-08-19T12:00:00.000Z"));

    expect(result.transport).toBe("mock");
    expect(result.outcome).toBe("verified_no_network_dispatch");
    expect(result.paymentExecution).toBe("disabled");
    expect(result.syntheticDisputeId).toMatch(/^synthetic-tdr_/);
    expect(result.payloadHash).toHaveLength(64);
  });

  it("uses bounded retries only for transient connection failures and exposes recovery guidance", async () => {
    let attempts = 0;
    const result = await withTemporalConnectionRetry(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("ECONNRESET");
      return "connected";
    });
    expect(result).toBe("connected");
    expect(attempts).toBe(3);

    const recovery = describeTemporalFailure(new Error("ECONNREFUSED"), 3);
    expect(recovery).toMatchObject({ code: "temporal_unavailable", retryable: true, attempts: 3 });
    expect(recovery.guidance).toContain("operations dashboard");
  });

  it("raises a persistent critical alert only after three supervised connection failures within 15 minutes", () => {
    const now = new Date("2026-08-20T00:15:00.000Z");
    const records = [
      { action: "temporal.connection_check.failed", createdAt: new Date("2026-08-20T00:14:00.000Z") },
      { action: "temporal.connection_check.failed", createdAt: new Date("2026-08-20T00:10:00.000Z") },
      { action: "temporal.connection_check.failed", createdAt: new Date("2026-08-20T00:01:00.000Z") },
      { action: "temporal.connection_check.failed", createdAt: new Date("2026-08-19T23:30:00.000Z") },
    ];
    expect(summarizeTemporalConnectionFailures(records.slice(0, 2), now)).toMatchObject({ failureCount: 2, visible: false, severity: "warning" });
    expect(summarizeTemporalConnectionFailures(records, now)).toMatchObject({ failureCount: 3, visible: true, severity: "critical" });
  });
});
