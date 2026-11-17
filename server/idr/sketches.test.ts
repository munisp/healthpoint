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
  kllBuildSql,
  kllMergeSql,
  kllQuantileSql,
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
