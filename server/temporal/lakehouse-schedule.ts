/**
 * server/temporal/lakehouse-schedule.ts
 *
 * Canonical scheduler for the lakehouse export pipeline: a Temporal Schedule
 * firing `lakehouseExportWorkflow` on LAKEHOUSE_EXPORT_CRON.
 *
 * Gate semantics (all honestly logged, never silent):
 *   LAKEHOUSE_EXPORT_ENABLED !== "true"
 *       → disabled; logs and returns { mode: "disabled" }.
 *   enabled + Temporal dispatch enabled (TEMPORAL_EXECUTION_ENABLED)
 *       → creates/updates Temporal Schedule `lakehouse-export`
 *         (mode: "temporal").
 *   enabled + Temporal NOT configured
 *       → cron-lite fallback: in-process interval derived from
 *         LAKEHOUSE_EXPORT_CRON (supports "@hourly", "@daily", and
 *         "STAR-slash-N minutes" style `*\/N * * * *`; anything else logs an
 *         honest unsupported-cron warning and falls back to hourly). Runs the
 *         same activity logic directly. mode: "interval-fallback".
 *
 * This helper is invoked from server bootstrap by the server/** owners
 * (integration point documented in docs/LAKEHOUSE.md); it is also invoked
 * from server/temporal/worker.ts when the journeys worker boots, so a
 * Temporal deployment self-registers the schedule.
 *
 * Label: STATIC-ONLY in this sandbox (no Temporal server, no S3) — the
 * interval-fallback math and gate logic are EXECUTED-VERIFIED in vitest.
 */
import { randomUUID } from "node:crypto";
import { isTemporalDispatchEnabled } from "../temporal";
import { LAKEHOUSE_EXPORT_DATASETS } from "./lakehouse.shared";

export const LAKEHOUSE_EXPORT_SCHEDULE_ID = "lakehouse-export";

export function lakehouseExportEnabled(
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): boolean {
  return env.LAKEHOUSE_EXPORT_ENABLED === "true";
}

/**
 * Parse the cron-lite subset of LAKEHOUSE_EXPORT_CRON into an interval in ms.
 * Supported: "@hourly", "@daily", "@weekly", "*\/N * * * *" (every N
 * minutes). Returns null when unsupported — callers must log honestly.
 */
export function cronToIntervalMs(cron: string | undefined): number | null {
  const c = (cron ?? "").trim();
  if (!c) return 60 * 60 * 1000; // default hourly
  if (c === "@hourly") return 60 * 60 * 1000;
  if (c === "@daily") return 24 * 60 * 60 * 1000;
  if (c === "@weekly") return 7 * 24 * 60 * 60 * 1000;
  const m = c.match(/^\*\/(\d{1,2}) \* \* \* \*$/);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 59) return n * 60 * 1000;
  }
  return null;
}

export type LakehouseScheduleMode = "disabled" | "temporal" | "interval-fallback";

export interface LakehouseScheduleRegistration {
  mode: LakehouseScheduleMode;
  scheduleId?: string;
  intervalMs?: number;
  /** Stops the interval fallback (undefined for other modes). */
  stop?: () => void;
}

async function runExportOnce(runId: string): Promise<void> {
  const { runIncrementalExportActivity, recordExportRunStatusActivity } =
    await import("./lakehouse.activities");
  const results = [];
  const failures: string[] = [];
  for (const dataset of LAKEHOUSE_EXPORT_DATASETS) {
    try {
      results.push(await runIncrementalExportActivity({ runId, dataset }));
    } catch (err) {
      failures.push(`${dataset}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  await recordExportRunStatusActivity({
    runId,
    datasets: [...LAKEHOUSE_EXPORT_DATASETS],
    results,
    totalRows: results.reduce((n, r) => n + r.rowCount, 0),
    failures,
    succeeded: failures.length === 0,
  });
}

/**
 * Register the lakehouse export schedule. See header for gate semantics.
 * The interval fallback fires the export immediately on registration only
 * when `fireImmediately` is set (default false — first run at first tick).
 */
export async function registerLakehouseExportSchedule(opts: {
  fireImmediately?: boolean;
  env?: Record<string, string | undefined>;
} = {}): Promise<LakehouseScheduleRegistration> {
  const env = opts.env ?? process.env;
  if (!lakehouseExportEnabled(env)) {
    console.log("[lakehouse-export] LAKEHOUSE_EXPORT_ENABLED is not 'true' — export schedule disabled (no runs will occur)");
    return { mode: "disabled" };
  }

  const cron = env.LAKEHOUSE_EXPORT_CRON?.trim() || "@hourly";

  if (isTemporalDispatchEnabled()) {
    // Canonical path: Temporal Schedule on the journeys task queue.
    const { ScheduleClient } = await import("@temporalio/client");
    const { getTemporalConfiguration } = await import("../temporal");
    const config = getTemporalConfiguration();
    const { Connection } = await import("@temporalio/client");
    const connection = await Connection.connect({
      address: process.env.TEMPORAL_ADDRESS?.trim() || "127.0.0.1:7233",
      apiKey: process.env.TEMPORAL_AUTH_TOKEN?.trim() || undefined,
    });
    const client = new ScheduleClient({
      connection,
      namespace: config.namespace,
    });
    await client.create({
      scheduleId: LAKEHOUSE_EXPORT_SCHEDULE_ID,
      spec: { cronExpressions: [cron] },
      action: {
        type: "startWorkflow",
        workflowType: "lakehouseExportWorkflow",
        taskQueue: process.env.TEMPORAL_JOURNEYS_TASK_QUEUE?.trim() || "healthpoint-journeys",
        // No static runId: the workflow derives a deterministic unique runId
        // from workflowInfo().runId per firing.
        args: [{}],
      },
    });
    console.log(`[lakehouse-export] Temporal schedule '${LAKEHOUSE_EXPORT_SCHEDULE_ID}' registered (cron='${cron}', namespace=${config.namespace})`);
    return { mode: "temporal", scheduleId: LAKEHOUSE_EXPORT_SCHEDULE_ID };
  }

  // Fallback: Temporal not configured — cron-lite in-process interval.
  const intervalMs = cronToIntervalMs(cron);
  if (intervalMs == null) {
    console.warn(`[lakehouse-export] LAKEHOUSE_EXPORT_CRON='${cron}' is outside the cron-lite fallback subset (@hourly|@daily|@weekly|*/N * * * *) — Temporal is NOT configured, falling back to hourly interval`);
  } else {
    console.warn(`[lakehouse-export] Temporal not configured (TEMPORAL_EXECUTION_ENABLED!=true) — using in-process interval fallback every ${(intervalMs ?? 3_600_000) / 60_000}m. This is NOT durable across restarts; configure Temporal for the canonical schedule.`);
  }
  const effective = intervalMs ?? 60 * 60 * 1000;
  const tick = () => {
    const runId = `lakehouse-interval-${randomUUID()}`;
    runExportOnce(runId).catch(err =>
      console.error(`[lakehouse-export] interval run ${runId} failed:`, err instanceof Error ? err.message : err));
  };
  if (opts.fireImmediately) tick();
  const timer = setInterval(tick, effective);
  if (typeof timer.unref === "function") timer.unref();
  return { mode: "interval-fallback", intervalMs: effective, stop: () => clearInterval(timer) };
}
