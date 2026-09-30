/**
 * server/idr/offer-strategy.ts
 *
 * Phase 18: offer-strategy engine. Recommends an offer amount for a dispute
 * from honestly-labeled inputs:
 *   1. QPA variance — how far the payer's initial payment sits from the QPA
 *      (computed by the platform QPA engine upstream; injected here).
 *   2. Platform win-rate statistics by IDRE entity + service type — computed
 *      FROM disputes determinations (determinationWinner), honestly null
 *      with sample sizes when data is thin.
 *   3. Breakeven economics — admin fee + statutory IDRE fee range (same
 *      constants as submitter.breakevenAnalysis / auto-batch).
 *
 * CRITICAL HONESTY: the recommendation is labeled "statistical_estimate"
 * with a full feature breakdown. When an ML (OutcomeNet-style) win
 * probability is supplied it is MOCK-VERIFIED only — OutcomeNet is trained
 * on synthetic data (ml/data/synthetic_platform_data.py). Nothing here is a
 * guarantee of any IDR outcome.
 *
 * Pure module: no DB access. The router (submitter.recommendOffer) gathers
 * the inputs and calls recommendOffer().
 */

import { IDRE_FEE_RANGE_SINGLE_USD } from "./auto-batch";

export interface WinRateStats {
  /** Wins / determinations for this segment; null when no data. */
  winRate: number | null;
  sampleSize: number;
  wins: number;
}

export interface OfferStrategyInput {
  /** QPA (USD) for the service, when computable. */
  qpaUsd: number | null;
  /** Payer's initial/allowed payment (USD), when known. */
  initialPaymentUsd: number | null;
  /** Provider billed charge (USD). */
  billedUsd: number;
  /** Win stats for (IDRE entity × service type) segment. */
  segmentStats: WinRateStats;
  /** Platform-wide fallback stats. */
  platformStats: WinRateStats;
  /** Per-dispute administrative fee (USD). */
  adminFeeUsd: number;
  /** Optional OutcomeNet win probability — MOCK-VERIFIED synthetic model. */
  outcomeNetProbability?: number | null;
}

export interface OfferStrategyResult {
  /** Recommended offer (USD), labeled statistical estimate. Null when no
   *  anchor (no QPA and no payment data) exists — never fabricated. */
  recommendedOfferUsdStatisticalEstimate: number | null;
  label: "statistical_estimate";
  features: {
    qpaUsd: number | null;
    initialPaymentUsd: number | null;
    billedUsd: number;
    /** initialPayment / qpa when both known; <1 means paid below QPA. */
    qpaVarianceRatio: number | null;
    segmentWinRate: number | null;
    segmentSampleSize: number;
    platformWinRate: number | null;
    platformSampleSize: number;
    /** Win probability actually used (segment → platform → OutcomeNet). */
    winProbabilityUsed: number | null;
    winProbabilitySource: "segment" | "platform" | "outcomenet_synthetic" | null;
    adminFeeUsd: number;
    idreFeeRangeUsd: { min: number; max: number };
    expectedNetUsdAtRecommendation: number | null;
  };
  rationale: string[];
  modelCard?: {
    name: "OutcomeNet";
    trainedOn: "synthetic";
    note: string;
  };
  honestyNote: string;
}

const OUTCOMENET_CARD = {
  name: "OutcomeNet" as const,
  trainedOn: "synthetic" as const,
  note: "OutcomeNet is trained on synthetic platform data (ml/data/synthetic_platform_data.py) — no real IDR determination outcomes. Probabilities are model-of-a-simulation estimates for triage only; NOT assurances of any dispute outcome (MOCK-VERIFIED).",
};

const HONESTY_NOTE =
  "This is a statistical estimate derived from platform determination statistics and published fee ranges. It is NOT legal advice and NOT a prediction or guarantee of any IDR determination.";

/** Minimum segment sample size before segment stats are trusted. */
export const MIN_SEGMENT_SAMPLE = 3;

