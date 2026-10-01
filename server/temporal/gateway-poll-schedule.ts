/**
 * server/temporal/gateway-poll-schedule.ts — Phase 20-B.
 *
 * Scheduler for CMS IDR Gateway status polling, mirroring the canonical
 * lakehouse-schedule.ts gate semantics EXACTLY:
 *   GATEWAY_STATUS_POLL_ENABLED !== "true" OR connector unconfigured
 *       → disabled; logs honestly and returns { mode: "disabled" }.
 *   enabled + TEMPORAL_EXECUTION_ENABLED
 *       → Temporal Schedule `gateway-status-poll` starting
 *         gatewayStatusPollWorkflow on the journeys task queue.
 *   enabled + Temporal NOT configured
 *       → cron-lite in-process interval fallback (GATEWAY_STATUS_POLL_CRON,
 *         default @hourly) calling the activity directly; logs the honest
 *         "NOT durable across restarts" warning.
 *
 * ASSUMPTION-based transport: CMS has published no public M2M Gateway API
 * spec as of 2026-09 — see server/idr/gateway/connector.ts header. The
 * interval-fallback math and gate logic are EXECUTED-VERIFIED in vitest;
 * live polling is UNVERIFIABLE without CMS-issued credentials.
 */
import { randomUUID } from "node:crypto";
import { isTemporalDispatchEnabled } from "../temporal";
import { resolveGatewayConfig } from "../idr/gateway/connector";
import { cronToIntervalMs } from "./lakehouse-schedule";
import { GATEWAY_STATUS_POLL_SCHEDULE_ID, GATEWAY_STATUS_POLL_WORKFLOW } from "./gateway-poll.shared";

export function gatewayStatusPollEnabled(
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): boolean {
  return env.GATEWAY_STATUS_POLL_ENABLED === "true";
}

export type GatewayPollScheduleMode = "disabled" | "temporal" | "interval-fallback";

export interface GatewayPollScheduleRegistration {
  mode: GatewayPollScheduleMode;
  scheduleId?: string;
  intervalMs?: number;
  /** Stops the interval fallback (undefined for other modes). */
  stop?: () => void;
}

async function runPollOnce(runId: string): Promise<void> {
  const { pollGatewayStatusesActivity } = await import("./gateway-poll.activities");
  await pollGatewayStatusesActivity({ runId });
}

/**
 * Register the gateway status poll schedule. See header for gate semantics.
 * The interval fallback fires the poll immediately on registration only when
 * `fireImmediately` is set (default false — first run at first tick).
 */
export async function registerGatewayStatusPollSchedule(opts: {
  fireImmediately?: boolean;
  env?: Record<string, string | undefined>;
} = {}): Promise<GatewayPollScheduleRegistration> {
  const env = opts.env ?? process.env;
  if (!gatewayStatusPollEnabled(env)) {
    console.log("[gateway-status-poll] GATEWAY_STATUS_POLL_ENABLED is not 'true' — status polling disabled (no polls will occur)");
    return { mode: "disabled" };
  }
  if (!resolveGatewayConfig(env)) {
    console.log("[gateway-status-poll] connector not configured (CMS_GATEWAY_* missing) — status polling disabled; assisted-manual flow unaffected");
    return { mode: "disabled" };
  }

  const cron = env.GATEWAY_STATUS_POLL_CRON?.trim() || "@hourly";

  if (isTemporalDispatchEnabled()) {
    const { ScheduleClient, Connection } = await import("@temporalio/client");
    const { getTemporalConfiguration } = await import("../temporal");
    const config = getTemporalConfiguration();
    const connection = await Connection.connect({
      address: process.env.TEMPORAL_ADDRESS?.trim() || "127.0.0.1:7233",
      apiKey: process.env.TEMPORAL_AUTH_TOKEN?.trim() || undefined,
    });
    const client = new ScheduleClient({ connection, namespace: config.namespace });
    await client.create({
      scheduleId: GATEWAY_STATUS_POLL_SCHEDULE_ID,
      spec: { cronExpressions: [cron] },
      action: {
        type: "startWorkflow",
        workflowType: GATEWAY_STATUS_POLL_WORKFLOW,
        taskQueue: process.env.TEMPORAL_JOURNEYS_TASK_QUEUE?.trim() || "healthpoint-journeys",
        args: [{}],
      },
    });
    console.log(`[gateway-status-poll] Temporal schedule '${GATEWAY_STATUS_POLL_SCHEDULE_ID}' registered (cron='${cron}', namespace=${config.namespace})`);
    return { mode: "temporal", scheduleId: GATEWAY_STATUS_POLL_SCHEDULE_ID };
  }

  const intervalMs = cronToIntervalMs(cron);
  if (intervalMs == null) {
    console.warn(`[gateway-status-poll] GATEWAY_STATUS_POLL_CRON='${cron}' is outside the cron-lite fallback subset (@hourly|@daily|@weekly|*/N * * * *) — Temporal is NOT configured, falling back to hourly interval`);
  } else {
    console.warn(`[gateway-status-poll] Temporal not configured (TEMPORAL_EXECUTION_ENABLED!=true) — using in-process interval fallback every ${(intervalMs ?? 3_600_000) / 60_000}m. This is NOT durable across restarts; configure Temporal for the canonical schedule.`);
  }
  const effective = intervalMs ?? 60 * 60 * 1000;
  const tick = () => {
    const runId = `gateway-poll-interval-${randomUUID()}`;
    runPollOnce(runId).catch(err =>
      console.error(`[gateway-status-poll] interval run ${runId} failed:`, err instanceof Error ? err.message : err));
  };
  if (opts.fireImmediately) tick();
  const timer = setInterval(tick, effective);
  if (typeof timer.unref === "function") timer.unref();
  return { mode: "interval-fallback", intervalMs: effective, stop: () => clearInterval(timer) };
}
