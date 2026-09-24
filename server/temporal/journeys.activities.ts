/**
 * server/temporal/journeys.activities.ts
 *
 * Temporal activities that execute the reusable stakeholder journeys through
 * the platform's EXISTING services (rootRouter tRPC callers + live Postgres),
 * reusing the exact context-builder pattern of scripts/run-journeys.mts via
 * server/journeys/context.ts.
 *
 * Granularity: one activity per JOURNEY (step-level activities are not
 * required — step results are returned as structured data in JourneyReport).
 */
import "../journeys/env-defaults"; // must be first: env before server modules load
import { ApplicationFailure, Context } from "@temporalio/activity";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { ALL_JOURNEYS } from "../journeys/catalog";
import { runJourney, newRunId, type JourneyReport } from "../journeys/framework";
import {
  buildRunContext,
  cleanPriorRuns,
  seedFixtureUsers,
  startLlmStub,
} from "../journeys/context";
import { getDb } from "../db";
import { auditLog } from "../../drizzle/schema";
import type {
  JourneyOrchestratorSummary,
  JourneyRunResult,
} from "./journeys.shared";

// ── Per-worker-process shared state ─────────────────────────────────────────
let sharedSql: postgres.Sql | null = null;
let llmStubStarted = false;

function getSql(): postgres.Sql {
  if (sharedSql) return sharedSql;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw ApplicationFailure.nonRetryable(
      "DATABASE_URL is required for journey activities",
      "ConfigurationError",
    );
  }
  sharedSql = postgres(url);
  return sharedSql;
}

/** Idempotent: the LLM stub binds 127.0.0.1:11434 once per worker process. */
async function ensureLlmStub(): Promise<void> {
  if (llmStubStarted) return;
  llmStubStarted = true; // set before await: concurrent activities share one stub
  await startLlmStub();
}

function toRunResult(report: JourneyReport): JourneyRunResult {
  return {
    journeyId: report.journeyId,
    title: report.title,
    actor: report.actor,
    status: report.status,
    durationMs: report.durationMs,
    asserts: report.assertions,
    steps: report.steps,
  };
}

// ── Activities ──────────────────────────────────────────────────────────────

/**
 * Prepares the run environment: deterministic LLM stub, --clean wipe of prior
 * journey data (when requested), and the seed-min fixture users. This is the
 * minimal baseline the 20 journeys need (they create their own runId-
 * namespaced fixtures); a full synthetic dataset is NOT required. Set
 * JOURNEYS_SEED_ALL=1 to additionally invoke scripts/seed-all.mts --scale
 * small before the fixture users.
 */
export async function seedBaselineActivity(input: {
  runId: string;
  clean: boolean;
  scale: "small";
}): Promise<{ runId: string; fixtureUsers: number; seeded: string }> {
  const sql = getSql();
  await ensureLlmStub();
  if (input.clean) await cleanPriorRuns(sql);
  if (process.env.JOURNEYS_SEED_ALL === "1") {
    const { execFile } = await import("node:child_process");
    await new Promise<void>((resolve, reject) => {
      execFile(
        "npx",
        ["tsx", "scripts/seed-all.mts", "--scale", input.scale],
        { cwd: process.cwd(), env: process.env, timeout: 10 * 60_000 },
        err => (err ? reject(ApplicationFailure.nonRetryable(
          `seed-all failed: ${err.message}`, "SeedBaselineError")) : resolve()),
      );
    });
  }
  const users = await seedFixtureUsers();
  Context.current().heartbeat("baseline-seeded");
  return { runId: input.runId, fixtureUsers: Object.keys(users).length, seeded: "fixture-users" };
}

/**
 * Executes ONE journey end-to-end via runJourney() with a context built by
 * the shared builder (fixture users + rootRouter.createCaller). Assertion
 * failures come back as report data (status "FAIL") — they are verdicts, not
 * infra errors, so they are never retried by Temporal.
 */
export async function runJourneyActivity(input: {
  journeyId: string;
  runId: string;
}): Promise<JourneyRunResult> {
  const journey = ALL_JOURNEYS.find(
    j => j.id.toUpperCase() === input.journeyId.toUpperCase(),
  );
  if (!journey) {
    throw ApplicationFailure.nonRetryable(
      `unknown journeyId ${input.journeyId}`,
      "JourneyAssertionError",
    );
  }
  const sql = getSql();
  await ensureLlmStub();
  const ctx = await buildRunContext({ runId: input.runId, sql });
  Context.current().heartbeat(`${journey.id}-start`);
  const report = await runJourney(journey, ctx);
  Context.current().heartbeat(`${journey.id}-${report.status}`);
  return toRunResult(report);
}

/**
 * Persists the orchestration summary to the existing audit_log table
 * (no new schema): action `temporal.journey_run.completed`, entityType
 * `journey_run`, entityId = runId, newValue = JSON summary.
 */
export async function reportActivity(
  summary: JourneyOrchestratorSummary,
): Promise<{ auditId: string }> {
  const db = await getDb();
  if (!db) {
    throw ApplicationFailure.nonRetryable("Database unavailable", "ConfigurationError");
  }
  const auditId = `jrn-run-${randomUUID()}`;
  await db.insert(auditLog).values({
    id: auditId,
    userId: "temporal-orchestrator",
    action: "temporal.journey_run.completed",
    entityType: "journey_run",
    entityId: summary.runId,
    newValue: JSON.stringify({
      runId: summary.runId,
      allPassed: summary.allPassed,
      passed: summary.results.filter(r => r.status === "PASS").length,
      total: summary.results.length,
      results: summary.results.map(r => ({
        journeyId: r.journeyId,
        status: r.status,
        durationMs: r.durationMs,
        asserts: r.asserts,
      })),
    }),
  });
  return { auditId };
}

/** Utility for the CLI/ops: mint a runId without importing the framework. */
export function newJourneyRunId(): string {
  return newRunId();
}
