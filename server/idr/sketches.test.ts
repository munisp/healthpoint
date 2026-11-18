/**
 * server/idr/sketches.test.ts — Phase 23 unit tests (pure, no DB).
 *
 *  - Exact SQL strings from the builders (single source of truth for the
 *    datasketches-postgresql function names — verified against
 *    apache/datasketches-postgresql master sql/).
 *  - Param safety: builders reject invalid quantile fractions and never
 *    accept org/user data (signatures take column expressions only).
 *  - Env-gate resolution matrix (auto/on/off × extension present/absent).
 *  - Volume-threshold gating (SKETCH_MIN_ROWS).
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_SKETCH_MIN_ROWS,
  SKETCH_EXTENSION_NAME,
  exactDistinctSql,
  exactQuantileSql,
  hllBuildSql,
  hllEstimateSql,
  hllUnionSql,
  kllBuildByteaSql,
  kllBuildSql,
  kllMergeSql,
  kllQuantileSql,
  resetSketchProbeCacheForTests,
  shouldUseSketches,
  sketchEligible,
  sketchGate,
  sketchMinRows,
} from "./sketches";

describe("sketch SQL builders (exact strings)", () => {
  it("KLL build/merge/quantile use the verified datasketches names", () => {
    expect(kllBuildSql("amt")).toBe("kll_double_sketch_build(amt)");
    expect(kllMergeSql("sketch::kll_double_sketch")).toBe(
      "kll_double_sketch_merge(sketch::kll_double_sketch)",
    );
    expect(kllQuantileSql("kll_double_sketch_merge(sketch::kll_double_sketch)", 0.5)).toBe(
      "kll_double_sketch_get_quantile(kll_double_sketch_merge(sketch::kll_double_sketch), 0.5)",
    );
    expect(kllQuantileSql("sketch::kll_double_sketch", 0.25)).toBe(
      "kll_double_sketch_get_quantile(sketch::kll_double_sketch, 0.25)",
    );
  });

  it("write-path build casts to bytea server-side (F1: postgres-js decodes bytea→Buffer, never base64 text)", () => {
    expect(kllBuildByteaSql("amt")).toBe("kll_double_sketch_build(amt)::bytea");
    expect(kllBuildByteaSql("v")).toContain("::bytea");
  });

  it("HLL build/union/estimate use the verified datasketches names", () => {
    expect(hllBuildSql('"patientRef"')).toBe('hll_sketch_build("patientRef")');
    expect(hllUnionSql("sketch::hll_sketch")).toBe("hll_sketch_union(sketch::hll_sketch)");
    expect(hllEstimateSql("hll_sketch_build(x)")).toBe(
      "hll_sketch_get_estimate(hll_sketch_build(x))",
    );
  });

  it("exact fallbacks mirror the same call sites", () => {
    expect(exactQuantileSql('"determinationAmount"::float', 0.75)).toBe(
      'percentile_cont(0.75) WITHIN GROUP (ORDER BY "determinationAmount"::float)',
    );
    expect(exactDistinctSql('"claimId"')).toBe('COUNT(DISTINCT "claimId")');
  });

  it("quantile fractions are validated (no arbitrary interpolation)", () => {
    for (const bad of [-0.1, 1.1, NaN, Infinity, -Infinity]) {
      expect(() => kllQuantileSql("s", bad)).toThrow(/quantile fraction/);
      expect(() => exactQuantileSql("v", bad)).toThrow(/quantile fraction/);
    }
    // NaN rejection doubles as injection defense: only finite [0,1] numbers
    // are ever rendered into the fragment.
    expect(() => kllQuantileSql("s", Number("0.5; DROP TABLE users"))).toThrow();
  });

  it("extension name constant is the pg_extension extname", () => {
    expect(SKETCH_EXTENSION_NAME).toBe("datasketches");
  });
});

describe("env gate resolution", () => {
  it("parses SKETCHES_ENABLED with auto default", () => {
    expect(sketchGate({})).toBe("auto");
    expect(sketchGate({ SKETCHES_ENABLED: "on" })).toBe("on");
    expect(sketchGate({ SKETCHES_ENABLED: "OFF" })).toBe("off");
    expect(sketchGate({ SKETCHES_ENABLED: " Auto " })).toBe("auto");
    expect(sketchGate({ SKETCHES_ENABLED: "garbage" })).toBe("auto");
  });

  it("parses SKETCH_MIN_ROWS with 10000 default and >=1 floor", () => {
    expect(sketchMinRows({})).toBe(DEFAULT_SKETCH_MIN_ROWS);
    expect(sketchMinRows({ SKETCH_MIN_ROWS: "500" })).toBe(500);
    expect(sketchMinRows({ SKETCH_MIN_ROWS: "0" })).toBe(DEFAULT_SKETCH_MIN_ROWS);
    expect(sketchMinRows({ SKETCH_MIN_ROWS: "-3" })).toBe(DEFAULT_SKETCH_MIN_ROWS);
    expect(sketchMinRows({ SKETCH_MIN_ROWS: "1.5" })).toBe(DEFAULT_SKETCH_MIN_ROWS);
    expect(sketchMinRows({ SKETCH_MIN_ROWS: "abc" })).toBe(DEFAULT_SKETCH_MIN_ROWS);
  });

  it("gate matrix: auto/on/off × extension present/absent", () => {
    // auto: use iff present
    expect(shouldUseSketches("auto", true)).toBe(true);
    expect(shouldUseSketches("auto", false)).toBe(false);
    // on: require, fail CLOSED to exact when absent
    expect(shouldUseSketches("on", true)).toBe(true);
    expect(shouldUseSketches("on", false)).toBe(false);
    // off: never
    expect(shouldUseSketches("off", true)).toBe(false);
    expect(shouldUseSketches("off", false)).toBe(false);
  });

  it("volume threshold gates sketch eligibility", () => {
    expect(sketchEligible(9999, 10000)).toBe(false);
    expect(sketchEligible(10000, 10000)).toBe(true);
    expect(sketchEligible(10001, 10000)).toBe(true);
    expect(sketchEligible(0, 1)).toBe(false);
    expect(sketchEligible(1, 1)).toBe(true);
  });
});

describe("read-path containment (F2): sketch query failure falls back to exact", () => {
  it("generateOutcomePredictionFromModel returns the exact-mode result when the sketch query throws", async () => {
    const { generateOutcomePredictionFromModel } = await import("./outcome-prediction-source");
    // Stub db (test-only; production code stays mock-free): the model_version
    // select returns an active model; execute call #1 (pg_extension probe)
    // "finds" the extension so the sketch path is ATTEMPTED; execute call #2
    // (the sketch read) throws — containment must turn that into the exact
    // fallback, never a 500.
    const activeRow = {
      id: "mv-stub", version: 7, modelName: "outcome-model-v2", status: "active",
      parameters: {
        generatedAt: new Date().toISOString(), platformFloor: 30, suppressionFloor: 5,
        tiers: {
          idr_entity_x_service_x_patientstate: [], idr_entity_x_service: [],
          service_x_patientstate: [], service: [],
          platform: { tier: "platform", key: {}, sampleSize: 40, wins: 20, awardP25Usd: 100, awardP50Usd: 150, awardP75Usd: 200, medianDeterminationUsd: 150 },
        },
      },
    };
    let executeCalls = 0;
    const stubDb = {
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([activeRow]) }) }) }),
      execute: () => {
        executeCalls += 1;
        if (executeCalls === 1) return Promise.resolve([{ found: 1 }]); // probe: extension present
        return Promise.reject(new Error("sketch read boom"));
      },
    };
    resetSketchProbeCacheForTests();
    try {
      const result = await generateOutcomePredictionFromModel(
        stubDb as never,
        { idrEntityId: "e1", serviceType: "svc", patientState: "TX" } as never,
      );
      expect(executeCalls).toBe(2); // sketch path was actually attempted
      expect(result).toBeTruthy();
      expect(result!.estimateProvenance).toBe("exact");
      expect(result!.prediction.awardP50Usd).toBe(150);
      expect(result!.prediction.segmentTierUsed).toBe("platform");
      expect(result!.keyFactors.join("\n")).not.toContain("KLL");
    } finally {
      resetSketchProbeCacheForTests();
    }
  });
});
