/**
 * Phase 21 (S3): offer-strategy-v2 pure-engine tests.
 *  - shrinkage math (Beta(1,1) toward parent)
 *  - cold-start thresholds per tier (leaf 20 / mid 5 / platform 20)
 *  - null + insufficient_data label on thin data (never trained-looking)
 *  - modelVersion block carried in every payload
 *  - award-to-QPA median cap adjustment
 */
import { describe, it, expect } from "vitest";
import {
  recommendOfferV2,
  shrunkWinRate,
  MIN_LEAF_SAMPLES,
  MIN_MID_SAMPLES,
  MIN_PLATFORM_SAMPLES,
  type SegmentStatsV2,
  type ModelVersionBlock,
} from "./offer-strategy-v2";

function seg(tier: SegmentStatsV2["tier"], n: number, wins: number, median: number | null = null): SegmentStatsV2 {
  return { tier, sampleSize: n, wins, awardToQpaMedian: median, awardToQpaP25: median, awardToQpaP75: median, medianDeterminationUsd: null };
}

const MV: ModelVersionBlock = { id: "mv1", version: 3, trainedAt: "2026-09-01T00:00:00Z", trainingSampleSize: 100, honestyLabel: "statistical_estimate" };

const BASE = { qpaUsd: 1000, initialPaymentUsd: 600, billedUsd: 2000, adminFeeUsd: 50, modelVersion: MV };

describe("shrunkWinRate", () => {
  it("shrinks toward the parent rate with weight = parent sample size", () => {
    const leaf = seg("service", 10, 2); // raw 20%
    const parent = seg("platform", 100, 60); // 60%
    const r = shrunkWinRate(leaf, parent);
    // (2 + 1 + 100*0.6) / (10 + 2 + 100) = 63/112
    expect(r).toBeCloseTo(63 / 112, 6);
    expect(r).toBeGreaterThan(0.2); // pulled toward parent
    expect(r).toBeLessThan(0.6);
  });
  it("uses an uninformative 50% prior without a parent", () => {
    const r = shrunkWinRate(seg("platform", 20, 20), null);
    expect(r).toBeCloseTo(21 / 22, 6); // (20+1)/(20+2)
  });
  it("caps parent strength at 100", () => {
    const leaf = seg("service", 5, 5);
    const parent = seg("platform", 10000, 0);
    expect(shrunkWinRate(leaf, parent)).toBeCloseTo((5 + 1) / (5 + 2 + 100), 6);
  });
});

describe("recommendOfferV2 cold-start honesty", () => {
  it("returns null + insufficient_data when even the platform tier is thin", () => {
    const r = recommendOfferV2({
      ...BASE,
      segmentChain: [
        seg("idr_entity_x_service_x_patientstate", 2, 1),
        seg("idr_entity_x_service", 3, 2),
        seg("service_x_patientstate", 4, 2),
        seg("service", 4, 2),
        seg("platform", 19, 10), // below the 20 floor
      ],
    });
    expect(r.label).toBe("insufficient_data");
    expect(r.recommendedOfferUsdStatisticalEstimate).toBeNull();
    expect(r.modelVersion.honestyLabel).toBe("insufficient_data");
    expect(r.honestyNote).toMatch(/INSUFFICIENT DATA/);
    expect(r.features.segmentTierUsed).toBeNull();
  });

  it("walks up the hierarchy past thin leaf/mid tiers", () => {
    const r = recommendOfferV2({
      ...BASE,
      segmentChain: [
        seg("idr_entity_x_service_x_patientstate", 19, 18, 1.4), // below leaf floor (20)
        seg("idr_entity_x_service", 25, 20, 1.4), // mid tier, floor 5 → used
        seg("service_x_patientstate", 40, 20),
        seg("service", 100, 50),
        seg("platform", 500, 250),
      ],
    });
    expect(r.label).toBe("statistical_estimate");
    expect(r.features.segmentTierUsed).toBe("idr_entity_x_service");
    expect(r.features.segmentSampleSize).toBe(25);
    expect(r.features.rawWinRate).toBeCloseTo(0.8, 3);
    expect(r.rationale.join(" ")).toMatch(/below floor/);
  });

  it("uses the platform tier only at n >= 20", () => {
    const thin = recommendOfferV2({ ...BASE, segmentChain: [seg("service", 0, 0), seg("platform", 19, 10)] });
    expect(thin.label).toBe("insufficient_data");
    const ok = recommendOfferV2({ ...BASE, segmentChain: [seg("service", 0, 0), seg("platform", 20, 10)] });
    expect(ok.label).toBe("statistical_estimate");
    expect(ok.features.segmentTierUsed).toBe("platform");
  });

  it("honors the OFFER_MODEL_MIN_SEGMENT_SAMPLES override for the leaf", () => {
    const r = recommendOfferV2({
      ...BASE,
      minLeafSamples: 5,
      segmentChain: [seg("idr_entity_x_service_x_patientstate", 6, 6, 1.3), seg("platform", 100, 50)],
    });
    expect(r.features.segmentTierUsed).toBe("idr_entity_x_service_x_patientstate");
    expect(MIN_LEAF_SAMPLES).toBe(20);
    expect(MIN_MID_SAMPLES).toBe(5);
    expect(MIN_PLATFORM_SAMPLES).toBe(20);
  });
});

