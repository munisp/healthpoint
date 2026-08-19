import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client, Connection, WorkflowExecutionAlreadyStartedError } from "@temporalio/client";

export type TemporalConfiguration = {
  address: string;
  authToken: string;
  serverName: string;
  namespace: string;
  taskQueue: string;
  workflowType: string;
  caPath: string;
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

  return {
    address: configuredValue("TEMPORAL_ADDRESS", DEVELOPMENT_DEFAULTS.address),
    authToken,
    serverName: configuredValue("TEMPORAL_TLS_SERVER_NAME", DEVELOPMENT_DEFAULTS.serverName),
    namespace: configuredValue("TEMPORAL_NAMESPACE", DEVELOPMENT_DEFAULTS.namespace),
    taskQueue: configuredValue("TEMPORAL_TASK_QUEUE", DEVELOPMENT_DEFAULTS.taskQueue),
    workflowType: configuredValue("TEMPORAL_WORKFLOW_TYPE", DEVELOPMENT_DEFAULTS.workflowType),
    caPath: resolveCaPath(),
  };
}

/** Workflow dispatch is off unless explicitly enabled; it is never inferred from connectivity. */
export function isTemporalDispatchEnabled(): boolean {
  return process.env.TEMPORAL_EXECUTION_ENABLED === "true";
}

export async function getTemporalClient(): Promise<{ client: Client; config: TemporalConfiguration }> {
  const config = getTemporalConfiguration();
  if (cachedClient) return { client: cachedClient, config };

  const connection = await Connection.connect({
    address: config.address,
    apiKey: config.authToken || undefined,
    tls: {
      serverRootCACertificate: readFileSync(config.caPath),
      serverNameOverride: config.serverName,
    },
    connectTimeout: 10_000,
  });
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
  return toWorkflowSummary(await client.workflow.getHandle(workflowId).describe());
}

export async function listTemporalWorkflows(limit: number, status?: string): Promise<TemporalWorkflowSummary[]> {
  const { client } = await getTemporalClient();
  const items: TemporalWorkflowSummary[] = [];
  for await (const execution of client.workflow.list({ pageSize: Math.min(limit * 2, 100) })) {
    const item = toWorkflowSummary(execution);
    if (!status || item.status === status) items.push(item);
    if (items.length === limit) break;
  }
  return items;
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
    const handle = await client.workflow.start(config.workflowType, {
      workflowId,
      taskQueue: config.taskQueue,
      args: [{ disputeId, requestedBy, requestedAt: new Date().toISOString() }],
    });
    return { workflowId, runId: handle.firstExecutionRunId, reusedExisting: false };
  } catch (error) {
    if (error instanceof WorkflowExecutionAlreadyStartedError || (error as Error).name === "WorkflowExecutionAlreadyStartedError") {
      return { workflowId, runId: undefined, reusedExisting: true };
    }
    throw error;
  }
}

export async function resetTemporalClientForTests() {
  const connection = cachedConnection;
  cachedClient = null;
  cachedConnection = null;
  await connection?.close();
}
