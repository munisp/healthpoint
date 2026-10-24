/**
 * server/temporal/lakehouse.workflows.ts
 *
 * `lakehouseExportWorkflow` — incremental PG→S3 lakehouse export, one
 * activity per dataset, then a run-status record activity.
 *
 * DETERMINISM RULES honored (same as journeys.workflows.ts):
 *  - No Date.now/Math.random/network/DB access in workflow code — all
 *    effects live in activities (lakehouse.activities.ts).
 *  - Only pure modules imported (lakehouse.shared.ts + type-only activity
 *    signatures), so the workflow bundle is side-effect-free.
 *  - Dataset order is fixed by input (or LAKEHOUSE_EXPORT_DATASETS) — replay
 *    produces identical commands.
 */
import { proxyActivities, workflowInfo } from "@temporalio/workflow";
import type * as activities from "./lakehouse.activities";
import {
  LAKEHOUSE_EXPORT_DATASETS,
  type LakehouseDatasetExportResult,
  type LakehouseExportSummary,
  type LakehouseExportWorkflowInput,
} from "./lakehouse.shared";

const {
  runIncrementalExportActivity,
  recordExportRunStatusActivity,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "15m",
  heartbeatTimeout: "2m",
  retry: {
    initialInterval: "10s",
    backoffCoefficient: 2,
    maximumInterval: "5m",
    maximumAttempts: 3,
  },
});

/**
 * Exports each requested dataset SEQUENTIALLY (incremental, watermarked),
 * then records an aggregate run-status row. A dataset failure is captured in
 * `failures` and the summary is still recorded — honest partial success.
 */
export async function lakehouseExportWorkflow(
  input: LakehouseExportWorkflowInput,
): Promise<LakehouseExportSummary> {
  const datasets = input.datasets?.length
    ? input.datasets
    : [...LAKEHOUSE_EXPORT_DATASETS];
  // Workflow-side runId fallback must stay deterministic: the Temporal run
  // id of THIS workflow execution is unique per scheduled firing and stable
  // under replay.
  const runId = input.runId ?? `lakehouse-export-${workflowInfo().runId}`;

  const results: LakehouseDatasetExportResult[] = [];
  const failures: string[] = [];

  for (const dataset of datasets) {
    try {
      results.push(await runIncrementalExportActivity({ runId, dataset }));
    } catch (err) {
      // Retries exhausted: record the failure honestly and continue with the
      // remaining datasets rather than aborting the whole export.
      failures.push(`${dataset}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const summary: LakehouseExportSummary = {
    runId,
    datasets,
    results,
    totalRows: results.reduce((n, r) => n + r.rowCount, 0),
    failures,
    succeeded: failures.length === 0,
  };
  await recordExportRunStatusActivity(summary);
  return summary;
}
