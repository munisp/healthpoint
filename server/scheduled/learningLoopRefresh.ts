/**
 * server/scheduled/learningLoopRefresh.ts
 *
 * Phase 22: nightly closed-learning-loop refresh. Follows the
 * offerModelRefresh.ts shape (pure run fn + express handler), mounted at
 *   POST /api/scheduled/learning-loop-refresh   (behind scheduledAuth)
 * intended to run nightly AFTER offer-model-refresh (LEARNING_LOOP_REFRESH_CRON).
 *
 * runLearningLoopRefresh(db, now) wraps runOfferModelTraining (P21 — NEVER
 * edited here) and adds, each in its own try/catch so one failing learner
 * never blocks the others (retentionWorker per-table precedent):
 *   1. attributeBanditRewards  — S1 nightly reward attribution + posteriors
 *   2. bandit governance snapshot (model_versions, model_kind "bandit")
 *   3. trainOutcomeModel       — S4 outcome-model-v2 training
 *   4. joinOutcomeActuals      — S4 calibration join
 *   5. refreshRankingStats     — S2+S3 ranker rate tables
 *
 * NON-goal enforcement (design §10): rewards attribute HERE, in batch — the
 * disputes.acceptOffer/rejectOffer payment-adjacent paths are read, never
 * hooked; there are no online posterior updates.
 */

import { Request, Response } from "express";
import crypto from "crypto";
import { desc, eq, and, sql } from "drizzle-orm";
import { getDb } from "../db";
import { modelVersions } from "../../drizzle/schema-intelligence";
import {
  OUTCOME_MODEL_NAME,
  outcomeModelMinSamples,
  type OutcomeModelParameters,
  type OutcomeSegmentRow,
} from "../idr/outcome-model-v2";
import { rewardWindowDays } from "../idr/offer-bandit";
import { runOfferModelTraining, SEGMENT_SUPPRESSION_FLOOR } from "./offerModelRefresh";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

