/**
 * server/idr/outcome-prediction-source.ts
 *
 * Phase 22 (S4): trained-model source for predictions.generate. The caller
 * (server/routers.ts, flagged minimal edit) loads the dispute row, calls
 * generateOutcomePredictionFromModel(), and falls back to the legacy LLM
 * path (labeled "llm-fallback") when this returns null — i.e. when
 * OUTCOME_MODEL_ENABLED=false, no active outcome-model-v2 row exists, or the
 * segment chain is below the sample floors.
 *
 * Output shape matches the legacy upsert fields exactly (winProbability,
 * confidenceScore, keyFactors, recommendation, modelVersion) — procedure
 * signatures and response shape are unchanged; only the SOURCE of the
 * numbers differs, and modelVersion identifies the source.
 */
import { and, eq, sql } from "drizzle-orm";
import { modelVersions } from "../../drizzle/schema-intelligence";
import {
  OUTCOME_MODEL_NAME,
  outcomeChainFromParams,
  outcomeModelEnabled,
  predictOutcomeV2,
  type OutcomeModelParameters,
  type OutcomePredictionV2,
} from "./outcome-model-v2";
import { canonicalSegmentKey } from "./segment-keys";
import {
  kllMergeSql,
  kllQuantileSql,
  sketchEligible,
  sketchMinRows,
  sketchesActive,
  type EstimateProvenance,
} from "./sketches";
import type { getDb } from "../db";
import type { Dispute } from "../../drizzle/schema";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export interface TrainedOutcomePrediction {
  winProbability: number; // 0-100, matches the legacy output contract
  confidenceScore: number; // sample-size-derived ONLY
  keyFactors: string[];
  recommendation: string;
  modelVersion: string; // `outcome-model-v2:v{n}` — source-identifying
  source: "trained";
  /**
   * Phase 23: how the award quantiles were produced — "kll_sketch" (Apache
   * DataSketches KLL approximation, bounded rank error) or "exact"
   * (percentile_cont over the training aggregates). ADDITIVE field; every
   * pre-P22 field is unchanged.
   */
  estimateProvenance: EstimateProvenance;
  /** Extra fields for the calibration log (outcome_model_predictions). */
  modelVersionId: string;
  prediction: OutcomePredictionV2;
  segmentKey: string;
}

