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
import { createServer, type Server } from "node:http";
import postgres from "postgres";
import { rootRouter } from "../server/app-router";
import {
  ALL_JOURNEYS,
} from "../server/journeys/catalog";
import {
  buildJourneyContext,
  newRunId,
  runJourney,
  FIXTURE_USERS,
  JOURNEY_TENANT,
  type JourneyReport,
} from "../server/journeys/framework";
import { users as usersTable, type User } from "../drizzle/schema";
import { getDb } from "../server/db";
import { eq } from "drizzle-orm";

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

// ── Deterministic local LLM stub (OpenAI-compatible /v1/chat/completions) ───
async function startLlmStub(): Promise<Server | null> {
  if (process.env.JOURNEYS_NO_LLM_STUB === "1") return null;
  const probe = await fetch("http://127.0.0.1:11434/v1/chat/completions", { method: "OPTIONS" })
    .then(() => true)
    .catch(() => false);
  if (probe) {
    console.log("[llm-stub] something already listens on 11434; leaving it alone");
    return null;
  }
  const server = createServer((req, res) => {
    if (req.method !== "POST" || !req.url?.startsWith("/v1/chat/completions")) {
      res.writeHead(404).end("{}");
      return;
    }
    let body = "";
    req.on("data", c => (body += c));
    req.on("end", () => {
      let name = "";
      try {
        const parsed = JSON.parse(body);
        name = parsed?.response_format?.json_schema?.name ?? "";
        if (!name) {
          // The ollama backend path strips json_schema to {type:"json_object"},
          // so fall back to prompt-content sniffing.
          const text = JSON.stringify(parsed?.messages ?? []);
          if (/predict the outcome|win probability/i.test(text)) name = "outcome_prediction";
          else if (/Extract structured data|document/i.test(text)) name = "document_extraction";
        }
      } catch { /* default */ }
      const content =
        name === "outcome_prediction"
          ? JSON.stringify({
              winProbability: 62,
              confidenceScore: 71,
              keyFactors: ["QPA proximity of offers", "Emergency service type", "TX federal IDR path"],
              recommendation: "Submit offer within 110% of QPA with strong documentation.",
            })
          : name === "document_extraction"
            ? JSON.stringify({
                patientName: "Journey Patient", patientDOB: "", patientId: "",
                providerName: "Journey Provider", providerNPI: "1234567893",
                payerName: "Journey Payer", payerId: "PAYER1", claimNumber: "CLM-1",
                dateOfService: "2026-08-01", billedAmount: "4200.00", allowedAmount: "2600.00",
                paidAmount: "2000.00", patientResponsibility: "600.00",
                denialReason: "", denialCode: "", cptCodes: ["99285"], icd10Codes: [],
                serviceType: "Emergency", facilityState: "TX",
                isOutOfNetwork: true, nsaApplicable: true,
                rawText: "synthetic journey document", confidence: 88, notes: "stub extraction",
              })
            : JSON.stringify({ ok: true });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "chatcmpl-journey-stub",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "journey-stub",
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      }));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(11434, "127.0.0.1", () => resolve());
  });
  console.log("[llm-stub] deterministic LLM stub listening on 127.0.0.1:11434");
  return server;
}

// ── Seed-min fixture users ──────────────────────────────────────────────────
async function seedFixtureUsers(): Promise<Record<keyof typeof FIXTURE_USERS, User>> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const defs: Array<{ key: keyof typeof FIXTURE_USERS; role: "user" | "admin" }> = [
    { key: "provider", role: "user" },
    { key: "admin", role: "admin" },
    { key: "patient", role: "user" },
    { key: "reviewer", role: "user" },
  ];
  const out = {} as Record<keyof typeof FIXTURE_USERS, User>;
  for (const def of defs) {
    const id = FIXTURE_USERS[def.key];
    await db
      .insert(usersTable)
      .values({
        id,
        name: `Journey ${def.key}`,
        email: `${id}@journeys.local`,
        loginMethod: "journey-fixture",
        role: def.role,
      })
      .onConflictDoNothing();
    const [row] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!row) throw new Error(`fixture user ${id} missing after upsert`);
    if (row.role !== def.role) {
      await db.update(usersTable).set({ role: def.role }).where(eq(usersTable.id, id));
      row.role = def.role;
    }
    out[def.key] = row;
  }
  return out;
}

// ── --clean: delete prior journey run data ─────────────────────────────────
async function cleanPriorRuns(sql: postgres.Sql): Promise<void> {
  const fixtureIds = Object.values(FIXTURE_USERS);
  const disputes = await sql`
    SELECT id FROM disputes
    WHERE "createdBy" = ANY(${fixtureIds}) OR "initiatingPartyId" = ANY(${fixtureIds})`;
  const disputeIds = disputes.map(d => d.id as string);
  for (const t of [
    "dispute_events", "dispute_offers", "dispute_documents", "dispute_comments",
    "dispute_watchlist", "idr_deadline_events", "idr_fee_assessments",
    "idr_attestations", "outcome_predictions", "document_analyses",
    "uscdi_data_elements", "davinci_transactions", "sla_breaches",
    "settlement_transfers",
  ]) {
    if (disputeIds.length) {
      await sql.unsafe(`DELETE FROM "${t}" WHERE "disputeId" = ANY($1)`, [disputeIds]).catch(e =>
        console.warn(`[clean] ${t}: ${(e as Error).message.slice(0, 80)}`));
    }
  }
  if (disputeIds.length) await sql`DELETE FROM disputes WHERE id = ANY(${disputeIds})`;
  await sql`DELETE FROM notifications WHERE "userId" = ANY(${fixtureIds})`;
  await sql`DELETE FROM dispute_drafts WHERE "userId" = ANY(${fixtureIds})`.catch(() => undefined);
  await sql`DELETE FROM api_keys WHERE "userId" = ANY(${fixtureIds})`;
  await sql`DELETE FROM email_digest_preferences WHERE "userId" = ANY(${fixtureIds})`;
  await sql`DELETE FROM org_settings WHERE "userId" = ANY(${fixtureIds})`;
  await sql`DELETE FROM totp_secrets WHERE "userId" = ANY(${fixtureIds})`;
  await sql`DELETE FROM webhooks WHERE "userId" = ANY(${fixtureIds})`;
  await sql`DELETE FROM dispute_access WHERE "grantedBy" = ANY(${fixtureIds})`.catch(() => undefined);
  await sql`DELETE FROM fsm_case_events WHERE "tenantId" = ${JOURNEY_TENANT}`;
  await sql`DELETE FROM fsm_case_idempotency WHERE "tenantId" = ${JOURNEY_TENANT}`;
  await sql`DELETE FROM fsm_cases WHERE "tenantId" = ${JOURNEY_TENANT}`;
  await sql`DELETE FROM submission_automation_events WHERE "tenantId" = ${JOURNEY_TENANT}`.catch(() => undefined);
  await sql`DELETE FROM submission_automation_idempotency WHERE "tenantId" = ${JOURNEY_TENANT}`.catch(() => undefined);
  await sql`DELETE FROM submission_automation_submissions WHERE "tenantId" = ${JOURNEY_TENANT}`.catch(() => undefined);
  await sql`DELETE FROM emr_connections WHERE "createdBy" = ANY(${fixtureIds})`.catch(() => undefined);
  console.log("[clean] prior journey run data deleted");
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
