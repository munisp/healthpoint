/**
 * server/idr/offer-strategy-v2.ts
 *
 * Phase 21 (S3): data-trained offer strategy. Pure module, no DB — the
 * caller (offerStrategy.recommendV2 in server/routers/intelligence.ts)
 * gathers segment statistics from the active model_versions row and the
 * dispute row, and calls recommendOfferV2().
 *
 * Differences from v1 (server/idr/offer-strategy.ts, untouched for rollback):
 *  - Win probability comes from REAL closed determinations aggregated per
 *    segment with Beta(1,1) shrinkage toward the parent segment's rate.
 *  - The award anchor adjusts by the segment's observed award-to-QPA median.
 *  - COLD-START HONESTY (hard rule, design §4.2): thin segments fall back up
 *    the hierarchy (leaf → mid → platform); when even the platform segment is
 *    below the floor the recommendation is null with label
 *    "insufficient_data". The v1 OutcomeNet synthetic fallback (MOCK-VERIFIED)
 *    is explicitly NOT carried forward.
 *  - Every payload carries the modelVersion block (id, version, trainedAt,
 *    trainingSampleSize, honestyLabel) — the label is in the payload, not
 *    just the docs.
 */

import { IDRE_FEE_RANGE_SINGLE_USD } from "./auto-batch";

/** Minimum determinations before a segment tier is trusted (design §4.2). */
export const MIN_LEAF_SAMPLES = 20;
export const MIN_MID_SAMPLES = 5;
export const MIN_PLATFORM_SAMPLES = 20;

export function minLeafSamples(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.OFFER_MODEL_MIN_SEGMENT_SAMPLES);
  return Number.isInteger(n) && n >= 1 ? n : MIN_LEAF_SAMPLES;
}

export interface SegmentStatsV2 {
  /** Which hierarchy tier produced these stats. */
  tier: "idr_entity_x_service_x_patientstate" | "idr_entity_x_service" | "service_x_patientstate" | "service" | "platform";
  /** Closed determinations in the segment (determinationWinner IS NOT NULL). */
  sampleSize: number;
  /** Initiating-party wins in the segment. */
  wins: number;
  /** determinationAmount / qpaAmount percentiles (null when unavailable). */
  awardToQpaMedian: number | null;
  awardToQpaP25: number | null;
  awardToQpaP75: number | null;
  medianDeterminationUsd: number | null;
}

export interface ModelVersionBlock {
  id: string | null;
  version: number | null;
  trainedAt: string | null;
  trainingSampleSize: number;
  honestyLabel: "statistical_estimate" | "insufficient_data";
}

export interface OfferStrategyV2Input {
  qpaUsd: number | null;
  initialPaymentUsd: number | null;
  billedUsd: number;
  adminFeeUsd: number;
  /** Most → least specific; the LAST entry is the platform-wide segment. */
  segmentChain: SegmentStatsV2[];
  modelVersion: ModelVersionBlock;
  minLeafSamples?: number;
  minMidSamples?: number;
  minPlatformSamples?: number;
}

export interface OfferStrategyV2Result {
  recommendedOfferUsdStatisticalEstimate: number | null;
  label: "statistical_estimate" | "insufficient_data";
  features: {
    qpaUsd: number | null;
    initialPaymentUsd: number | null;
    billedUsd: number;
    qpaVarianceRatio: number | null;
    segmentTierUsed: SegmentStatsV2["tier"] | null;
    segmentSampleSize: number;
    rawWinRate: number | null;
    /** Beta(1,1) win rate shrunk toward the parent segment's rate. */
    shrunkWinRate: number | null;
    shrinkageParentTier: SegmentStatsV2["tier"] | null;
    awardToQpaMedian: number | null;
    awardToQpaP25: number | null;
    awardToQpaP75: number | null;
    adminFeeUsd: number;
    idreFeeRangeUsd: { min: number; max: number };
    expectedNetUsdAtRecommendation: number | null;
  };
  rationale: string[];
  modelVersion: ModelVersionBlock;
  honestyNote: string;
}

const HONESTY_NOTE_V2 =
  "This is a statistical estimate derived from real platform IDR determinations aggregated by segment. It is NOT legal advice and NOT a prediction or guarantee of any IDR determination. Thin segments fall back to broader segments; when no segment meets the minimum sample floor, no estimate is produced at all (insufficient_data).";