export function recommendOffer(input: OfferStrategyInput): OfferStrategyResult {
  const rationale: string[] = [];

  // ── Win probability selection: segment (if enough data) → platform → ML ──
  let pWin: number | null = null;
  let pSource: OfferStrategyResult["features"]["winProbabilitySource"] = null;
  if (input.segmentStats.sampleSize >= MIN_SEGMENT_SAMPLE && input.segmentStats.winRate !== null) {
    pWin = input.segmentStats.winRate;
    pSource = "segment";
    rationale.push(
      `Win rate ${(pWin * 100).toFixed(1)}% from ${input.segmentStats.sampleSize} determinations in this IDRE-entity × service-type segment.`
    );
  } else if (input.platformStats.sampleSize > 0 && input.platformStats.winRate !== null) {
    pWin = input.platformStats.winRate;
    pSource = "platform";
    rationale.push(
      `Segment data thin (n=${input.segmentStats.sampleSize}); using platform-wide initiating-party win rate ${(pWin * 100).toFixed(1)}% (n=${input.platformStats.sampleSize}).`
    );
  } else if (typeof input.outcomeNetProbability === "number") {
    pWin = input.outcomeNetProbability;
    pSource = "outcomenet_synthetic";
    rationale.push("No platform determination data; falling back to OutcomeNet synthetic-model probability (MOCK-VERIFIED).");
  } else {
    rationale.push("No win-probability data available (no segment, platform, or model estimate).");
  }

  // ── QPA variance ──────────────────────────────────────────────────────────
  const qpaVarianceRatio =
    input.qpaUsd !== null && input.initialPaymentUsd !== null && input.qpaUsd > 0
      ? Math.round((input.initialPaymentUsd / input.qpaUsd) * 1000) / 1000
      : null;
  if (qpaVarianceRatio !== null) {
    rationale.push(
      `Initial payment is ${(qpaVarianceRatio * 100).toFixed(1)}% of QPA (${qpaVarianceRatio < 1 ? "underpayment vs QPA" : "at/above QPA"}).`
    );
  } else {
    rationale.push("QPA variance not computable (QPA or initial payment unknown).");
  }

  // ── Offer anchor ──────────────────────────────────────────────────────────
  // Anchor at the QPA when known (the statutory presumptive factor,
  // 45 CFR 149.510(c)(4)(ii)(A)), nudged by observed win probability:
  //  - strong win signal (≥60%) → aim between QPA and billed (cap 1.5×QPA);
  //  - weak signal (≤40%) → anchor near QPA to limit downside;
  //  - no signal → QPA exactly. Without a QPA, use the midpoint between the
  //  initial payment and billed charge. No anchor → honest null.
  let recommended: number | null = null;
  if (input.qpaUsd !== null && input.qpaUsd > 0) {
    const qpa = input.qpaUsd;
    if (pWin !== null && pWin >= 0.6) {
      const upside = Math.min(input.billedUsd, qpa * 1.5);
      recommended = Math.round((qpa + (pWin - 0.6) * 2.5 * Math.max(0, upside - qpa)) * 100) / 100;
      rationale.push("Strong win signal: anchoring above QPA toward billed charge (capped at 1.5×QPA).");
    } else if (pWin !== null && pWin <= 0.4) {
      recommended = Math.round(qpa * 100) / 100;
      rationale.push("Weak win signal: anchoring at QPA to limit downside exposure.");
    } else {
      recommended = Math.round(qpa * 100) / 100;
      rationale.push("Anchoring at QPA (the statutory presumptive out-of-network rate factor).");
    }
  } else if (input.initialPaymentUsd !== null) {
    recommended = Math.round(((input.initialPaymentUsd + input.billedUsd) / 2) * 100) / 100;
    rationale.push("No QPA: anchoring at the midpoint of initial payment and billed charge.");
  }

  // ── Expected net at the recommendation (breakeven economics) ─────────────
  const expectedNet =
    recommended !== null && pWin !== null
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
      qpaUsd: input.qpaUsd,
      initialPaymentUsd: input.initialPaymentUsd,
      billedUsd: input.billedUsd,
      qpaVarianceRatio,
      segmentWinRate: input.segmentStats.winRate,
      segmentSampleSize: input.segmentStats.sampleSize,
      platformWinRate: input.platformStats.winRate,
      platformSampleSize: input.platformStats.sampleSize,
      winProbabilityUsed: pWin === null ? null : Math.round(pWin * 1000) / 1000,
      winProbabilitySource: pSource,
      adminFeeUsd: input.adminFeeUsd,
      idreFeeRangeUsd: { ...IDRE_FEE_RANGE_SINGLE_USD },
      expectedNetUsdAtRecommendation: expectedNet,
    },
    rationale,
    ...(pSource === "outcomenet_synthetic" ? { modelCard: OUTCOMENET_CARD } : {}),
    honestyNote: HONESTY_NOTE,
  };
}
