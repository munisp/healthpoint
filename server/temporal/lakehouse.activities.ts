/**
 * server/temporal/lakehouse.activities.ts
 *
 * Activities for `lakehouseExportWorkflow`:
 *   runIncrementalExportActivity   — incremental PG→S3 export for one
 *                                    dataset with watermark bookkeeping
 *                                    (server/lakehouse/export.ts).
 *   recordExportRunStatusActivity  — aggregate run-status row in the
 *                                    internal bookkeeping table.
 *
 * Labels: activity logic EXECUTED-VERIFIED against embedded PG in vitest
 * (watermark unit tests) with S3 writes exercised only when storage env is
 * configured; workflow wiring MOCK-VERIFIED via @temporalio/testing with
 * stub activities (lakehouse.test.ts).
 */
import { recordExportRun } from "../lakehouse/bookkeeping";
import { runIncrementalLakehouseExport } from "../lakehouse/export";
import type {
  LakehouseDatasetExportResult,
  LakehouseExportDataset,
  LakehouseExportSummary,
} from "./lakehouse.shared";

export async function runIncrementalExportActivity(input: {
  runId: string;
  dataset: LakehouseExportDataset;
}): Promise<LakehouseDatasetExportResult> {
  const r = await runIncrementalLakehouseExport(input.dataset, input.runId);
  return {
    dataset: r.dataset,
    rowCount: r.rowCount,
    s3Key: r.s3Key,
    previousWatermark: r.previousWatermark,
    newWatermark: r.newWatermark,
  };
}

export async function recordExportRunStatusActivity(
  summary: LakehouseExportSummary,
): Promise<{ recorded: boolean }> {
  const id = await recordExportRun({
    runId: summary.runId,
    dataset: "__summary__",
    status: summary.succeeded ? "succeeded" : "failed",
    rowCount: summary.totalRows,
    detail: summary.failures.length ? summary.failures.join("; ") : undefined,
  });
  return { recorded: id != null };
}
