import { afterEach, describe, expect, it } from "vitest";
import { getTemporalConfiguration, isTemporalDispatchEnabled, resetTemporalClientForTests, startDisputeTemporalWorkflow } from "./temporal";

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
    });
    expect(isTemporalDispatchEnabled()).toBe(false);
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
});
