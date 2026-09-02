import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client, Connection, WorkflowExecutionAlreadyStartedError } from "@temporalio/client";
import { observeDependencyOperation } from "./_core/telemetry";

export type TemporalConfiguration = {
  address: string;
  authToken: string;
  serverName: string;
  namespace: string;
  taskQueue: string;
  workflowType: string;
  caPath: string;
  usingDevelopmentDefaults: boolean;
};

const DEVELOPMENT_DEFAULTS = {
  address: "127.0.0.1:7233",
  serverName: "temporal.newfire.app",
  namespace: "default",
  taskQueue: "healthpoint-idr",
  workflowType: "idrDisputeWorkflow",
} as const;

let cachedConnection: Connection | null = null;
let cachedClient: Client | null = null;
const TEMPORAL_CONNECTION_ATTEMPTS = 3;
const TEMPORAL_RETRY_DELAY_MS = 125;

export type TemporalRecoveryDetails = {
  code: "temporal_unavailable" | "temporal_configuration" | "temporal_dispatch_disabled";
  retryable: boolean;
  attempts: number;
  message: string;
  guidance: string;
};

export type TemporalConnectionFailureRecord = {
  action: string;
  createdAt: Date | string;
  newValue?: string | null;
};

export function summarizeTemporalConnectionFailures(records: TemporalConnectionFailureRecord[], now = new Date(), threshold = 3, windowMinutes = 15) {
  const since = now.getTime() - windowMinutes * 60_000;
  const failures = records.filter(record => record.action === "temporal.connection_check.failed" && new Date(record.createdAt).getTime() >= since);
  return {
    threshold,
    windowMinutes,
    failureCount: failures.length,
    visible: failures.length >= threshold,
    severity: failures.length >= threshold ? "critical" as const : failures.length > 0 ? "warning" as const : "clear" as const,
    failures,
  };
}

export class TemporalClientFailure extends Error {
  constructor(public readonly recovery: TemporalRecoveryDetails, cause?: unknown) {
    super(recovery.message, { cause });
    this.name = "TemporalClientFailure";
  }
}

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function configuredValue(name: string, fallback: string, requireInProduction = true): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (isProduction() && requireInProduction) {
    throw new Error(`${name} is required for Temporal in production`);
  }
  return fallback;
}

function resolveCaPath(): string {
  const configured = process.env.TEMPORAL_CA_PATH?.trim();
  const candidate = configured || (isProduction()
    ? "/app/infra/certs/temporal-ca.crt"
    : path.resolve(process.cwd(), "infra/certs/temporal-ca.crt"));
  if (!existsSync(candidate)) {
    throw new Error("Temporal CA certificate is not readable");
  }
  return candidate;
}

/**
 * Resolves a complete configuration for the standard Temporal application client.
 * Development defaults make local integration testable; production never substitutes
 * an address, identity, queue, namespace, workflow type, or bearer credential.
 */
export function getTemporalConfiguration(): TemporalConfiguration {
  const authToken = process.env.TEMPORAL_AUTH_TOKEN?.trim() || "";
  if (isProduction() && !authToken) {
    throw new Error("TEMPORAL_AUTH_TOKEN is required for Temporal in production");
  }

  const usingDevelopmentDefaults = ![
    "TEMPORAL_ADDRESS",
    "TEMPORAL_TLS_SERVER_NAME",
    "TEMPORAL_NAMESPACE",
    "TEMPORAL_TASK_QUEUE",
    "TEMPORAL_WORKFLOW_TYPE",
  ].every(name => Boolean(process.env[name]?.trim()));

  return {
    address: configuredValue("TEMPORAL_ADDRESS", DEVELOPMENT_DEFAULTS.address),
    authToken,
    serverName: configuredValue("TEMPORAL_TLS_SERVER_NAME", DEVELOPMENT_DEFAULTS.serverName),
    namespace: configuredValue("TEMPORAL_NAMESPACE", DEVELOPMENT_DEFAULTS.namespace),
    taskQueue: configuredValue("TEMPORAL_TASK_QUEUE", DEVELOPMENT_DEFAULTS.taskQueue),
    workflowType: configuredValue("TEMPORAL_WORKFLOW_TYPE", DEVELOPMENT_DEFAULTS.workflowType),
    caPath: resolveCaPath(),
    usingDevelopmentDefaults,
  };
}

