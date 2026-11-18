/**
 * server/scheduled/offerModelRefresh.ts
 *
 * Phase 21 (S3): nightly offer-strategy-v2 model refresh. Follows the
 * deadlineAutopilot shape: a pure, unit-testable runOfferModelTraining(db,
 * now) plus offerModelRefreshHandler mounted at
 *   POST /api/scheduled/offer-model-refresh   (behind scheduledAuth)
 *
 * What it does (design §4.3):
 *  - Aggregates closed determinations (determinationWinner IS NOT NULL) over
 *    the disputes table into the segment hierarchy:
 *      (idrEntity × serviceType × patientState) → (idrEntity × serviceType)
 *      → (serviceType × patientState) → (serviceType) → platform.
 *  - Per segment: win counts + award-to-QPA ratio percentiles (P25/P50/P75)
 *    + median determination amount. AGGREGATES ONLY — no patient identifiers,
 *    no claim notes, no free text. Segments with n < 5 are SUPPRESSED from
 *    the stored payload (small-cell suppression, HIPAA de-id analog).
 *  - Writes a new model_versions row. When total determinations >= the
 *    global floor (20): status "active", atomically retiring the previous
 *    active row in one transaction. Below the floor: status
 *    "insufficient_data" and the previous active model is NOT retired
 *    (staleness is surfaced, not hidden).
 */

import { Request, Response } from "express";
import crypto from "crypto";
import { desc, eq, and, sql } from "drizzle-orm";
import { getDb } from "../db";
import { modelVersions } from "../../drizzle/schema-intelligence";
import { MIN_PLATFORM_SAMPLES } from "../idr/offer-strategy-v2";

export const OFFER_MODEL_NAME = "offer-strategy-v2";
/** Small-cell suppression floor for stored segment payloads. */
export const SEGMENT_SUPPRESSION_FLOOR = 5;

export interface SegmentRow {
  key: Record<string, string>;
  sampleSize: number;
  wins: number;
  awardToQpaP25: number | null;
  awardToQpaMedian: number | null;
  awardToQpaP75: number | null;
  medianDeterminationUsd: number | null;
}

export interface OfferModelParameters {
  generatedAt: string;
  globalFloor: number;
  suppressionFloor: number;
  tiers: {
    idr_entity_x_service_x_patientstate: SegmentRow[];
    idr_entity_x_service: SegmentRow[];
    service_x_patientstate: SegmentRow[];
    service: SegmentRow[];
    platform: SegmentRow;
  };
}

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

interface RawRow extends Record<string, unknown> {
  n: number;
  wins: number;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  med_det: number | null;
}