describe("recommendOfferV2 anchoring", () => {
  it("moves the strong-signal cap toward the segment award-to-QPA median", () => {
    // pWin shrunk of 24/25 wins leaf vs 50% parent of n=100:
    // (24+1+50)/(25+2+100) = 75/127 ≈ 0.5906 — below 0.6, so use a bigger leaf.
    const r = recommendOfferV2({
      ...BASE,
      segmentChain: [
        seg("idr_entity_x_service_x_patientstate", 40, 39, 1.2),
        seg("idr_entity_x_service", 100, 90, 1.2),
        seg("platform", 1000, 500),
      ],
    });
    expect(r.features.segmentTierUsed).toBe("idr_entity_x_service_x_patientstate");
    // pWin = (39+1+500*0.5... parent = idr_entity_x_service n=100 wins=90 → 0.9
    // pWin = (39 + 1 + 100*0.9) / (40 + 2 + 100) = 130/142 ≈ 0.9155 ≥ 0.6
    expect(r.features.shrunkWinRate).toBeGreaterThan(0.6);
    // cap = 1.2×QPA → upside = min(billed=2000, 1200) = 1200
    const pWin = 130 / 142;
    const expected = Math.round((1000 + (pWin - 0.6) * 2.5 * 200) * 100) / 100;
    expect(r.recommendedOfferUsdStatisticalEstimate).toBeCloseTo(expected, 2);
    expect(r.rationale.join(" ")).toMatch(/1\.20×QPA/);
  });

  it("anchors at QPA on a weak signal and at midpoint without QPA", () => {
    const weak = recommendOfferV2({
      ...BASE,
      segmentChain: [seg("service", 30, 3, 1.1), seg("platform", 100, 10)],
    });
    expect(weak.recommendedOfferUsdStatisticalEstimate).toBe(1000);
    const noQpa = recommendOfferV2({
      ...BASE,
      qpaUsd: null,
      segmentChain: [seg("platform", 50, 25)],
    });
    expect(noQpa.recommendedOfferUsdStatisticalEstimate).toBe(1300); // (600+2000)/2
  });

  it("withholds the estimate when no anchor exists but stays honest", () => {
    const r = recommendOfferV2({
      ...BASE,
      qpaUsd: null,
      initialPaymentUsd: null,
      segmentChain: [seg("platform", 50, 25)],
    });
    expect(r.label).toBe("statistical_estimate");
    expect(r.recommendedOfferUsdStatisticalEstimate).toBeNull();
    expect(r.features.shrunkWinRate).not.toBeNull();
  });

  it("carries the modelVersion block on every response", () => {
    const r = recommendOfferV2({ ...BASE, segmentChain: [seg("platform", 50, 25)] });
    expect(r.modelVersion).toEqual(MV);
  });

  it("never emits a synthetic-model fallback (no OutcomeNet path)", () => {
    const r = recommendOfferV2({ ...BASE, segmentChain: [seg("platform", 0, 0)] });
    expect(r.label).toBe("insufficient_data");
    expect(JSON.stringify(r)).not.toMatch(/OutcomeNet/);
  });
});