/** Workflow dispatch is off unless explicitly enabled; it is never inferred from connectivity. */
export function isTemporalDispatchEnabled(): boolean {
  return process.env.TEMPORAL_EXECUTION_ENABLED === "true";
}

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableConnectionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unavailable|deadline|timeout|econnreset|econnrefused|enotfound|socket|network/i.test(message);
}

export function describeTemporalFailure(error: unknown, attempts = 1): TemporalRecoveryDetails {
  const message = error instanceof Error ? error.message : String(error);
  if (/dispatch is disabled/i.test(message)) {
    return {
      code: "temporal_dispatch_disabled",
      retryable: false,
      attempts,
      message: "Temporal dispatch is currently disabled.",
      guidance: "Keep payment execution disabled and enable Temporal dispatch only after an approved worker, namespace, queue, and workflow type have been verified.",
    };
  }
  if (/required for Temporal|CA certificate|configuration/i.test(message)) {
    return {
      code: "temporal_configuration",
      retryable: false,
      attempts,
      message: "Temporal configuration is incomplete or cannot be trusted.",
      guidance: "Confirm the operator-issued endpoint hostname, CA path, namespace, task queue, workflow type, and bearer credential before retrying.",
    };
  }
  return {
    code: "temporal_unavailable",
    retryable: isRetryableConnectionError(error),
    attempts,
    message: "HealthPoint could not reach Temporal securely.",
    guidance: "The system made bounded retry attempts. Verify the approved Temporal service and worker are available, then retry from the operations dashboard.",
  };
}

/** Bounded retry helper used only for connection establishment; workflow commands are never retried implicitly. */
export async function withTemporalConnectionRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= TEMPORAL_CONNECTION_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryableConnectionError(error) || attempt === TEMPORAL_CONNECTION_ATTEMPTS) {
        throw new TemporalClientFailure(describeTemporalFailure(error, attempt), error);
      }
      await wait(TEMPORAL_RETRY_DELAY_MS * attempt);
    }
  }
  throw new TemporalClientFailure(describeTemporalFailure(lastError, TEMPORAL_CONNECTION_ATTEMPTS), lastError);
}

export async function getTemporalClient(): Promise<{ client: Client; config: TemporalConfiguration }> {
  const config = getTemporalConfiguration();
  if (cachedClient) return { client: cachedClient, config };

  const connection = await observeDependencyOperation("temporal", "connect", () => withTemporalConnectionRetry(() => Connection.connect({
    address: config.address,
    apiKey: config.authToken || undefined,
    tls: {
      serverRootCACertificate: readFileSync(config.caPath),
      serverNameOverride: config.serverName,
    },
    connectTimeout: 10_000,
  })));
  cachedConnection = connection;
  cachedClient = new Client({ connection, namespace: config.namespace });
  return { client: cachedClient, config };
}

export type TemporalWorkflowSummary = {
  workflowId: string;
  runId?: string;
  status: string;
  startTime: string;
  closeTime?: string;
  taskQueue?: string;
  source: "temporal";
};

function toWorkflowSummary(execution: {
  workflowId: string;
  runId?: string;
  status: { name: string };
  startTime: Date;
  closeTime?: Date;
  taskQueue?: string;
}): TemporalWorkflowSummary {
  return {
    workflowId: execution.workflowId,
    runId: execution.runId,
    status: execution.status.name,
    startTime: execution.startTime.toISOString(),
    closeTime: execution.closeTime?.toISOString(),
    taskQueue: execution.taskQueue,
    source: "temporal",
  };
}

