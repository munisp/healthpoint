/**
 * Phase 22 (S4) unit tests — outcome-model-v2 engine (pure, no DB).
 *
 *  - Chain fallback leaf → platform (same 5-tier hierarchy as offer v2).
 *  - Below-floor everywhere → null (honest insufficient_data upstream).
 *  - Confidence score is sample-size-derived ONLY.
 *  - Quantiles pass through from the trained segment row.
 */
import { describe, it, expect } from "vitest";
import {
  predictOutcomeV2,
  confidenceFromSampleSize,
  outcomeChainFromParams,
  type OutcomeSegmentStats,
  type OutcomeModelParameters,
} from "./outcome-model-v2";
import { MIN_LEAF_SAMPLES, MIN_MID_SAMPLES } from "./offer-strategy-v2";

function seg(tier: OutcomeSegmentStats["tier"], n: number, wins: number): OutcomeSegmentStats {
  return { tier, sampleSize: n, wins, awardP25Usd: 900, awardP50Usd: 1100, awardP75Usd: 1300, medianDeterminationUsd: 1100 };
}

const TIERS: OutcomeSegmentStats["tier"][] = [
  "idr_entity_x_service_x_patientstate",
  "idr_entity_x_service",
  "service_x_patientstate",
  "service",
  "platform",
];

describe("predictOutcomeV2", () => {
  it("uses the leaf when it meets the floor", () => {
    const chain = [seg(TIERS[0], 25, 18), seg(TIERS[1], 40, 20), seg(TIERS[2], 50, 20), seg(TIERS[3], 60, 30), seg(TIERS[4], 100, 50)];
    const r = predictOutcomeV2(chain, { minPlatformSamples: 30 });
    expect(r).not.toBeNull();
    expect(r!.segmentTierUsed).toBe(TIERS[0]);
    expect(r!.segmentSampleSize).toBe(25);
    // 18/25 raw = 0.72; shrunk toward parent (20/40=0.5) stays above 0.5.
    expect(r!.winProb).toBeGreaterThan(0.5);
    expect(r!.awardP50Usd).toBe(1100);
  });

  it("falls back up the hierarchy when thin tiers are below their floors", () => {
    const chain = [seg(TIERS[0], 3, 3), seg(TIERS[1], 4, 4), seg(TIERS[2], 50, 40), seg(TIERS[3], 60, 30), seg(TIERS[4], 100, 50)];
    const r = predictOutcomeV2(chain, { minPlatformSamples: 30 });
    expect(r!.segmentTierUsed).toBe("service_x_patientstate"); // mid floor 5
    expect(r!.segmentSampleSize).toBe(50);
  });

  it("returns null when even the platform tier is below OUTCOME_MODEL_MIN_SAMPLES", () => {
    const chain = [seg(TIERS[0], 2, 1), seg(TIERS[1], 2, 1), seg(TIERS[2], 2, 1), seg(TIERS[3], 2, 1), seg(TIERS[4], 29, 15)];
    expect(predictOutcomeV2(chain, { minPlatformSamples: 30 })).toBeNull();
  });

  it("floors match the v2 offer hierarchy (leaf 20 / mid 5 / platform configurable)", () => {
    const chain = [seg(TIERS[0], MIN_LEAF_SAMPLES - 1, 10), seg(TIERS[1], MIN_MID_SAMPLES, 3), seg(TIERS[2], 0, 0), seg(TIERS[3], 0, 0), seg(TIERS[4], 100, 50)];
    const r = predictOutcomeV2(chain, { minPlatformSamples: 30 });
    expect(r!.segmentTierUsed).toBe("idr_entity_x_service");
  });
});

describe("confidenceFromSampleSize", () => {
  it("is a function of sample size only (monotone, capped at 90)", () => {
    expect(confidenceFromSampleSize(0)).toBe(40);
    expect(confidenceFromSampleSize(20)).toBe(50);
    expect(confidenceFromSampleSize(100)).toBe(90);
    expect(confidenceFromSampleSize(100000)).toBe(90);
    expect(confidenceFromSampleSize(50)).toBeGreaterThan(confidenceFromSampleSize(10));
  });
});

describe("outcomeChainFromParams", () => {
  const params: OutcomeModelParameters = {
    generatedAt: new Date().toISOString(),
    platformFloor: 30,
    suppressionFloor: 5,
    tiers: {
      idr_entity_x_service_x_patientstate: [
        { ...seg("idr_entity_x_service_x_patientstate", 30, 21), key: { idrEntityId: "E1", serviceType: "emergency_medicine", patientState: "TX" } },
      ],
      idr_entity_x_service: [],
      service_x_patientstate: [
        { ...seg("service_x_patientstate", 40, 10), key: { serviceType: "emergency_medicine", patientState: "TX" } },
      ],
      service: [],
      platform: { ...seg("platform", 100, 55), key: {} },
    },
  };

  it("matches leaf keys and supplies the platform row", () => {
    const chain = outcomeChainFromParams(params, { idrEntityId: "E1", serviceType: "emergency_medicine", patientState: "TX" });
    expect(chain[0].sampleSize).toBe(30);
    expect(chain[2].sampleSize).toBe(40);
    expect(chain[4].sampleSize).toBe(100);
    const r = predictOutcomeV2(chain, { minPlatformSamples: 30 });
    expect(r!.segmentTierUsed).toBe("idr_entity_x_service_x_patientstate");
    expect(r!.winProb).toBeGreaterThan(0.5);
  });

  it("a non-matching dispute gets zeros on keyed tiers (honest fallback up)", () => {
    const chain = outcomeChainFromParams(params, { idrEntityId: "E9", serviceType: "radiology", patientState: "CA" });
    expect(chain[0].sampleSize).toBe(0);
    expect(chain[2].sampleSize).toBe(0);
    const r = predictOutcomeV2(chain, { minPlatformSamples: 30 });
    expect(r!.segmentTierUsed).toBe("platform");
  });

  it("null parameters → all-zero chain → null prediction", () => {
    const chain = outcomeChainFromParams(null, { idrEntityId: null, serviceType: null, patientState: null });
    expect(predictOutcomeV2(chain, { minPlatformSamples: 30 })).toBeNull();
  });
});
