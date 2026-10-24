/**
 * server/idr/outcome-model-v2.ts
 *
 * Phase 22 (S4): trained outcome prediction. Pure module, no DB — the same
 * SHAPE as the v2 offer segment engine (trust through familiarity, design
 * §6.1): the same 5-tier fallback hierarchy, the same Beta(1,1) shrinkage
 * (shrunkWinRate), with award quantiles of determinationAmount in USD.
 *
 * Trained on closed disputes (determinationWinner IS NOT NULL AND
 * determinationAmount IS NOT NULL) — features restricted to columns already
 * on `disputes` (no notes, no free text, no party names; no new PHI surface).
 *
 * Honesty: when no segment meets its floor (platform floor
 * OUTCOME_MODEL_MIN_SAMPLES, default 30), prediction is null with label
 * "insufficient_data" and the caller keeps the legacy LLM path
 * (labeled "llm-fallback"). The confidence score is a function of SAMPLE
 * SIZE ONLY — a data-availability score, never an LLM self-rating.
 */

import {
  shrunkWinRate,
  MIN_LEAF_SAMPLES,
  MIN_MID_SAMPLES,
  type SegmentStatsV2,
} from "./offer-strategy-v2";

export const OUTCOME_MODEL_NAME = "outcome-model-v2";
export const DEFAULT_OUTCOME_MODEL_MIN_SAMPLES = 30;

export function outcomeModelEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OUTCOME_MODEL_ENABLED !== "false";
}

export function outcomeModelMinSamples(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.OUTCOME_MODEL_MIN_SAMPLES);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_OUTCOME_MODEL_MIN_SAMPLES;
}

export interface OutcomeSegmentStats {
  tier: SegmentStatsV2["tier"];
  sampleSize: number;
  wins: number;
  /** determinationAmount USD quantiles (null when unavailable). */
  awardP25Usd: number | null;
  awardP50Usd: number | null;
  awardP75Usd: number | null;
  medianDeterminationUsd: number | null;
}

export interface OutcomePredictionV2 {
  /** Beta(1,1)-shrunk initiating-party win probability, 0..1. */
  winProb: number;
  awardP25Usd: number | null;
  awardP50Usd: number | null;
  awardP75Usd: number | null;
  segmentTierUsed: SegmentStatsV2["tier"];
  segmentSampleSize: number;
  /** Data-availability score 0..100: sample-size-derived ONLY. */
  confidenceScore: number;
}

function tierFloor(index: number, chainLength: number, platformMin: number): number {
  if (index === chainLength - 1) return platformMin;
  if (index === 0) return MIN_LEAF_SAMPLES;
  return MIN_MID_SAMPLES;
}

/** Confidence is a function of sample size only (design §6.4). */
export function confidenceFromSampleSize(segmentSampleSize: number): number {
  return Math.min(90, Math.round(40 + segmentSampleSize / 2));
}

/** Stored per-segment row in the model_versions.parameters payload. */
export interface OutcomeSegmentRow extends OutcomeSegmentStats {
  key: Record<string, string>;
}

export interface OutcomeModelParameters {
  generatedAt: string;
  platformFloor: number;
  suppressionFloor: number;
  tiers: {
    idr_entity_x_service_x_patientstate: OutcomeSegmentRow[];
    idr_entity_x_service: OutcomeSegmentRow[];
    service_x_patientstate: OutcomeSegmentRow[];
    service: OutcomeSegmentRow[];
    platform: OutcomeSegmentRow;
  };
}

function outcomeFromParams(
  tierList: OutcomeSegmentRow[] | undefined,
  tier: SegmentStatsV2["tier"],
  match: Record<string, string | null>,
): OutcomeSegmentStats {
  const row = (tierList ?? []).find(r =>
    Object.entries(match).every(([k, v]) => (v === null || v === undefined ? true : r.key[k] === v)));
  return {
    tier,
    sampleSize: row?.sampleSize ?? 0,
    wins: row?.wins ?? 0,
    awardP25Usd: row?.awardP25Usd ?? null,
    awardP50Usd: row?.awardP50Usd ?? null,
    awardP75Usd: row?.awardP75Usd ?? null,
    medianDeterminationUsd: row?.medianDeterminationUsd ?? null,
  };
}

/**
 * Build the prediction chain (most → least specific, platform last) from a
 * stored parameters payload and the dispute's segment fields. Mirrors the
 * offer-strategy-v2 chain construction in server/routers/intelligence.ts.
 */
export function outcomeChainFromParams(
  parameters: OutcomeModelParameters | null | undefined,
  f: { idrEntityId: string | null; serviceType: string | null; patientState: string | null },
): OutcomeSegmentStats[] {
  const tiers = parameters?.tiers;
  return [
    outcomeFromParams(tiers?.idr_entity_x_service_x_patientstate, "idr_entity_x_service_x_patientstate", {
      idrEntityId: f.idrEntityId, serviceType: f.serviceType, patientState: f.patientState,
    }),
    outcomeFromParams(tiers?.idr_entity_x_service, "idr_entity_x_service", {
      idrEntityId: f.idrEntityId, serviceType: f.serviceType,
    }),
    outcomeFromParams(tiers?.service_x_patientstate, "service_x_patientstate", {
      serviceType: f.serviceType, patientState: f.patientState,
    }),
    outcomeFromParams(tiers?.service, "service", { serviceType: f.serviceType }),
    outcomeFromParams(tiers?.platform ? [tiers.platform] : [], "platform", {}),
  ];
}

/**
 * Walk the chain most → least specific, exactly like recommendOfferV2.
 * Returns null when every tier is below its floor (honest insufficient_data).
 */
export function predictOutcomeV2(
  chain: OutcomeSegmentStats[],
  opts: { minPlatformSamples?: number } = {},
): OutcomePredictionV2 | null {
  const platformMin = opts.minPlatformSamples ?? outcomeModelMinSamples();
  let chosenIdx = -1;
  for (let i = 0; i < chain.length; i++) {
    if (chain[i].sampleSize >= tierFloor(i, chain.length, platformMin)) {
      chosenIdx = i;
      break;
    }
  }
  if (chosenIdx < 0) return null;
  const seg = chain[chosenIdx];
  const parent = chosenIdx + 1 < chain.length ? chain[chosenIdx + 1] : null;
  const winProb = shrunkWinRate(
    { ...seg, awardToQpaMedian: null, awardToQpaP25: null, awardToQpaP75: null },
    parent ? { ...parent, awardToQpaMedian: null, awardToQpaP25: null, awardToQpaP75: null } : null,
  );
  return {
    winProb: Math.round(winProb * 10000) / 10000,
    awardP25Usd: seg.awardP25Usd,
    awardP50Usd: seg.awardP50Usd,
    awardP75Usd: seg.awardP75Usd,
    segmentTierUsed: seg.tier,
    segmentSampleSize: seg.sampleSize,
    confidenceScore: confidenceFromSampleSize(seg.sampleSize),
  };
}
