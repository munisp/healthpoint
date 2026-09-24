/**
 * server/journeys/context.ts
 *
 * Shared run-environment helpers for the stakeholder journeys, extracted from
 * scripts/run-journeys.mts so the SAME context-builder pattern is reused by:
 *   - scripts/run-journeys.mts          (direct in-process runner)
 *   - server/temporal/journeys.activities.ts  (Temporal activity execution)
 *
 * Everything here is runner-side infrastructure (fixture seeding, --clean
 * wipes, the deterministic LLM stub); the journeys themselves stay pure
 * tRPC-caller driven via buildJourneyContext in ./framework.
 */
import { createServer, type Server } from "node:http";
import type postgres from "postgres";
import { eq } from "drizzle-orm";
import { rootRouter } from "../app-router";
import { users as usersTable, type User } from "../../drizzle/schema";
import { getDb } from "../db";
import {
  buildJourneyContext,
  FIXTURE_USERS,
  JOURNEY_TENANT,
  type JourneyContext,
} from "./framework";

// ── Deterministic local LLM stub (OpenAI-compatible /v1/chat/completions) ───
export async function startLlmStub(): Promise<Server | null> {
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
export async function seedFixtureUsers(): Promise<Record<keyof typeof FIXTURE_USERS, User>> {
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
export async function cleanPriorRuns(sql: postgres.Sql): Promise<void> {
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

/**
 * One-stop context builder: seeds fixture users (idempotent upsert) and
 * returns a JourneyContext wired to the REAL rootRouter caller factory —
 * the exact pattern scripts/run-journeys.mts uses per journey.
 */
export async function buildRunContext(args: {
  runId: string;
  sql: postgres.Sql;
}): Promise<JourneyContext> {
  const users = await seedFixtureUsers();
  return buildJourneyContext({
    runId: args.runId,
    sql: args.sql,
    createCaller: rootRouter.createCaller,
    users,
  });
}
