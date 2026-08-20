import { createAuditEntry } from "../server/db";
import { describeTemporalFailure, getTemporalClient, getTemporalConfiguration, isTemporalDispatchEnabled } from "../server/temporal";

const actorId = process.env.TEMPORAL_STATUS_ACTOR_ID?.trim() || "temporal-supervisor";

async function main() {
  try {
    const configured = getTemporalConfiguration();
    const { config } = await getTemporalClient();
    const evidence = {
      kind: "TEMPORAL_SUPERVISED_READ_ONLY_STATUS_CHECK",
      outcome: "secure_connection_verified",
      verification: config.usingDevelopmentDefaults ? "unverified_default" : "operator_configured",
      address: config.address,
      serverName: config.serverName,
      namespace: config.namespace,
      taskQueue: config.taskQueue,
      workflowType: config.workflowType,
      dispatchEnabled: isTemporalDispatchEnabled(),
      checkedAt: new Date().toISOString(),
    };
    const audit = await createAuditEntry({
      userId: actorId,
      action: "temporal.connection_check.verified",
      entityType: "temporal_connection",
      entityId: config.serverName,
      oldValue: null,
      newValue: JSON.stringify(evidence),
      ipAddress: null,
      userAgent: "healthpoint-supervised-status-script",
    });
    console.log(JSON.stringify({ reachable: true, verification: evidence.verification, namespace: config.namespace, taskQueue: config.taskQueue, dispatchEnabled: evidence.dispatchEnabled, auditId: audit.id }));
    process.exit(0);
  } catch (error) {
    const recovery = describeTemporalFailure(error, (error as { recovery?: { attempts?: number } })?.recovery?.attempts ?? 1);
    const evidence = {
      kind: "TEMPORAL_SUPERVISED_READ_ONLY_STATUS_CHECK",
      outcome: "secure_connection_failed",
      verification: "unverified_default",
      recovery,
      dispatchEnabled: isTemporalDispatchEnabled(),
      checkedAt: new Date().toISOString(),
    };
    const audit = await createAuditEntry({
      userId: actorId,
      action: "temporal.connection_check.failed",
      entityType: "temporal_connection",
      entityId: "temporal-supervised-status-check",
      oldValue: null,
      newValue: JSON.stringify(evidence),
      ipAddress: null,
      userAgent: "healthpoint-supervised-status-script",
    });
    console.error(JSON.stringify({ reachable: false, recovery, auditId: audit.id }));
    process.exit(1);
  }
}

void main();
