#!/usr/bin/env tsx
/**
 * scripts/run-journeys-temporal.mts — drives the reusable stakeholder
 * journeys THROUGH Temporal: starts a journeyOrchestratorWorkflow execution
 * on taskQueue `healthpoint-journeys` and polls for the result, printing the
 * same PASS/FAIL table as run-journeys.mts.
 *
 * Prerequisites:
 *   1. A Temporal dev server (see scripts/TEMPORAL-ORCHESTRATOR.md):
 *        docker compose up temporal
 *   2. A journeys worker:
 *        DATABASE_URL=... npx tsx server/temporal/worker.ts
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/run-journeys-temporal.mts [--only J04] [--clean] [--run-id X]
 *
 * If the Temporal server is unreachable this exits cleanly (code 2) with a
 * clear message — use scripts/run-journeys.mts for the direct in-process
 * runner instead.
 */
import "../server/journeys/env-defaults"; // first: env defaults
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client, Connection } from "@temporalio/client";
import {
  DEFAULT_JOURNEY_IDS,
  JOURNEYS_TASK_QUEUE,
  type JourneyOrchestratorSummary,
  type JourneyRunResult,
} from "../server/temporal/journeys.shared";
import { newRunId } from "../server/journeys/framework";

const args = process.argv.slice(2);
const onlyIdx = args.indexOf("--only");
const only = onlyIdx >= 0 ? args[onlyIdx + 1]?.toUpperCase() : undefined;
const clean = args.includes("--clean");
const runIdIdx = args.indexOf("--run-id");
const runId = runIdIdx >= 0 ? args[runIdIdx + 1] : newRunId();

function temporalTls() {
  const caPath =
    process.env.TEMPORAL_CA_PATH?.trim() ||
    path.resolve(process.cwd(), "infra/certs/temporal-ca.crt");
  if (!existsSync(caPath)) return undefined;
  return {
    serverRootCACertificate: readFileSync(caPath),
    serverNameOverride: process.env.TEMPORAL_TLS_SERVER_NAME?.trim() || undefined,
  };
}

// ── Report table (same format as run-journeys.mts) ──────────────────────────
function printReport(results: JourneyRunResult[]): void {
  console.log("\n┌─────────┬──────────────────────────────────────────────────────────┬────────┬───────┬───────────┬───────────┐");
  console.log("│ Journey │ Title                                                    │ Actor  │ Steps │ Asserts   │ Duration  │");
  console.log("├─────────┼──────────────────────────────────────────────────────────┼────────┼───────┼───────────┼───────────┤");
  for (const r of results) {
    const mark = r.status === "PASS" ? "✓" : "✗";
    console.log(
      `│ ${mark} ${r.journeyId.padEnd(5)} │ ${r.title.slice(0, 56).padEnd(56)} │ ${r.actor.slice(0, 6).padEnd(6)} │ ${String(r.steps.length).padEnd(5)} │ ${String(r.asserts).padEnd(9)} │ ${(r.durationMs + "ms").padEnd(9)} │  ${r.status}`
    );
  }
  console.log("└─────────┴──────────────────────────────────────────────────────────┴────────┴───────┴───────────┴───────────┘");
  for (const r of results) {
    console.log(`\n${r.status === "PASS" ? "PASS" : "FAIL"} ${r.journeyId} — ${r.title}`);
    for (const s of r.steps) {
      console.log(`  ${s.status === "PASS" ? "✓" : "✗"} ${s.name} (${s.durationMs}ms)`);
      if (s.evidence) console.log(`    evidence: ${JSON.stringify(s.evidence).slice(0, 400)}`);
      if (s.error) console.log(`    ERROR: ${s.error}`);
    }
  }
}

async function main(): Promise<number> {
  const address = process.env.TEMPORAL_ADDRESS?.trim() || "127.0.0.1:7233";
  const namespace = process.env.TEMPORAL_NAMESPACE?.trim() || "default";
  const taskQueue = process.env.TEMPORAL_JOURNEYS_TASK_QUEUE?.trim() || JOURNEYS_TASK_QUEUE;
  const journeyIds = only ? [only] : [...DEFAULT_JOURNEY_IDS];
  if (only && !DEFAULT_JOURNEY_IDS.includes(only as (typeof DEFAULT_JOURNEY_IDS)[number])) {
    console.error(`no journey matches --only ${only}`);
    return 2;
  }

  let client: Client;
  try {
    const connection = await Connection.connect({
      address,
      apiKey: process.env.TEMPORAL_AUTH_TOKEN?.trim() || undefined,
      tls: temporalTls(),
      connectTimeout: 5_000,
    });
    client = new Client({ connection, namespace });
  } catch (err) {
    console.error(
      `\nTemporal server unreachable at ${address} (namespace ${namespace}).\n` +
      `Cause: ${err instanceof Error ? err.message : String(err)}\n\n` +
      `Start a dev server (docker compose up temporal) and a worker\n` +
      `(DATABASE_URL=... npx tsx server/temporal/worker.ts), or run the journeys\n` +
      `directly with scripts/run-journeys.mts. See scripts/TEMPORAL-ORCHESTRATOR.md.`,
    );
    return 2;
  }

  const workflowId = `journey-orchestration-${runId}`;
  console.log(`runId: ${runId}`);
  console.log(`starting journeyOrchestratorWorkflow (${workflowId}) on ${taskQueue}...`);
  const handle = await client.workflow.start("journeyOrchestratorWorkflow", {
    workflowId,
    taskQueue,
    args: [{ journeyIds: only ? journeyIds : undefined, runId, clean, scale: "small" as const }],
  });
  console.log(`execution started: runId=${handle.firstExecutionRunId}; waiting for result...`);
  const summary = (await handle.result()) as JourneyOrchestratorSummary;
  printReport(summary.results);
  const failed = summary.results.filter(r => r.status === "FAIL");
  console.log(`\n${summary.results.length - failed.length}/${summary.results.length} journeys PASS (allPassed=${summary.allPassed})`);
  return summary.allPassed ? 0 : 1;
}

main().then(code => process.exit(code)).catch(err => {
  console.error("temporal journey runner crashed:", err instanceof Error ? err.message : err);
  process.exit(2);
});