const INSUFFICIENT_NOTE =
  "INSUFFICIENT DATA: not enough closed determinations exist in any segment of the fallback hierarchy to produce an honest statistical estimate. No recommendation is given — this is deliberately NOT filled from a synthetic model.";

/**
 * Beta(1,1)-smoothed win rate shrunk toward the parent segment's rate,
 * with prior strength equal to the parent's sample size (weight = sampleSize).
 */
export function shrunkWinRate(segment: SegmentStatsV2, parent: SegmentStatsV2 | null): number {
  const parentMean = parent && parent.sampleSize > 0 ? parent.wins / parent.sampleSize : 0.5;
  const parentStrength = parent ? Math.min(parent.sampleSize, 100) : 0;
  const num = segment.wins + 1 + parentStrength * parentMean;
  const den = segment.sampleSize + 2 + parentStrength;
  return num / den;
}

/** Smallest sample size at which a tier may be used. */
function tierFloor(
  index: number,
  chainLength: number,
  leafMin: number,
  midMin: number,
  platformMin: number,
): number {
  if (index === chainLength - 1) return platformMin; // platform tier (last)
  if (index === 0) return leafMin; // most specific tier
  return midMin;
}

export function recommendOfferV2(input: OfferStrategyV2Input): OfferStrategyV2Result {
  const rationale: string[] = [];
  const leafMin = input.minLeafSamples ?? minLeafSamples();
  const midMin = input.minMidSamples ?? MIN_MID_SAMPLES;
  const platformMin = input.minPlatformSamples ?? MIN_PLATFORM_SAMPLES;

  // ── Segment selection: walk the hierarchy most → least specific ─────────
  let chosenIdx = -1;
  for (let i = 0; i < input.segmentChain.length; i++) {
    const seg = input.segmentChain[i];
    const floor = tierFloor(i, input.segmentChain.length, leafMin, midMin, platformMin);
    if (seg.sampleSize >= floor) {
      chosenIdx = i;
      break;
    }
    rationale.push(
      `Segment tier "${seg.tier}" below floor (n=${seg.sampleSize} < ${floor}); falling back to a broader segment.`
    );
  }

  const baseFeatures = {
    qpaUsd: input.qpaUsd,
    initialPaymentUsd: input.initialPaymentUsd,
    billedUsd: input.billedUsd,
    qpaVarianceRatio:
      input.qpaUsd !== null && input.initialPaymentUsd !== null && input.qpaUsd > 0
        ? Math.round((input.initialPaymentUsd / input.qpaUsd) * 1000) / 1000
        : null,
    adminFeeUsd: input.adminFeeUsd,
    idreFeeRangeUsd: { ...IDRE_FEE_RANGE_SINGLE_USD },
  };

  if (chosenIdx < 0) {
    const platform = input.segmentChain[input.segmentChain.length - 1];
    rationale.push(
      `No segment met its minimum sample floor (platform n=${platform ? platform.sampleSize : 0}, floor ${platformMin}). Recommendation withheld.`
    );
    return {
      recommendedOfferUsdStatisticalEstimate: null,
      label: "insufficient_data",
      features: {
        ...baseFeatures,
        segmentTierUsed: null,
        segmentSampleSize: 0,
        rawWinRate: null,
        shrunkWinRate: null,
        shrinkageParentTier: null,
        awardToQpaMedian: null,
        awardToQpaP25: null,
        awardToQpaP75: null,
        expectedNetUsdAtRecommendation: null,
      },
      rationale,
      modelVersion: { ...input.modelVersion, honestyLabel: "insufficient_data" },
      honestyNote: INSUFFICIENT_NOTE,
    };
  }

  const seg = input.segmentChain[chosenIdx];
  const parent = chosenIdx + 1 < input.segmentChain.length ? input.segmentChain[chosenIdx + 1] : null;
  const rawRate = seg.sampleSize > 0 ? seg.wins / seg.sampleSize : null;
  const pWin = shrunkWinRate(seg, parent);
  rationale.push(
    `Win probability ${(pWin * 100).toFixed(1)}% from segment tier "${seg.tier}" (n=${seg.sampleSize}, wins=${seg.wins}), Beta(1,1)-smoothed and shrunk toward the ${parent ? `"${parent.tier}" tier` : "uninformative 50% prior"} (raw rate ${rawRate !== null ? (rawRate * 100).toFixed(1) + "%" : "n/a"}).`
  );

  if (baseFeatures.qpaVarianceRatio !== null) {
    rationale.push(
      `Initial payment is ${(baseFeatures.qpaVarianceRatio * 100).toFixed(1)}% of QPA (${baseFeatures.qpaVarianceRatio < 1 ? "underpayment vs QPA" : "at/above QPA"}).`
    );
  }
  if (seg.awardToQpaMedian !== null) {
    rationale.push(
      `Segment award-to-QPA median ${seg.awardToQpaMedian.toFixed(2)}× (P25 ${seg.awardToQpaP25?.toFixed(2) ?? "n/a"}×, P75 ${seg.awardToQpaP75?.toFixed(2) ?? "n/a"}×) over n=${seg.sampleSize} determinations.`
    );
  }

  // ── Offer anchor: v1's QPA-anchored heuristic, with the strong-signal cap
  // adjusted toward the segment's observed award-to-QPA median ─────────────
  let recommended: number | null = null;
  if (input.qpaUsd !== null && input.qpaUsd > 0) {
    const qpa = input.qpaUsd;
    if (pWin >= 0.6) {
      // Strong signal: cap moves from the v1 1.5×QPA toward the segment's
      // observed award median (floored at 1.0×QPA, never above 1.5×QPA).
      const capMultiple = Math.max(1.0, Math.min(1.5, seg.awardToQpaMedian ?? 1.5));
      const upside = Math.min(input.billedUsd, qpa * capMultiple);
      recommended = Math.round((qpa + (pWin - 0.6) * 2.5 * Math.max(0, upside - qpa)) * 100) / 100;
      rationale.push(
        `Strong win signal: anchoring above QPA toward billed charge (capped at ${capMultiple.toFixed(2)}×QPA${seg.awardToQpaMedian !== null ? " — the segment's observed award-to-QPA median" : " — the v1 default 1.5×"}).`
      );
    } else if (pWin <= 0.4) {
      recommended = Math.round(qpa * 100) / 100;
      rationale.push("Weak win signal: anchoring at QPA to limit downside exposure.");
    } else {
      recommended = Math.round(qpa * 100) / 100;
      rationale.push("Anchoring at QPA (the statutory presumptive out-of-network rate factor).");
    }
  } else if (input.initialPaymentUsd !== null) {
    recommended = Math.round(((input.initialPaymentUsd + input.billedUsd) / 2) * 100) / 100;
    rationale.push("No QPA: anchoring at the midpoint of initial payment and billed charge.");
  } else {
    rationale.push("No QPA and no initial payment known — no honest anchor exists; recommendation withheld.");
  }

  const expectedNet =
    recommended !== null
      ? Math.round(
          (pWin * recommended - input.adminFeeUsd - (1 - pWin) * IDRE_FEE_RANGE_SINGLE_USD.min) * 100
        ) / 100
      : null;
  if (expectedNet !== null) {
    rationale.push(
      `Expected net at recommendation: $${expectedNet.toFixed(2)} (win prob × offer − admin fee − lose-case IDRE fee range minimum).`
    );
  }

  return {
    recommendedOfferUsdStatisticalEstimate: recommended,
    label: "statistical_estimate",
    features: {
      ...baseFeatures,
      segmentTierUsed: seg.tier,
      segmentSampleSize: seg.sampleSize,
      rawWinRate: rawRate !== null ? Math.round(rawRate * 1000) / 1000 : null,
      shrunkWinRate: Math.round(pWin * 1000) / 1000,
      shrinkageParentTier: parent ? parent.tier : null,
      awardToQpaMedian: seg.awardToQpaMedian,
      awardToQpaP25: seg.awardToQpaP25,
      awardToQpaP75: seg.awardToQpaP75,
      expectedNetUsdAtRecommendation: expectedNet,
    },
    rationale,
    modelVersion: input.modelVersion,
    honestyNote: HONESTY_NOTE_V2,
  };
}