function rowsOf<T extends Record<string, unknown>>(result: unknown): T[] {
  return (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as T[];
}

// ────────────────────────────────────────────────────────────────────────────
// Step 1: bandit reward attribution (design §3.1 reward table, §3.3 batch)
// ────────────────────────────────────────────────────────────────────────────

export interface BanditAttributionResult {
  attributed: number;
  accepted: number;
  rejected: number;
  countered: number;
  expired: number;
}

interface PendingAssignment extends Record<string, unknown> {
  id: string;
  org_id: string;
  dispute_id: string;
  segment_tier: string;
  segment_key: string;
  arm_id: string;
  served_usd: string;
  created_at: Date;
}

/** Exported for tests/journeys. Idempotent: guarded by outcome IS NULL. */
export async function attributeBanditRewards(db: Db, now: Date): Promise<BanditAttributionResult> {
  const windowDays = rewardWindowDays();
  const nowTs = now.toISOString();
  const result: BanditAttributionResult = { attributed: 0, accepted: 0, rejected: 0, countered: 0, expired: 0 };
  // Grace period of 1 hour avoids racing same-minute UI interactions.
  const pending = rowsOf<PendingAssignment>(await db.execute(sql`
    SELECT id, org_id, dispute_id, segment_tier, segment_key, arm_id, served_usd, created_at
    FROM bandit_assignments
    WHERE outcome IS NULL AND created_at < ${nowTs}::timestamp - interval '1 hour'
    ORDER BY created_at ASC
    LIMIT 2000
  `));

  for (let i = 0; i < pending.length; i += 200) {
    const batch = pending.slice(i, i + 200);
    const write = async (tx: Db) => {
      for (const a of batch) {
        const createdTs = new Date(a.created_at).toISOString();
        const facts = rowsOf<Record<string, unknown>>(await tx.execute(sql`
          SELECT
            (SELECT o.amount FROM dispute_offers o
              WHERE o."disputeId" = ${a.dispute_id} AND o."isAccepted" = true
              ORDER BY o."submittedAt" DESC NULLS LAST LIMIT 1) AS accepted_amount,
            (SELECT COUNT(*)::int FROM dispute_offers o
              WHERE o."disputeId" = ${a.dispute_id} AND o."submittedAt" > ${createdTs}::timestamp) AS newer_offers,
            (SELECT COUNT(*)::int FROM dispute_events e
              WHERE e."disputeId" = ${a.dispute_id} AND e."eventType" = 'offer_rejected'
                AND e."createdAt" > ${createdTs}::timestamp) AS reject_events,
            (SELECT d.status FROM disputes d WHERE d.id = ${a.dispute_id}) AS dispute_status
        `))[0] ?? {};
        const acceptedAmount = facts.accepted_amount !== null && facts.accepted_amount !== undefined
          ? Number(facts.accepted_amount) : null;
        const newerOffers = Number(facts.newer_offers ?? 0);
        const rejectEvents = Number(facts.reject_events ?? 0);
        const status = String(facts.dispute_status ?? "");
        const servedUsd = Number(a.served_usd);
        const ageMs = now.getTime() - new Date(a.created_at).getTime();
        const withinWindow = ageMs <= windowDays * 86400000;

        // Classification order per design §3.1 reward table.
        let outcome: "accepted" | "rejected" | "countered" | "expired" | null = null;
        if (acceptedAmount !== null && Math.abs(acceptedAmount - servedUsd) <= 0.01) {
          outcome = "accepted"; // amount-matched acceptance
        } else if (
          acceptedAmount !== null && withinWindow && newerOffers === 0 &&
          (status === "determination_issued" || status === "closed")
        ) {
          outcome = "accepted"; // amount-free fallback (design §3.1)
        } else if (rejectEvents > 0 && acceptedAmount === null) {
          outcome = "rejected";
        } else if (newerOffers > 0) {
          outcome = "countered"; // excluded from posteriors (ambiguous signal)
        } else if (!withinWindow) {
          outcome = "expired"; // excluded from posteriors
        }
        if (outcome === null) continue; // still in flight

        // Idempotent claim of the attribution (guard: outcome IS NULL).
        const claimed = rowsOf<Record<string, unknown>>(await tx.execute(sql`
          UPDATE bandit_assignments
          SET outcome = ${outcome}, outcome_at = ${nowTs}::timestamp
          WHERE id = ${a.id} AND outcome IS NULL
          RETURNING id
        `));
        if (claimed.length === 0) continue;

        // Posterior update: only the FIRST assignment per dispute collects a
        // reward (one dispute, one reward — no refresh farming). countered /
        // expired are served-counted only (excluded from α/β by design).
        const rewarded = outcome === "accepted" || outcome === "rejected";
        const blockers = rewarded
          ? rowsOf<Record<string, unknown>>(await tx.execute(sql`
              SELECT 1 FROM bandit_assignments b2
              WHERE b2.dispute_id = ${a.dispute_id} AND b2.id <> ${a.id}
                AND (b2.outcome IN ('accepted','rejected') OR b2.created_at < ${createdTs}::timestamp)
              LIMIT 1
            `))
          : [];
        const rewardEligible = rewarded && blockers.length === 0;
        const r = rewardEligible && outcome === "accepted" ? 1 : 0;
        const da = rewardEligible ? r : 0;
        const dbeta = rewardEligible ? 1 - r : 0;
        const dpulls = rewardEligible ? 1 : 0;
        await tx.execute(sql`
          INSERT INTO bandit_arm_stats (id, org_id, segment_tier, segment_key, arm_id, alpha, beta, pulls, served, updated_at)
          VALUES (
            ${crypto.randomUUID()}, ${a.org_id}, ${a.segment_tier}, ${a.segment_key}, ${a.arm_id},
            ${1 + da}, ${1 + dbeta}, ${dpulls}, 1, ${nowTs}::timestamp
          )
          ON CONFLICT (org_id, segment_tier, segment_key, arm_id) DO UPDATE SET
            alpha = bandit_arm_stats.alpha + ${da},
            beta  = bandit_arm_stats.beta  + ${dbeta},
            pulls = bandit_arm_stats.pulls + ${dpulls},
            served = bandit_arm_stats.served + 1,
            updated_at = ${nowTs}::timestamp
        `);
        result.attributed += 1;
        result[outcome] += 1;
      }
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyDb = db as any;
    if (typeof anyDb.transaction === "function") {
      await anyDb.transaction(async (tx: Db) => write(tx));
    } else {
      await write(db);
    }
  }
  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// Step 2: bandit governance snapshot (aggregates only — NO org ids)
// ────────────────────────────────────────────────────────────────────────────

export const BANDIT_MODEL_NAME = "offer-bandit-v1";

async function snapshotBanditGovernance(db: Db, now: Date) {
  const perTier = rowsOf<Record<string, unknown>>(await db.execute(sql`
    SELECT segment_tier AS tier, arm_id AS "armId",
      COUNT(DISTINCT org_id)::int AS orgs,
      SUM(pulls)::int AS pulls, SUM(served)::int AS served,
      SUM(alpha - 1)::int AS rewards
    FROM bandit_arm_stats
    GROUP BY 1, 2
    ORDER BY 1, 2
  `));
  return insertGovernanceRow(db, now, {
    modelName: BANDIT_MODEL_NAME,
    modelKind: "bandit",
    trainedOn: "real_offer_outcomes",
    sufficient: perTier.length > 0,
    trainingSampleSize: perTier.reduce((s, r) => s + Number(r.pulls ?? 0), 0),
    segmentCount: perTier.length,
    parameters: { generatedAt: now.toISOString(), armsPerTier: perTier },
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Step 3: outcome-model-v2 training (design §6.2 — sibling of the P21 query)
// ────────────────────────────────────────────────────────────────────────────

export interface OutcomeTrainingResult {
  modelName: string;
  version: number;
  modelVersionId: string;
  status: "active" | "insufficient_data";
  trainingSampleSize: number;
  segmentCount: number;
}

interface RawOutcomeRow extends Record<string, unknown> {
  n: number;
  wins: number;
  a25: number | null;
  a50: number | null;
  a75: number | null;
}

const OUTCOME_STATS_SQL = `
  COUNT(*)::int AS n,
  SUM(CASE WHEN "determinationWinner" = 'initiating_party' THEN 1 ELSE 0 END)::int AS wins,
  percentile_cont(0.25) WITHIN GROUP (ORDER BY "determinationAmount"::float) AS a25,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY "determinationAmount"::float) AS a50,
  percentile_cont(0.75) WITHIN GROUP (ORDER BY "determinationAmount"::float) AS a75
  FROM disputes
  WHERE "determinationWinner" IS NOT NULL AND "determinationAmount" IS NOT NULL`;

function toOutcomeRow(r: RawOutcomeRow, key: Record<string, string>): OutcomeSegmentRow {
  const f = (v: unknown) => {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  };
  return {
    tier: "platform", // overwritten by caller
    key,
    sampleSize: Number(r.n ?? 0),
    wins: Number(r.wins ?? 0),
    awardP25Usd: f(r.a25),
    awardP50Usd: f(r.a50),
    awardP75Usd: f(r.a75),
    medianDeterminationUsd: f(r.a50),
  };
}

/** Aggregates only; segments with n < 5 suppressed (P21 precedent). */
export async function aggregateOutcomeSegments(db: Db): Promise<OutcomeModelParameters["tiers"]> {
  const leaf = rowsOf<RawOutcomeRow>(await db.execute(sql.raw(
    `SELECT "idrEntityId", "serviceType", "patientState", ${OUTCOME_STATS_SQL} AND "idrEntityId" IS NOT NULL GROUP BY 1, 2, 3`
  ))).map(r => ({ ...toOutcomeRow(r, {
    idrEntityId: String(r.idrEntityId), serviceType: String(r.serviceType), patientState: String(r.patientState),
  }), tier: "idr_entity_x_service_x_patientstate" as const }));
  const entityService = rowsOf<RawOutcomeRow>(await db.execute(sql.raw(
    `SELECT "idrEntityId", "serviceType", ${OUTCOME_STATS_SQL} AND "idrEntityId" IS NOT NULL GROUP BY 1, 2`
  ))).map(r => ({ ...toOutcomeRow(r, { idrEntityId: String(r.idrEntityId), serviceType: String(r.serviceType) }), tier: "idr_entity_x_service" as const }));
  const serviceState = rowsOf<RawOutcomeRow>(await db.execute(sql.raw(
    `SELECT "serviceType", "patientState", ${OUTCOME_STATS_SQL} GROUP BY 1, 2`
  ))).map(r => ({ ...toOutcomeRow(r, { serviceType: String(r.serviceType), patientState: String(r.patientState) }), tier: "service_x_patientstate" as const }));
  const service = rowsOf<RawOutcomeRow>(await db.execute(sql.raw(
    `SELECT "serviceType", ${OUTCOME_STATS_SQL} GROUP BY 1`
  ))).map(r => ({ ...toOutcomeRow(r, { serviceType: String(r.serviceType) }), tier: "service" as const }));
  const plat = rowsOf<RawOutcomeRow>(await db.execute(sql.raw(`SELECT ${OUTCOME_STATS_SQL}`)))[0]
    ?? { n: 0, wins: 0, a25: null, a50: null, a75: null };
  const suppress = (rows: OutcomeSegmentRow[]) => rows.filter(r => r.sampleSize >= SEGMENT_SUPPRESSION_FLOOR);
  return {
    idr_entity_x_service_x_patientstate: suppress(leaf),
    idr_entity_x_service: suppress(entityService),
    service_x_patientstate: suppress(serviceState),
    service: suppress(service),
    platform: { ...toOutcomeRow(plat, {}), tier: "platform" },
  };
}

/** Exported for tests/journeys (clock injection via `now`). */
export async function trainOutcomeModel(db: Db, now: Date): Promise<OutcomeTrainingResult> {
  const tiers = await aggregateOutcomeSegments(db);
  const total = tiers.platform.sampleSize;
  const platformFloor = outcomeModelMinSamples();
  const parameters: OutcomeModelParameters = {
    generatedAt: now.toISOString(),
    platformFloor,
    suppressionFloor: SEGMENT_SUPPRESSION_FLOOR,
    tiers,
  };
  const segmentCount =
    tiers.idr_entity_x_service_x_patientstate.length +
    tiers.idr_entity_x_service.length +
    tiers.service_x_patientstate.length +
    tiers.service.length +
    (total > 0 ? 1 : 0);

  const latest = (await db.select().from(modelVersions)
    .where(eq(modelVersions.modelName, OUTCOME_MODEL_NAME))
    .orderBy(desc(modelVersions.version)).limit(1))[0];
  const version = (latest?.version ?? 0) + 1;
  const sufficient = total >= platformFloor;
  const id = crypto.randomUUID();

  const previousActive = (await db.select({ id: modelVersions.id }).from(modelVersions)
    .where(and(eq(modelVersions.modelName, OUTCOME_MODEL_NAME), eq(modelVersions.status, "active")))
    .limit(1))[0];

  // Atomic retire+insert (P21 precedent). On insufficient data the previous
  // active model is NOT retired — staleness is surfaced, not hidden.
  const write = async (tx: Db) => {
    if (sufficient && previousActive) {
      await tx.update(modelVersions).set({ status: "retired" }).where(eq(modelVersions.id, previousActive.id));
    }
    await tx.insert(modelVersions).values({
      id,
      modelName: OUTCOME_MODEL_NAME,
      version,
      status: sufficient ? "active" : "insufficient_data",
      trainedOn: total > 0 ? "real_determinations" : "none",
      trainingSampleSize: total,
      segmentCount,
      honestyLabel: sufficient ? "statistical_estimate" : "insufficient_data",
      modelKind: "outcome_model",
      parameters: parameters as unknown as Record<string, unknown>,
      trainedAt: now,
      activatedAt: sufficient ? now : null,
    });
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;
  if (typeof anyDb.transaction === "function") {
    await anyDb.transaction(async (tx: Db) => write(tx));
  } else {
    await write(db);
  }

  return { modelName: OUTCOME_MODEL_NAME, version, modelVersionId: id, status: sufficient ? "active" : "insufficient_data", trainingSampleSize: total, segmentCount };
}

// ────────────────────────────────────────────────────────────────────────────
// Step 4: calibration join (design §6.3 — one idempotent statement)
// ────────────────────────────────────────────────────────────────────────────

/** Exported for tests/journeys. */
export async function joinOutcomeActuals(db: Db, now: Date): Promise<{ joined: number }> {
  const nowTs = now.toISOString();
  const rows = rowsOf<Record<string, unknown>>(await db.execute(sql`
    UPDATE outcome_model_predictions p
    SET actual_winner = d."determinationWinner",
        actual_amount_usd = d."determinationAmount",
        actual_joined_at = ${nowTs}::timestamp
    FROM disputes d
    WHERE d.id = p.dispute_id
      AND p.actual_winner IS NULL
      AND d."determinationWinner" IS NOT NULL
    RETURNING p.id
  `));
  return { joined: rows.length };
}

// ────────────────────────────────────────────────────────────────────────────
// Step 5: ranking stats refresh (design §5.3 — full recompute from facts)
// ────────────────────────────────────────────────────────────────────────────

export const RANKER_MODEL_NAMES: Record<string, string> = {
  next_action: "next-action-ranker-v1",
  quarantine_suggestion: "quarantine-ranker-v1",
};

export interface RankingRefreshResult {
  rankers: Record<string, { items: number; orgs: number }>;
}

/** Exported for tests/journeys. Idempotent: state derives from facts. */
export async function refreshRankingStats(db: Db, now: Date): Promise<RankingRefreshResult> {
  const nowTs = now.toISOString();
  const result: RankingRefreshResult = { rankers: {} };

  // S2: next_action — item key {kind}:{persona}. Rejected events from
  // dismissals may lack persona metadata; inherit it from the presented
  // event for the same suggestion (suggestion_id = actionKey).
  const nextAction = rowsOf<Record<string, unknown>>(await db.execute(sql`
    WITH ev AS (
      SELECT e.org_id, e.action,
        COALESCE(e.metadata->>'kind', split_part(e.suggestion_id, ':', 1)) AS kind,
        COALESCE(
          e.metadata->>'persona',
          (SELECT p.metadata->>'persona' FROM suggestion_events p
            WHERE p.suggestion_id = e.suggestion_id AND p.surface = 'next_action'
              AND p.action = 'presented' AND p.metadata->>'persona' IS NOT NULL
            LIMIT 1),
          'unknown'
        ) AS persona
      FROM suggestion_events e
      WHERE e.surface = 'next_action'
    )
    SELECT org_id, kind, persona,
      COUNT(*) FILTER (WHERE action = 'presented')::int AS presented,
      COUNT(*) FILTER (WHERE action = 'accepted')::int AS acts,
      COUNT(*) FILTER (WHERE action = 'rejected')::int AS negatives
    FROM ev
    GROUP BY 1, 2, 3
  `));

  // S3: quarantine_suggestion — item key {field}:{source}.
  const quarantine = rowsOf<Record<string, unknown>>(await db.execute(sql`
    SELECT org_id, field_name AS field, COALESCE(metadata->>'source', 'unknown') AS source,
      COUNT(*) FILTER (WHERE action = 'presented')::int AS presented,
      COUNT(*) FILTER (WHERE action = 'accepted')::int AS acts,
      COUNT(*) FILTER (WHERE action IN ('edited', 'rejected'))::int AS negatives
    FROM suggestion_events
    WHERE surface = 'quarantine_repair' AND field_name IS NOT NULL
    GROUP BY 1, 2, 3
  `));

  const rankerRows: Record<string, Array<{ orgId: string; itemKey: string; presented: number; acts: number; negatives: number }>> = {
    next_action: nextAction.map(r => ({
      orgId: String(r.org_id),
      itemKey: `${r.kind}:${r.persona}`,
      presented: Number(r.presented ?? 0),
      acts: Number(r.acts ?? 0),
      negatives: Number(r.negatives ?? 0),
    })),
    quarantine_suggestion: quarantine.map(r => ({
      orgId: String(r.org_id),
      itemKey: `${r.field}:${r.source}`,
      presented: Number(r.presented ?? 0),
      acts: Number(r.acts ?? 0),
      negatives: Number(r.negatives ?? 0),
    })),
  };

  for (const [ranker, rows] of Object.entries(rankerRows)) {
    // Full recompute: replace the ranker's rows atomically (state derives
    // from suggestion_events — no incremental drift).
    const write = async (tx: Db) => {
      await tx.execute(sql`DELETE FROM ranking_stats WHERE ranker = ${ranker}`);
      for (const r of rows) {
        await tx.execute(sql`
          INSERT INTO ranking_stats (id, org_id, ranker, item_key, presented, acts, negatives, updated_at)
          VALUES (${crypto.randomUUID()}, ${r.orgId}, ${ranker}, ${r.itemKey}, ${r.presented}, ${r.acts}, ${r.negatives}, ${nowTs}::timestamp)
        `);
      }
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyDb = db as any;
    if (typeof anyDb.transaction === "function") {
      await anyDb.transaction(async (tx: Db) => write(tx));
    } else {
      await write(db);
    }
    const orgs = new Set(rows.map(r => r.orgId)).size;
    result.rankers[ranker] = { items: rows.length, orgs };
    await insertGovernanceRow(db, now, {
      modelName: RANKER_MODEL_NAMES[ranker],
      modelKind: "segment_stats", // rate tables ARE segment statistics (design §5.3 open decision)
      trainedOn: "real_suggestion_events",
      sufficient: rows.length > 0,
      trainingSampleSize: rows.reduce((s, r) => s + r.presented, 0),
      segmentCount: rows.length,
      parameters: {
        generatedAt: now.toISOString(),
        ranker,
        items: rows.length,
        orgs,
        // Aggregates only — no org ids in the governance payload.
        totalPresented: rows.reduce((s, r) => s + r.presented, 0),
        totalActs: rows.reduce((s, r) => s + r.acts, 0),
        totalNegatives: rows.reduce((s, r) => s + r.negatives, 0),
      },
    });
  }
  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// Shared governance-row writer (P21 retire+insert precedent)
// ────────────────────────────────────────────────────────────────────────────

async function insertGovernanceRow(
  db: Db,
  now: Date,
  opts: {
    modelName: string;
    modelKind: "segment_stats" | "bandit" | "outcome_model";
    trainedOn: string;
    sufficient: boolean;
    trainingSampleSize: number;
    segmentCount: number;
    parameters: Record<string, unknown>;
  },
) {
  const latest = (await db.select().from(modelVersions)
    .where(eq(modelVersions.modelName, opts.modelName))
    .orderBy(desc(modelVersions.version)).limit(1))[0];
  const version = (latest?.version ?? 0) + 1;
  const previousActive = (await db.select({ id: modelVersions.id }).from(modelVersions)
    .where(and(eq(modelVersions.modelName, opts.modelName), eq(modelVersions.status, "active")))
    .limit(1))[0];
  const id = crypto.randomUUID();
  const write = async (tx: Db) => {
    if (opts.sufficient && previousActive) {
      await tx.update(modelVersions).set({ status: "retired" }).where(eq(modelVersions.id, previousActive.id));
    }
    await tx.insert(modelVersions).values({
      id,
      modelName: opts.modelName,
      version,
      status: opts.sufficient ? "active" : "insufficient_data",
      trainedOn: opts.trainingSampleSize > 0 ? opts.trainedOn : "none",
      trainingSampleSize: opts.trainingSampleSize,
      segmentCount: opts.segmentCount,
      honestyLabel: opts.sufficient ? "statistical_estimate" : "insufficient_data",
      modelKind: opts.modelKind,
      parameters: opts.parameters,
      trainedAt: now,
      activatedAt: opts.sufficient ? now : null,
    });
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;
  if (typeof anyDb.transaction === "function") {
    await anyDb.transaction(async (tx: Db) => write(tx));
  } else {
    await write(db);
  }
  return { modelName: opts.modelName, version, modelVersionId: id, status: opts.sufficient ? "active" as const : "insufficient_data" as const };
}

// ────────────────────────────────────────────────────────────────────────────
// Orchestrator + handler
// ────────────────────────────────────────────────────────────────────────────

export interface LearningLoopResult {
  offerModel?: unknown;
  bandit?: { attribution?: BanditAttributionResult; governance?: unknown; error?: string };
  outcomeModel?: { training?: OutcomeTrainingResult; calibration?: { joined: number }; error?: string };
  ranking?: { result?: RankingRefreshResult; error?: string };
}

/** Exported for tests/journeys (clock injection via `now`). */
export async function runLearningLoopRefresh(db: Db, now: Date): Promise<LearningLoopResult> {
  const out: LearningLoopResult = {};

  // Step 0: wrap the P21 offer-model training (NEVER edited).
  try {
    out.offerModel = await runOfferModelTraining(db, now);
  } catch (err) {
    out.offerModel = { error: err instanceof Error ? err.message : String(err) };
  }

  // Steps 1+2: bandit attribution + governance snapshot.
  try {
    const attribution = await attributeBanditRewards(db, now);
    const governance = await snapshotBanditGovernance(db, now);
    out.bandit = { attribution, governance };
  } catch (err) {
    out.bandit = { error: err instanceof Error ? err.message : String(err) };
  }

  // Steps 3+4: outcome model training + calibration join.
  try {
    const training = await trainOutcomeModel(db, now);
    const calibration = await joinOutcomeActuals(db, now);
    out.outcomeModel = { training, calibration };
  } catch (err) {
    out.outcomeModel = { error: err instanceof Error ? err.message : String(err) };
  }

  // Step 5: ranking stats refresh.
  try {
    out.ranking = { result: await refreshRankingStats(db, now) };
  } catch (err) {
    out.ranking = { error: err instanceof Error ? err.message : String(err) };
  }

  return out;
}

export async function learningLoopRefreshHandler(req: Request, res: Response) {
  try {
    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Database not available" });
    const now = new Date();
    const result = await runLearningLoopRefresh(db, now);
    return res.json({ ok: true, ...result, timestamp: now.toISOString() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[learning-loop-refresh] Error:", message);
    return res.status(500).json({ error: message, timestamp: new Date().toISOString() });
  }
}
