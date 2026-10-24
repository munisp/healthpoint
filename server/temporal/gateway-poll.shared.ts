/**
 * server/temporal/gateway-poll.shared.ts — Phase 20-B.
 *
 * PURE constants shared by workflow/activity/scheduler code. Workflow
 * bundles may only import side-effect-free modules — NEVER import server/db,
 * routers, or Node I/O here (journeys.shared.ts precedent).
 */

export const GATEWAY_STATUS_POLL_SCHEDULE_ID = "gateway-status-poll";
export const GATEWAY_STATUS_POLL_WORKFLOW = "gatewayStatusPollWorkflow";

/** Terminal gateway statuses the poller stops polling. */
export const GATEWAY_TERMINAL_STATUSES = ["determination_issued", "ineligible"] as const;

export interface GatewayPollRunSummary {
  runId: string;
  polled: number;
  changed: number;
  failures: string[];
  mode: "configured" | "disabled";
}
