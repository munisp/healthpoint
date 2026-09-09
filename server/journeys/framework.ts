/**
 * server/journeys/framework.ts
 *
 * Reusable stakeholder-journey framework. A Journey is a parameterized,
 * re-runnable end-to-end scenario that exercises REAL tRPC procedures through
 * the rootRouter caller factory (never raw SQL inserts on business paths), so
 * every step covers the production code path including authz middleware.
 *
 * Re-runnability contract:
 *  - Every entity a journey creates is namespaced by ctx.runId (unique per
 *    run) via ctx.ns()/ctx.idem(); the same journey can run N times safely.
 *  - --clean support: the runner deletes prior-run data (tenant `jrn` FSM
 *    cases, disputes created by the journey fixture users, etc.) before a run.
 *
 * Assertions THROW on failure (ctx.assert). StepResult evidence is structured
 * JSON-safe data captured per step for the runner's PASS/FAIL table.
 */
import { randomUUID, createHash } from "node:crypto";
import type postgres from "postgres";
import type { TrpcContext } from "../_core/context";
import type { rootRouter } from "../app-router";
import type { User } from "../../drizzle/schema";

export type Caller = ReturnType<typeof rootRouter.createCaller>;

export type JourneyActor =
  | "provider"
  | "biller"
  | "patient"
  | "idre-admin"
  | "payer"
  | "platform-admin";

export interface StepResult {
  /** Structured, JSON-safe evidence for the runner report. */
  evidence?: Record<string, unknown>;
}

export interface JourneyStep {
  name: string;
  run(ctx: JourneyContext): Promise<StepResult | void>;
}

export interface Journey {
  id: string; // e.g. "J01"
  title: string;
  actor: JourneyActor;
  description: string;
  steps: JourneyStep[];
}

export class JourneyAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JourneyAssertionError";
  }
}

/** Well-known fixture users (created by scripts/run-journeys.mts seed-min). */
export const FIXTURE_USERS = {
  provider: "jrn-user-provider",
  admin: "jrn-user-admin",
  patient: "jrn-user-patient",
  reviewer: "jrn-user-reviewer",
} as const;

/** Fixed tenant namespace for all journey FSM cases; --clean wipes it. */
export const JOURNEY_TENANT = "jrn";

export interface JourneyContext {
  runId: string;
  sql: postgres.Sql;
  /** Caller as the provider/biller fixture user. */
  provider: Caller;
  /** Caller as the platform-admin fixture user. */
  admin: Caller;
  /** Caller as the patient fixture user. */
  patient: Caller;
  /** Caller as an unaffiliated second user (authz negative tests). */
  reviewer: Caller;
  /** Namespaced unique id: `${runId}-${label}` (128-char safe). */
  ns(label: string): string;
  /** Deterministic idempotency key derived from runId + label. */
  idem(label: string): string;
  /** Hard assertion — throws JourneyAssertionError on failure. */
  assert(cond: unknown, message: string, evidence?: Record<string, unknown>): void;
  assertEqual<T>(actual: T, expected: T, message: string): void;
  /** Count of hard assertions executed so far in this journey. */
  assertionCount: number;
}

export function makeCtxForUser(user: User): TrpcContext {
  return {
    user,
    req: { headers: {} } as unknown as TrpcContext["req"],
    res: { clearCookie: () => undefined } as unknown as TrpcContext["res"],
  };
}

export function buildJourneyContext(args: {
  runId: string;
  sql: postgres.Sql;
  createCaller: typeof rootRouter.createCaller;
  users: Record<keyof typeof FIXTURE_USERS, User>;
}): JourneyContext {
  const { runId, sql, createCaller, users } = args;
  const ctx: JourneyContext = {
    runId,
    sql,
    provider: createCaller(makeCtxForUser(users.provider)),
    admin: createCaller(makeCtxForUser(users.admin)),
    patient: createCaller(makeCtxForUser(users.patient)),
    reviewer: createCaller(makeCtxForUser(users.reviewer)),
    assertionCount: 0,
    ns(label: string): string {
      const raw = `${runId}-${label}`;
      return raw.length <= 120 ? raw : `${runId}-${createHash("sha1").update(label).digest("hex").slice(0, 16)}`;
    },
    idem(label: string): string {
      // Deterministic per (runId, label): a replay within a run hits the
      // idempotency path; a new run never collides with a prior run.
      return `jrn-${createHash("sha256").update(`${runId}:${label}`).digest("hex").slice(0, 48)}`;
    },
    assert(cond: unknown, message: string, evidence?: Record<string, unknown>): void {
      ctx.assertionCount++;
      if (!cond) {
        const suffix = evidence ? ` | evidence=${JSON.stringify(evidence).slice(0, 500)}` : "";
        throw new JourneyAssertionError(`${message}${suffix}`);
      }
    },
    assertEqual<T>(actual: T, expected: T, message: string): void {
      ctx.assertionCount++;
      if (actual !== expected) {
        throw new JourneyAssertionError(
          `${message} | expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`
        );
      }
    },
  };
  return ctx;
}

export interface StepReport {
  name: string;
  status: "PASS" | "FAIL";
  durationMs: number;
  evidence?: Record<string, unknown>;
  error?: string;
}

export interface JourneyReport {
  journeyId: string;
  title: string;
  actor: JourneyActor;
  status: "PASS" | "FAIL";
  durationMs: number;
  assertions: number;
  steps: StepReport[];
}

export function newRunId(): string {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `run-${ts}-${randomUUID().slice(0, 8)}`;
}

/** Run one journey sequentially; stops at the first failing step. */
export async function runJourney(journey: Journey, ctx: JourneyContext): Promise<JourneyReport> {
  const started = Date.now();
  const steps: StepReport[] = [];
  let status: "PASS" | "FAIL" = "PASS";
  for (const step of journey.steps) {
    const t0 = Date.now();
    try {
      const result = await step.run(ctx);
      steps.push({
        name: step.name,
        status: "PASS",
        durationMs: Date.now() - t0,
        evidence: result?.evidence,
      });
    } catch (err) {
      status = "FAIL";
      steps.push({
        name: step.name,
        status: "FAIL",
        durationMs: Date.now() - t0,
        error: err instanceof Error
          ? `${err.name}: ${err.message}${(err as { cause?: unknown }).cause ? ` | cause: ${String((err as { cause?: unknown }).cause)}` : ""}`.slice(0, 800)
          : String(err),
      });
      break;
    }
  }
  return {
    journeyId: journey.id,
    title: journey.title,
    actor: journey.actor,
    status,
    durationMs: Date.now() - started,
    assertions: ctx.assertionCount,
    steps,
  };
}