export async function getDisputeTemporalWorkflow(disputeId: string): Promise<TemporalWorkflowSummary> {
  const { client } = await getTemporalClient();
  const workflowId = `idr-dispute-${disputeId}`;
  return observeDependencyOperation("temporal", "workflow_describe", async () =>
    toWorkflowSummary(await client.workflow.getHandle(workflowId).describe())
  );
}

export async function listTemporalWorkflows(limit: number, status?: string): Promise<TemporalWorkflowSummary[]> {
  const { client } = await getTemporalClient();
  const items: TemporalWorkflowSummary[] = [];
  return observeDependencyOperation("temporal", "workflow_list", async () => {
    for await (const execution of client.workflow.list({ pageSize: Math.min(limit * 2, 100) })) {
      const item = toWorkflowSummary(execution);
      if (!status || item.status === status) items.push(item);
      if (items.length === limit) break;
    }
    return items;
  });
}

/**
 * Starts one durable workflow per dispute. Repeated requests return the existing
 * execution instead of creating a duplicate. This function only schedules a
 * workflow; it cannot advance a dispute or create a payment instruction.
 */
export async function startDisputeTemporalWorkflow(disputeId: string, requestedBy: string) {
  if (!isTemporalDispatchEnabled()) {
    throw new Error("Temporal workflow dispatch is disabled");
  }
  const { client, config } = await getTemporalClient();
  const workflowId = `idr-dispute-${disputeId}`;
  try {
    const handle = await observeDependencyOperation("temporal", "workflow_start", () => client.workflow.start(config.workflowType, {
      workflowId,
      taskQueue: config.taskQueue,
      args: [{ disputeId, requestedBy, requestedAt: new Date().toISOString() }],
    }));
    return { workflowId, runId: handle.firstExecutionRunId, reusedExisting: false };
  } catch (error) {
    if (error instanceof WorkflowExecutionAlreadyStartedError || (error as Error).name === "WorkflowExecutionAlreadyStartedError") {
      return { workflowId, runId: undefined, reusedExisting: true };
    }
    throw error;
  }
}

export type ControlledDispatchDrillResult = {
  drillId: string;
  workflowId: string;
  syntheticDisputeId: string;
  requestedBy: string;
  requestedAt: string;
  transport: "mock";
  outcome: "verified_no_network_dispatch";
  paymentExecution: "disabled";
  payloadHash: string;
};

/**
 * Exercises the same dispatch envelope format as a real workflow request, but deliberately
 * terminates at a mock transport. It cannot create a Temporal execution, modify a real
 * dispute, or generate a settlement instruction.
 */
export function runControlledTemporalDispatchDrill(requestedBy: string, now = new Date()): ControlledDispatchDrillResult {
  if (process.env.PAYMENT_EXECUTION_MODE && process.env.PAYMENT_EXECUTION_MODE !== "disabled") {
    throw new Error("Controlled Temporal drills require payment execution to remain disabled");
  }
  const drillId = `tdr_${randomUUID()}`;
  const requestedAt = now.toISOString();
  const syntheticDisputeId = `synthetic-${drillId}`;
  const workflowId = `temporal-control-drill-${drillId}`;
  const envelope = {
    kind: "HEALTHPOINT_CONTROLLED_NON_PAYMENT_DRILL",
    drillId,
    syntheticDisputeId,
    requestedBy,
    requestedAt,
    paymentExecution: "disabled",
    transport: "mock",
  };
  return {
    drillId,
    workflowId,
    syntheticDisputeId,
    requestedBy,
    requestedAt,
    transport: "mock",
    outcome: "verified_no_network_dispatch",
    paymentExecution: "disabled",
    payloadHash: createHash("sha256").update(JSON.stringify(envelope)).digest("hex"),
  };
}

export async function resetTemporalClientForTests() {
  const connection = cachedConnection;
  cachedClient = null;
  cachedConnection = null;
  await connection?.close();
}