function rowsOf(result: unknown): RawRow[] {
  return (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as RawRow[];
}

const SEGMENT_STATS_SQL = `
  COUNT(*)::int AS n,
  SUM(CASE WHEN "determinationWinner" = 'initiating_party' THEN 1 ELSE 0 END)::int AS wins,
  percentile_cont(0.25) WITHIN GROUP (ORDER BY ("determinationAmount"::float / NULLIF("qpaAmount"::float, 0))) AS p25,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY ("determinationAmount"::float / NULLIF("qpaAmount"::float, 0))) AS p50,
  percentile_cont(0.75) WITHIN GROUP (ORDER BY ("determinationAmount"::float / NULLIF("qpaAmount"::float, 0))) AS p75,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY "determinationAmount"::float) AS med_det
  FROM disputes
  WHERE "determinationWinner" IS NOT NULL AND "determinationAmount" IS NOT NULL`;

function toSegmentRow(r: RawRow, key: Record<string, string>): SegmentRow {
  const f = (v: unknown) => {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : null;
  };
  return {
    key,
    sampleSize: Number(r.n ?? 0),
    wins: Number(r.wins ?? 0),
    awardToQpaP25: f(r.p25),
    awardToQpaMedian: f(r.p50),
    awardToQpaP75: f(r.p75),
    medianDeterminationUsd: f(r.med_det),
  };
}

/** Aggregate the segment hierarchy. Exported for tests. */
export async function aggregateSegments(db: Db): Promise<OfferModelParameters["tiers"]> {
  const leaf = rowsOf(await db.execute(sql.raw(
    `SELECT "idrEntityId", "serviceType", "patientState", ${SEGMENT_STATS_SQL} AND "idrEntityId" IS NOT NULL GROUP BY 1, 2, 3`
  ))).map(r => toSegmentRow(r, {
    idrEntityId: String(r.idrEntityId), serviceType: String(r.serviceType), patientState: String(r.patientState),
  }));
  const entityService = rowsOf(await db.execute(sql.raw(
    `SELECT "idrEntityId", "serviceType", ${SEGMENT_STATS_SQL} AND "idrEntityId" IS NOT NULL GROUP BY 1, 2`
  ))).map(r => toSegmentRow(r, { idrEntityId: String(r.idrEntityId), serviceType: String(r.serviceType) }));
  const serviceState = rowsOf(await db.execute(sql.raw(
    `SELECT "serviceType", "patientState", ${SEGMENT_STATS_SQL} GROUP BY 1, 2`
  ))).map(r => toSegmentRow(r, { serviceType: String(r.serviceType), patientState: String(r.patientState) }));
  const service = rowsOf(await db.execute(sql.raw(
    `SELECT "serviceType", ${SEGMENT_STATS_SQL} GROUP BY 1`
  ))).map(r => toSegmentRow(r, { serviceType: String(r.serviceType) }));
  const plat = rowsOf(await db.execute(sql.raw(`SELECT ${SEGMENT_STATS_SQL}`)))[0] ?? { n: 0, wins: 0, p25: null, p50: null, p75: null, med_det: null };
  const suppress = (rows: SegmentRow[]) => rows.filter(r => r.sampleSize >= SEGMENT_SUPPRESSION_FLOOR);
  return {
    idr_entity_x_service_x_patientstate: suppress(leaf),
    idr_entity_x_service: suppress(entityService),
    service_x_patientstate: suppress(serviceState),
    service: suppress(service),
    platform: toSegmentRow(plat, {}),
  };
}

export interface TrainingResult {
  modelName: string;
  version: number;
  modelVersionId: string;
  status: "active" | "insufficient_data";
  trainingSampleSize: number;
  segmentCount: number;
  retiredPreviousId: string | null;
}

/** Exported for tests and for the journey (clock injection via `now`). */
export async function runOfferModelTraining(db: Db, now: Date): Promise<TrainingResult> {
  const tiers = await aggregateSegments(db);
  const total = tiers.platform.sampleSize;
  const parameters: OfferModelParameters = {
    generatedAt: now.toISOString(),
    globalFloor: MIN_PLATFORM_SAMPLES,
    suppressionFloor: SEGMENT_SUPPRESSION_FLOOR,
    tiers,
  };
  const segmentCount =
    tiers.idr_entity_x_service_x_patientstate.length +
    tiers.idr_entity_x_service.length +
    tiers.service_x_patientstate.length +
    tiers.service.length +
    (total > 0 ? 1 : 0);

  const latest = (await db
    .select()
    .from(modelVersions)
    .where(eq(modelVersions.modelName, OFFER_MODEL_NAME))
    .orderBy(desc(modelVersions.version))
    .limit(1))[0];
  const version = (latest?.version ?? 0) + 1;
  const sufficient = total >= MIN_PLATFORM_SAMPLES;
  const id = crypto.randomUUID();

  const previousActive = (await db
    .select({ id: modelVersions.id })
    .from(modelVersions)
    .where(and(eq(modelVersions.modelName, OFFER_MODEL_NAME), eq(modelVersions.status, "active")))
    .limit(1))[0];

  // Atomic: retire the previous active model and insert the new row in one
  // transaction. On insufficient data the previous active model is NOT
  // retired (staleness surfaced, not hidden — design §4.3).
  const write = async (tx: Db) => {
    if (sufficient && previousActive) {
      await tx.update(modelVersions).set({ status: "retired" }).where(eq(modelVersions.id, previousActive.id));
    }
    await tx.insert(modelVersions).values({
      id,
      modelName: OFFER_MODEL_NAME,
      version,
      status: sufficient ? "active" : "insufficient_data",
      trainedOn: total > 0 ? "real_determinations" : "none",
      trainingSampleSize: total,
      segmentCount,
      honestyLabel: sufficient ? "statistical_estimate" : "insufficient_data",
      parameters,
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

  return {
    modelName: OFFER_MODEL_NAME,
    version,
    modelVersionId: id,
    status: sufficient ? "active" : "insufficient_data",
    trainingSampleSize: total,
    segmentCount,
    retiredPreviousId: sufficient && previousActive ? previousActive.id : null,
  };
}

export async function offerModelRefreshHandler(req: Request, res: Response) {
  try {
    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Database not available" });
    const now = new Date();
    const result = await runOfferModelTraining(db, now);
    return res.json({ ok: true, ...result, timestamp: now.toISOString() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[offer-model-refresh] Error:", message);
    return res.status(500).json({ error: message, timestamp: new Date().toISOString() });
  }
}
