#!/usr/bin/env tsx
/**
 * scripts/run-journeys.mts — executes the 20 stakeholder journeys against the
 * REAL tRPC routers (rootRouter caller factory) and a live Postgres
 * (DATABASE_URL). Sequential execution, per-journey PASS/FAIL table with step
 * evidence, non-zero exit on any failure.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/run-journeys.mts            # all journeys
 *   DATABASE_URL=... npx tsx scripts/run-journeys.mts --only J04 # one journey
 *   DATABASE_URL=... npx tsx scripts/run-journeys.mts --clean    # wipe prior
 *                                                                # run data first
 *
 * Notes:
 *  - A tiny deterministic OpenAI-compatible stub is started on
 *    127.0.0.1:11434 UNLESS one is already listening, so LLM-dependent
 *    procedures (predictions.generate, docIntelligence.analyze) execute for
 *    real end-to-end. Set JOURNEYS_NO_LLM_STUB=1 to disable and observe the
 *    honest fail-closed behavior instead (journeys assert both modes).
 *  - Seed-min: four fixture users (provider/admin/patient/reviewer) are
 *    upserted. Journeys create their own namespaced fixtures per run.
 */
import "./journeys-env.mts"; // must be first: fills env defaults before server modules load
import postgres from "postgres";
import {
  ALL_JOURNEYS,
} from "../server/journeys/catalog";
import {
  newRunId,
  runJourney,
  type JourneyReport,
} from "../server/journeys/framework";
import {
  cleanPriorRuns,
  seedFixtureUsers,
  startLlmStub,
} from "../server/journeys/context";
import { buildJourneyContext } from "../server/journeys/framework";
import { rootRouter } from "../server/app-router";

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const onlyIdx = args.indexOf("--only");
const only = onlyIdx >= 0 ? args[onlyIdx + 1]?.toUpperCase() : undefined;
const clean = args.includes("--clean");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}

// ── Report table ────────────────────────────────────────────────────────────
function printReport(reports: JourneyReport[]): void {
  console.log("\n┌─────────┬──────────────────────────────────────────────────────────┬────────┬───────┬───────────┬───────────┐");
  console.log("│ Journey │ Title                                                    │ Actor  │ Steps │ Asserts   │ Duration  │");
  console.log("├─────────┼──────────────────────────────────────────────────────────┼────────┼───────┼───────────┼───────────┤");
  for (const r of reports) {
    const mark = r.status === "PASS" ? "✓" : "✗";
    console.log(
      `│ ${mark} ${r.journeyId.padEnd(5)} │ ${r.title.slice(0, 56).padEnd(56)} │ ${r.actor.slice(0, 6).padEnd(6)} │ ${String(r.steps.length).padEnd(5)} │ ${String(r.assertions).padEnd(9)} │ ${(r.durationMs + "ms").padEnd(9)} │  ${r.status}`
    );
  }
  console.log("└─────────┴──────────────────────────────────────────────────────────┴────────┴───────┴───────────┴───────────┘");
  for (const r of reports) {
    console.log(`\n${r.status === "PASS" ? "PASS" : "FAIL"} ${r.journeyId} — ${r.title}`);
    for (const s of r.steps) {
      const line = `  ${s.status === "PASS" ? "✓" : "✗"} ${s.name} (${s.durationMs}ms)`;
      console.log(line);
      if (s.evidence) console.log(`    evidence: ${JSON.stringify(s.evidence).slice(0, 400)}`);
      if (s.error) console.log(`    ERROR: ${s.error}`);
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main(): Promise<number> {
  const sql = postgres(DATABASE_URL!);
  const llmStub = await startLlmStub();
  try {
    if (clean) await cleanPriorRuns(sql);
    const users = await seedFixtureUsers();
    const runId = newRunId();
    console.log(`runId: ${runId}`);
    const selected = only
      ? ALL_JOURNEYS.filter(j => j.id.toUpperCase() === only)
      : ALL_JOURNEYS;
    if (selected.length === 0) {
      console.error(`no journey matches --only ${only}`);
      return 2;
    }
    const reports: JourneyReport[] = [];
    for (const journey of selected) {
      const ctx = buildJourneyContext({ runId, sql, createCaller: rootRouter.createCaller, users });
      process.stdout.write(`running ${journey.id} ... `);
      const report = await runJourney(journey, ctx);
      console.log(`${report.status} (${report.durationMs}ms, ${report.assertions} assertions)`);
      reports.push(report);
    }
    printReport(reports);
    const failed = reports.filter(r => r.status === "FAIL");
    console.log(`\n${reports.length - failed.length}/${reports.length} journeys PASS`);
    return failed.length ? 1 : 0;
  } finally {
    llmStub?.close();
    await sql.end();
  }
}

main().then(code => process.exit(code)).catch(err => {
  console.error("runner crashed:", err);
  process.exit(2);
});
