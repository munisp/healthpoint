/**
 * server/temporal/worker.ts
 *
 * Temporal Worker bootstrap for the journeys orchestrator.
 *
 *   DATABASE_URL=postgres://... npx tsx server/temporal/worker.ts
 *
 * Env conventions mirror server/temporal.ts:
 *   TEMPORAL_ADDRESS        (default 127.0.0.1:7233)
 *   TEMPORAL_NAMESPACE      (default "default")
 *   TEMPORAL_AUTH_TOKEN     (bearer/api key, optional in dev)
 *   TEMPORAL_CA_PATH        (mTLS CA; when present TLS is enabled, with
 *   TEMPORAL_TLS_SERVER_NAME  optional server-name override)
 *   TEMPORAL_JOURNEYS_TASK_QUEUE (default "healthpoint-journeys")
 *
 * Polls taskQueue `healthpoint-journeys`, registers the journey workflows and
 * activities, and starts the deterministic LLM stub so LLM-dependent journey
 * steps execute end-to-end inside activities.
 */
import "../journeys/env-defaults"; // first: env defaults before server modules
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./journeys.activities";
import { JOURNEYS_TASK_QUEUE } from "./journeys.shared";
import { startLlmStub } from "../journeys/context";

function resolveTls() {
  const caPath =
    process.env.TEMPORAL_CA_PATH?.trim() ||
    path.resolve(process.cwd(), "infra/certs/temporal-ca.crt");
  if (!existsSync(caPath)) return undefined; // plaintext local dev server
  return {
    serverRootCACertificate: readFileSync(caPath),
    serverNameOverride: process.env.TEMPORAL_TLS_SERVER_NAME?.trim() || undefined,
  };
}

async function main(): Promise<void> {
  const address = process.env.TEMPORAL_ADDRESS?.trim() || "127.0.0.1:7233";
  const namespace = process.env.TEMPORAL_NAMESPACE?.trim() || "default";
  const taskQueue = process.env.TEMPORAL_JOURNEYS_TASK_QUEUE?.trim() || JOURNEYS_TASK_QUEUE;
  const apiKey = process.env.TEMPORAL_AUTH_TOKEN?.trim() || undefined;

  await startLlmStub();

  const connection = await NativeConnection.connect({
    address,
    apiKey,
    tls: resolveTls(),
  });
  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue,
    workflowsPath: path.resolve(import.meta.dirname, "journeys.workflows.ts"),
    activities,
  });
  console.log(`[temporal-worker] polling taskQueue=${taskQueue} namespace=${namespace} address=${address}`);
  await worker.run();
}

main().catch(err => {
  console.error("[temporal-worker] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
