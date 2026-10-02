/**
 * Unit tests for the Phase 18 offer-strategy engine (pure module — no DB).
 * EXECUTED-VERIFIED: vitest. ML (OutcomeNet) path is MOCK-VERIFIED and
 * labeled as such in the output contract.
 */
import { describe, it, expect } from "vitest";
import { recommendOffer, MIN_SEGMENT_SAMPLE } from "./offer-strategy";

const base = {
  qpaUsd: 2000,
  initialPaymentUsd: 900,
  billedUsd: 4200,
  adminFeeUsd: 350,
};

describe("recommendOffer", () => {
  it("uses segment win stats when the sample is large enough", () => {
    const r = recommendOffer({
      ...base,
      segmentStats: { winRate: 0.75, sampleSize: MIN_SEGMENT_SAMPLE + 5, wins: 6 },
      platformStats: { winRate: 0.5, sampleSize: 100, wins: 50 },
    });
    expect(r.label).toBe("statistical_estimate");
    expect(r.features.winProbabilitySource).toBe("segment");
    expect(r.features.qpaVarianceRatio).toBeCloseTo(0.45, 5);
    // Strong signal: recommendation at/above QPA, capped at 1.5×QPA.
    expect(r.recommendedOfferUsdStatisticalEstimate!).toBeGreaterThanOrEqual(2000);
    expect(r.recommendedOfferUsdStatisticalEstimate!).toBeLessThanOrEqual(3000);
    expect(r.features.expectedNetUsdAtRecommendation).not.toBeNull();
  });

  it("falls back to platform stats for thin segments, anchors at QPA on weak signal", () => {
    const r = recommendOffer({
      ...base,
      segmentStats: { winRate: 0.9, sampleSize: 1, wins: 1 }, // thin → ignored
      platformStats: { winRate: 0.3, sampleSize: 40, wins: 12 },
    });
    expect(r.features.winProbabilitySource).toBe("platform");
    expect(r.recommendedOfferUsdStatisticalEstimate).toBe(2000);
  });

  it("uses OutcomeNet only when no platform data exists, with the synthetic model card", () => {
    const r = recommendOffer({
      ...base,
      segmentStats: { winRate: null, sampleSize: 0, wins: 0 },
      platformStats: { winRate: null, sampleSize: 0, wins: 0 },
      outcomeNetProbability: 0.7,
    });
    expect(r.features.winProbabilitySource).toBe("outcomenet_synthetic");
    expect(r.modelCard?.trainedOn).toBe("synthetic");
    expect(r.modelCard?.note).toMatch(/MOCK-VERIFIED/);
  });

  it("honest null when no anchor exists (no QPA and no initial payment)", () => {
    const r = recommendOffer({
      ...base,
      qpaUsd: null,
      initialPaymentUsd: null,
      segmentStats: { winRate: 0.6, sampleSize: 10, wins: 6 },
      platformStats: { winRate: 0.5, sampleSize: 50, wins: 25 },
    });
    expect(r.recommendedOfferUsdStatisticalEstimate).toBeNull();
    expect(r.features.expectedNetUsdAtRecommendation).toBeNull();
    expect(r.honestyNote).toMatch(/NOT a prediction or guarantee/);
  });

  it("anchors at midpoint when QPA is unknown but payment is known", () => {
    const r = recommendOffer({
      ...base,
      qpaUsd: null,
      segmentStats: { winRate: null, sampleSize: 0, wins: 0 },
      platformStats: { winRate: 0.5, sampleSize: 10, wins: 5 },
    });
    expect(r.recommendedOfferUsdStatisticalEstimate).toBe(2550);
  });
});
