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
import { and, eq } from "drizzle-orm";
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
  /** Extra fields for the calibration log (outcome_model_predictions). */
  modelVersionId: string;
  prediction: OutcomePredictionV2;
  segmentKey: string;
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
  const winPct = Math.round(prediction.winProb * 100);
  const seg = chain.find(s => s.tier === prediction.segmentTierUsed)!;
  const rawRate = seg.sampleSize > 0 ? Math.round((seg.wins / seg.sampleSize) * 100) : null;
  const keyFactors = [
    `Segment ${prediction.segmentTierUsed} (${segmentKey}): n=${prediction.segmentSampleSize} closed determinations.`,
    `Initiating-party win rate ${rawRate ?? "?"}% raw, ${winPct}% after Beta(1,1) shrinkage toward the parent segment.`,
    prediction.awardP50Usd !== null
      ? `Segment award quantiles: P25 $${prediction.awardP25Usd}, median $${prediction.awardP50Usd}, P75 $${prediction.awardP75Usd}.`
      : "Award quantiles unavailable for this segment.",
    `Confidence score ${prediction.confidenceScore}/100 reflects segment sample size only (data availability, not a self-rating).`,
  ];
  const recommendation =
    `Statistical estimate from ${prediction.segmentSampleSize} real platform determinations in segment "${segmentKey}": ` +
    `initiating-party win probability ≈ ${winPct}%. ` +
    (prediction.awardP50Usd !== null
      ? `Historical awards in this segment cluster around $${prediction.awardP50Usd} (P25–P75: $${prediction.awardP25Usd}–$${prediction.awardP75Usd}). `
      : "") +
    `This is a statistical estimate, NOT a prediction guarantee or legal advice.`;

  return {
    winProbability: winPct,
    confidenceScore: prediction.confidenceScore,
    keyFactors,
    recommendation,
    modelVersion: `${OUTCOME_MODEL_NAME}:v${active.version}`,
    source: "trained",
    modelVersionId: active.id,
    prediction,
    segmentKey,
  };
}