function rowsOf<T extends Record<string, unknown>>(result: unknown): T[] {
  return (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as T[];
}

/**
 * Phase 23 read path: KLL quantiles from outcome_segment_sketches when the
 * extension is active and the segment's sketched rows total >=
 * SKETCH_MIN_ROWS; otherwise the exact percentile_cont quantiles trained
 * into the model parameters. Never blocks serving on sketch availability.
 * Returns null unless the sketch path actually produced quantiles.
 */
async function sketchQuantilesForSegment(
  db: Db,
  segmentKey: string,
): Promise<{ p25: number; p50: number; p75: number; n: number } | null> {
  if (!(await sketchesActive(db))) return null;
  const minRows = sketchMinRows();
  // kll merge exists ONLY as an aggregate over the sketch column; the stored
  // bytea is cast back via the extension's assignment cast. segment_key is a
  // bound parameter — never interpolated.
  const q = (frac: number) => kllQuantileSql(kllMergeSql("sketch::kll_double_sketch"), frac);
  let rows: Array<Record<string, unknown>>;
  try {
    rows = rowsOf<Record<string, unknown>>(await db.execute(sql`
      SELECT COALESCE(SUM(row_count), 0)::float8 AS n,
        ${sql.raw(q(0.25))} AS q25,
        ${sql.raw(q(0.50))} AS q50,
        ${sql.raw(q(0.75))} AS q75
      FROM outcome_segment_sketches
      WHERE segment_key = ${segmentKey} AND sketch IS NOT NULL
    `));
  } catch {
    // Never block serving on sketch availability: any sketch-read failure
    // falls back to the exact trained quantiles (estimateProvenance "exact").
    return null;
  }
  const r = rows[0];
  const n = Number(r?.n ?? 0);
  if (!r || r.q25 === null || r.q25 === undefined) return null;
  if (!sketchEligible(n, minRows)) return null;
  const cents = (v: unknown) => Math.round(Number(v) * 100) / 100;
  return { p25: cents(r.q25), p50: cents(r.q50), p75: cents(r.q75), n };
}

/**
 * Returns null when the trained source is unavailable or the segment chain is
 * below the floors — the caller then runs the legacy LLM path unchanged.
 */
export async function generateOutcomePredictionFromModel(
  db: Db,
  disputeRow: Dispute,
): Promise<TrainedOutcomePrediction | null> {
  if (!outcomeModelEnabled()) return null;
  const active = (await db.select().from(modelVersions)
    .where(and(eq(modelVersions.modelName, OUTCOME_MODEL_NAME), eq(modelVersions.status, "active")))
    .limit(1))[0];
  if (!active) return null;

  const fields = {
    idrEntityId: disputeRow.idrEntityId ?? null,
    serviceType: disputeRow.serviceType ?? null,
    patientState: disputeRow.patientState ?? null,
  };
  const chain = outcomeChainFromParams(active.parameters as OutcomeModelParameters, fields);
  const prediction = predictOutcomeV2(chain);
  if (!prediction) return null; // honest insufficient_data → caller falls back

  const segmentKey = canonicalSegmentKey(prediction.segmentTierUsed, fields);

  // Phase 23: sketch quantiles when eligible, else the exact trained
  // quantiles. Exact mode is byte-identical to the P22 behavior below.
  let estimateProvenance: EstimateProvenance = "exact";
  let finalPrediction = prediction;
  const sketchQ = await sketchQuantilesForSegment(db, segmentKey);
  if (sketchQ) {
    finalPrediction = {
      ...prediction,
      awardP25Usd: sketchQ.p25,
      awardP50Usd: sketchQ.p50,
      awardP75Usd: sketchQ.p75,
    };
    estimateProvenance = "kll_sketch";
  }

  const winPct = Math.round(finalPrediction.winProb * 100);
  const seg = chain.find(s => s.tier === finalPrediction.segmentTierUsed)!;
  const rawRate = seg.sampleSize > 0 ? Math.round((seg.wins / seg.sampleSize) * 100) : null;
  const quantileFactor =
    estimateProvenance === "kll_sketch"
      ? `Segment award quantiles are KLL-sketch estimates (Apache DataSketches; bounded-rank-error approximation over ${sketchQ!.n} determinations): P25 $${finalPrediction.awardP25Usd}, median $${finalPrediction.awardP50Usd}, P75 $${finalPrediction.awardP75Usd}. The win rate remains an exact aggregate.`
      : finalPrediction.awardP50Usd !== null
        ? `Segment award quantiles: P25 $${finalPrediction.awardP25Usd}, median $${finalPrediction.awardP50Usd}, P75 $${finalPrediction.awardP75Usd}.`
        : "Award quantiles unavailable for this segment.";
  const keyFactors = [
    `Segment ${finalPrediction.segmentTierUsed} (${segmentKey}): n=${finalPrediction.segmentSampleSize} closed determinations.`,
    `Initiating-party win rate ${rawRate ?? "?"}% raw, ${winPct}% after Beta(1,1) shrinkage toward the parent segment.`,
    quantileFactor,
    `Confidence score ${finalPrediction.confidenceScore}/100 reflects segment sample size only (data availability, not a self-rating).`,
  ];
  const recommendation =
    `Statistical estimate from ${finalPrediction.segmentSampleSize} real platform determinations in segment "${segmentKey}": ` +
    `initiating-party win probability ≈ ${winPct}%. ` +
    (finalPrediction.awardP50Usd !== null
      ? `Historical awards in this segment cluster around $${finalPrediction.awardP50Usd} (P25–P75: $${finalPrediction.awardP25Usd}–$${finalPrediction.awardP75Usd}). `
      : "") +
    (estimateProvenance === "kll_sketch"
      ? `Award quantiles are approximations from a KLL sketch with bounded rank error, labeled estimateProvenance "kll_sketch". `
      : "") +
    `This is a statistical estimate, NOT a prediction guarantee or legal advice.`;

  return {
    winProbability: winPct,
    confidenceScore: finalPrediction.confidenceScore,
    keyFactors,
    recommendation,
    modelVersion: `${OUTCOME_MODEL_NAME}:v${active.version}`,
    source: "trained",
    estimateProvenance,
    modelVersionId: active.id,
    prediction: finalPrediction,
    segmentKey,
  };
}
