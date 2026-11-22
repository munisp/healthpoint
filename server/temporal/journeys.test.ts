/**
 * server/temporal/journeys.test.ts
 *
 * EXECUTED workflow verification via @temporalio/testing's in-memory
 * time-skipping server (TestWorkflowEnvironment) — a REAL Temporal server
 * (embedded test server binary) executes the actual workflow bundle against
 * stub activities, proving: deterministic bundle, sequential journey order,
 * result aggregation, allPassed flag, and reportActivity fan-out.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import path from "node:path";
import {
  DEFAULT_JOURNEY_IDS,
  type JourneyOrchestratorSummary,
  type JourneyRunResult,
} from "./journeys.shared";

function fakeResult(journeyId: string, status: "PASS" | "FAIL" = "PASS"): JourneyRunResult {
  return {
    journeyId,
    title: `Stub ${journeyId}`,
    actor: "provider",
    status,
    durationMs: 12,
    asserts: 3,
    steps: [{ name: "stub-step", status, durationMs: 12 }],
  };
}

describe("journeyOrchestratorWorkflow (time-skipping test server)", () => {
  let env: TestWorkflowEnvironment;

  const calls: { seed: unknown[]; journeys: string[]; reports: JourneyOrchestratorSummary[] } = {
    seed: [], journeys: [], reports: [],
  };
  let journeyStatuses: Record<string, "PASS" | "FAIL"> = {};

  const mockActivities = {
    seedBaselineActivity: vi.fn(async (input: { runId: string; clean: boolean; scale: string }) => {
      calls.seed.push(input);
      return { runId: input.runId, fixtureUsers: 4, seeded: "fixture-users" };
    }),
    runJourneyActivity: vi.fn(async (input: { journeyId: string; runId: string }) => {
      calls.journeys.push(input.journeyId);
      return fakeResult(input.journeyId, journeyStatuses[input.journeyId] ?? "PASS");
    }),
    reportActivity: vi.fn(async (summary: JourneyOrchestratorSummary) => {
      calls.reports.push(summary);
      return { auditId: "audit-stub" };
    }),
  };

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping();
  }, 120_000);

  afterAll(async () => {
    await env?.teardown();
  });

  async function runOrchestrator(input: {
    journeyIds?: string[]; runId: string; clean?: boolean;
  }): Promise<JourneyOrchestratorSummary> {
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: "journeys-test",
      workflowsPath: path.resolve(import.meta.dirname, "journeys.workflows.ts"),
      activities: mockActivities,
    });
    return worker.runUntil(
      env.client.workflow.execute("journeyOrchestratorWorkflow", {
        workflowId: `test-${input.runId}`,
        taskQueue: "journeys-test",
        args: [input],
      }),
    ) as Promise<JourneyOrchestratorSummary>;
  }

  it("runs the requested journeys sequentially and aggregates results", async () => {
    calls.journeys.length = 0;
    const summary = await runOrchestrator({ journeyIds: ["J03", "J01", "J07"], runId: "run-t1" });
    expect(calls.journeys).toEqual(["J03", "J01", "J07"]); // input order, sequential
    expect(summary.runId).toBe("run-t1");
    expect(summary.results.map(r => r.journeyId)).toEqual(["J03", "J01", "J07"]);
    expect(summary.allPassed).toBe(true);
    expect(summary.results[0].asserts).toBe(3);
    // seedBaseline ran first with clean defaulting false, reportActivity last
    expect(calls.seed.at(-1)).toEqual({ runId: "run-t1", clean: false, scale: "small" });
    expect(calls.reports.at(-1)?.runId).toBe("run-t1");
  }, 120_000);

  it("defaults to all 20 catalog journeys when journeyIds is omitted", async () => {
    calls.journeys.length = 0;
    const summary = await runOrchestrator({ runId: "run-t2", clean: true });
    expect(calls.journeys).toEqual([...DEFAULT_JOURNEY_IDS]);
    expect(summary.results).toHaveLength(20);
    expect(summary.allPassed).toBe(true);
    expect(calls.seed.at(-1)).toEqual({ runId: "run-t2", clean: true, scale: "small" });
  }, 120_000);

  it("allPassed=false when any journey reports FAIL, and later journeys still run", async () => {
    calls.journeys.length = 0;
    journeyStatuses = { J02: "FAIL" };
    const summary = await runOrchestrator({ journeyIds: ["J01", "J02", "J03"], runId: "run-t3" });
    expect(calls.journeys).toEqual(["J01", "J02", "J03"]);
    expect(summary.allPassed).toBe(false);
    expect(summary.results.find(r => r.journeyId === "J02")?.status).toBe("FAIL");
    journeyStatuses = {};
  }, 120_000);

  it("singleJourneyWorkflow executes exactly one journey", async () => {
    calls.journeys.length = 0;
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: "journeys-test",
      workflowsPath: path.resolve(import.meta.dirname, "journeys.workflows.ts"),
      activities: mockActivities,
    });
    const summary = (await worker.runUntil(
      env.client.workflow.execute("singleJourneyWorkflow", {
        workflowId: "test-single",
        taskQueue: "journeys-test",
        args: [{ journeyId: "J12", runId: "run-t4" }],
      }),
    )) as JourneyOrchestratorSummary;
    expect(calls.journeys).toEqual(["J12"]);
    expect(summary.results).toHaveLength(1);
    expect(summary.allPassed).toBe(true);
  }, 120_000);
});
