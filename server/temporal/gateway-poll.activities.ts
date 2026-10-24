/**
 * server/temporal/gateway-poll.activities.ts — Phase 20-B.
 *
 * Polls the CMS IDR Gateway status for every dispute with a
 * gateway_submission_id in a non-terminal state, persists status changes,
 * and appends an audit entry per change. FAIL-CLOSED: when the connector is
 * disabled (no CMS_GATEWAY_* env) the activity logs and no-ops — the
 * assisted-manual portal-package flow is unaffected.
 *
 * ASSUMPTION-based transport: see server/idr/gateway/connector.ts header.
 */
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { getDb, createAuditEntry } from "../db";
import { disputes } from "../../drizzle/schema";
import { getGatewayConnector } from "../idr/gateway/connector";
import { GATEWAY_TERMINAL_STATUSES, type GatewayPollRunSummary } from "./gateway-poll.shared";

export async function pollGatewayStatusesActivity(input: { runId: string }): Promise<GatewayPollRunSummary> {
  const connector = getGatewayConnector();
  const summary: GatewayPollRunSummary = {
    runId: input.runId,
    polled: 0,
    changed: 0,
    failures: [],
    mode: connector.mode,
  };
  if (connector.mode === "disabled") {
    console.log("[gateway-status-poll] connector DISABLED (no CMS_GATEWAY_* env) — no-op; assisted-manual flow unaffected");
    return summary;
  }
  const db = await getDb();
  if (!db) {
    console.warn("[gateway-status-poll] no database — no-op");
    return summary;
  }
  const rows = await db
    .select({ id: disputes.id, gatewaySubmissionId: disputes.gatewaySubmissionId, gatewayStatus: disputes.gatewayStatus })
    .from(disputes)
    .where(and(
      isNotNull(disputes.gatewaySubmissionId),
      sql`(${disputes.gatewayStatus} IS NULL OR ${disputes.gatewayStatus} NOT IN (${sql.join(GATEWAY_TERMINAL_STATUSES.map(s => sql`${s}`), sql`, `)}))`,
    ));
  for (const row of rows) {
    summary.polled++;
    try {
      const res = await connector.pollStatus(row.gatewaySubmissionId!);
      if (res.status !== "unknown" && res.status !== row.gatewayStatus) {
        await db.update(disputes)
          .set({ gatewayStatus: res.status, updatedAt: new Date() })
          .where(eq(disputes.id, row.id));
        await createAuditEntry({
          userId: "system:gateway-status-poll",
          action: "gateway.statusPoll.changed",
          entityType: "dispute",
          entityId: row.id,
          oldValue: JSON.stringify({ gatewayStatus: row.gatewayStatus }),
          newValue: JSON.stringify({ gatewayStatus: res.status, detail: res.detail ?? null }),
          ipAddress: null,
          userAgent: null,
        });
        summary.changed++;
      }
    } catch (err) {
      summary.failures.push(`${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`[gateway-status-poll] run ${input.runId}: polled=${summary.polled} changed=${summary.changed} failures=${summary.failures.length}`);
  return summary;
}
