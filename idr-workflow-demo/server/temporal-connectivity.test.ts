import fs from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { listTemporalWorkflows, resetTemporalClientForTests } from "./temporal";

const caPath = process.env.TEMPORAL_CA_PATH;
const liveTemporalConfigured = Boolean(
  process.env.TEMPORAL_LIVE_TEST === "true" &&
  process.env.TEMPORAL_ADDRESS &&
  process.env.TEMPORAL_AUTH_TOKEN &&
  process.env.TEMPORAL_TLS_SERVER_NAME &&
  process.env.TEMPORAL_NAMESPACE &&
  process.env.TEMPORAL_TASK_QUEUE &&
  process.env.TEMPORAL_WORKFLOW_TYPE &&
  caPath &&
  fs.existsSync(caPath)
);
const describeLiveTemporal = liveTemporalConfigured ? describe : describe.skip;

describeLiveTemporal("configured Temporal endpoint", () => {
  afterAll(async () => {
    await resetTemporalClientForTests();
  });

  it("authenticates over TLS and lists workflow metadata without dispatching", async () => {
    const workflows = await listTemporalWorkflows(1);
    expect(Array.isArray(workflows)).toBe(true);
  }, 15_000);
});
