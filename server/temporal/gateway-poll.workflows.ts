/**
 * server/temporal/gateway-poll.workflows.ts — Phase 20-B.
 *
 * `gatewayStatusPollWorkflow` — polls CMS IDR Gateway statuses for open
 * gateway-submitted disputes. Determinism rules honored (journeys/lakehouse
 * precedent): all effects live in gateway-poll.activities.ts; only pure
 * modules + type-only activity signatures imported here.
 */
import { proxyActivities, workflowInfo } from "@temporalio/workflow";
import type * as activities from "./gateway-poll.activities";
import type { GatewayPollRunSummary } from "./gateway-poll.shared";

const { pollGatewayStatusesActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: "10m",
  retry: {
    initialInterval: "10s",
    backoffCoefficient: 2,
    maximumInterval: "5m",
    maximumAttempts: 3,
  },
});

export async function gatewayStatusPollWorkflow(input: { runId?: string }): Promise<GatewayPollRunSummary> {
  // Deterministic runId: Temporal run id is unique per scheduled firing.
  const runId = input.runId ?? `gateway-status-poll-${workflowInfo().runId}`;
  return pollGatewayStatusesActivity({ runId });
}
