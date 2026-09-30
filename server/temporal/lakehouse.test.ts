/**
 * server/temporal/lakehouse.test.ts
 *
 * MOCK-VERIFIED workflow wiring for lakehouseExportWorkflow via
 * @temporalio/testing's time-skipping server: a REAL Temporal test server
 * executes the actual workflow bundle against STUB activities, proving
 * deterministic bundling, per-dataset activity fan-out in order, partial
 * failure capture, and summary recording. The export activities themselves
 * are stubs here — the real activity logic is EXECUTED-VERIFIED in
 * server/lakehouse/export.test.ts against embedded PG.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import path from "node:path";
import {
  LAKEHOUSE_EXPORT_DATASETS,
  type LakehouseExportSummary,
} from "./lakehouse.shared";

describe("lakehouseExportWorkflow (time-skipping test server)", () => {
  let env: TestWorkflowEnvironment;
  const exported: string[] = [];
  const summaries: LakehouseExportSummary[] = [];
  let failDatasets: Set<string> = new Set();

  const mockActivities = {
    runIncrementalExportActivity: vi.fn(async (input: { runId: string; dataset: string }) => {
      if (failDatasets.has(input.dataset)) {
        throw new Error(`stub failure for ${input.dataset}`);
      }
      exported.push(input.dataset);
      return {
        dataset: input.dataset,
        rowCount: 7,
        s3Key: `lakehouse-exports/incremental/${input.dataset}/${input.runId}.ndjson`,
        previousWatermark: null,
        newWatermark: "2026-09-05T00:00:00.000Z",
      };
    }),
    recordExportRunStatusActivity: vi.fn(async (summary: LakehouseExportSummary) => {
      summaries.push(summary);
      return { recorded: true };
    }),
  };

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping();
  }, 120_000);

  afterAll(async () => {
    await env?.teardown();
  });

  async function runWorkflow(input: object = {}) {
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: "lakehouse-test",
      workflowsPath: path.resolve(import.meta.dirname, "lakehouse.workflows.ts"),
      activities: mockActivities,
    });
    return worker.runUntil(async () => {
      const handle = await env.client.workflow.start("lakehouseExportWorkflow", {
        taskQueue: "lakehouse-test",
        workflowId: `lakehouse-test-${Date.now()}`,
        args: [input],
      });
      return handle.result() as Promise<LakehouseExportSummary>;
    });
  }

  it("fans out one activity per dataset in order, then records the summary", async () => {
    exported.length = 0;
    summaries.length = 0;
    failDatasets = new Set();
    const summary = await runWorkflow({ runId: "test-run-1" });
    expect(exported).toEqual([...LAKEHOUSE_EXPORT_DATASETS]);
    expect(summary.succeeded).toBe(true);
    expect(summary.totalRows).toBe(7 * LAKEHOUSE_EXPORT_DATASETS.length);
    expect(summary.runId).toBe("test-run-1");
    expect(summaries).toHaveLength(1);
    expect(summaries[0].failures).toEqual([]);
  });

  it("captures a dataset failure honestly and still records a summary", async () => {
    exported.length = 0;
    summaries.length = 0;
    failDatasets = new Set(["documents"]);
    const summary = await runWorkflow({ runId: "test-run-2" });
    // "documents" failed after retries; the other datasets still exported.
    expect(exported).toEqual(["disputes", "audit"]);
    expect(summary.succeeded).toBe(false);
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0]).toContain("documents");
    expect(summaries).toHaveLength(1);
  });
});
