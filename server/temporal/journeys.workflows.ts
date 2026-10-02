/**
 * server/temporal/journeys.workflows.ts
 *
 * Temporal workflow definitions for the reusable stakeholder journeys.
 *
 * DETERMINISM RULES honored here:
 *  - No Date.now/Math.random/network/DB access — all effects live in
 *    activities (journeys.activities.ts), invoked via proxyActivities.
 *  - Only pure modules are imported (journeys.shared.ts + type-only activity
 *    signatures), so the workflow bundle is side-effect-free.
 *  - Journey order is fixed by input (or DEFAULT_JOURNEY_IDS); results are
 *    aggregated in sequence — replay produces identical commands.
 */
import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "./journeys.activities";
import {
  DEFAULT_JOURNEY_IDS,
  type JourneyOrchestratorInput,
  type JourneyOrchestratorSummary,
  type JourneyRunResult,
  type SingleJourneyInput,
} from "./journeys.shared";

const {
  seedBaselineActivity,
  runJourneyActivity,
  reportActivity,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "10m",
  heartbeatTimeout: "2m",
  retry: {
    initialInterval: "5s",
    backoffCoefficient: 2,
    maximumInterval: "1m",
    maximumAttempts: 3,
    // Assertion failures are business verdicts, never retried (the activity
    // reports them as data; this also covers any thrown JourneyAssertionError).
    nonRetryableErrorTypes: ["JourneyAssertionError"],
  },
});

/**
 * Runs the requested journeys SEQUENTIALLY through the existing tRPC services
 * (each journey executes inside one activity), then records a summary row.
 */
export async function journeyOrchestratorWorkflow(
  input: JourneyOrchestratorInput,
): Promise<JourneyOrchestratorSummary> {
  const journeyIds = input.journeyIds?.length
    ? input.journeyIds
    : [...DEFAULT_JOURNEY_IDS];

  await seedBaselineActivity({
    runId: input.runId,
    clean: input.clean ?? false,
    scale: input.scale ?? "small",
  });

  const results: JourneyRunResult[] = [];
  for (const journeyId of journeyIds) {
    results.push(await runJourneyActivity({ journeyId, runId: input.runId }));
  }

  const summary: JourneyOrchestratorSummary = {
    runId: input.runId,
    results,
    allPassed: results.every(r => r.status === "PASS"),
  };
  await reportActivity(summary);
  return summary;
}

/** Runs exactly one journey; returns its result (summary of one). */
export async function singleJourneyWorkflow(
  input: SingleJourneyInput,
): Promise<JourneyOrchestratorSummary> {
  return journeyOrchestratorWorkflow({
    journeyIds: [input.journeyId],
    runId: input.runId,
    clean: false,
    scale: "small",
  });
}
