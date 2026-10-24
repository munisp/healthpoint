/**
 * Phase 22 (S2+S3) unit tests — ranking pure functions.
 *
 *  - smoothedActRate is Beta(1,1)-smoothed; blendConfidence is bounded.
 *  - reorderWithinSeverity: eligible items reorder ONLY within their severity
 *    group; ineligible items keep exact static positions; zero eligible →
 *    byte-identical to the input (P21 static order).
 */
import { describe, it, expect } from "vitest";
import {
  smoothedActRate,
  blendConfidence,
  rankingEligible,
  reorderWithinSeverity,
} from "./ranking";

interface Card { id: string; severity: string }
const cards = (spec: Array<[string, string]>): Card[] => spec.map(([id, severity]) => ({ id, severity }));

describe("smoothedActRate / blendConfidence / rankingEligible", () => {
  it("Beta(1,1) smoothing", () => {
    expect(smoothedActRate(0, 0)).toBe(0.5);
    expect(smoothedActRate(9, 1)).toBeCloseTo(10 / 12);
    expect(smoothedActRate(0, 10)).toBeCloseTo(1 / 12);
  });
  it("blendConfidence moves at most halfway and never to 0/1", () => {
    expect(blendConfidence(0.8, 1)).toBe(0.9);
    expect(blendConfidence(0.8, 0)).toBe(0.4);
    expect(blendConfidence(0.99, 1)).toBeLessThanOrEqual(0.99);
    expect(blendConfidence(0.02, 0)).toBeGreaterThanOrEqual(0.01);
  });
  it("impressions floor", () => {
    expect(rankingEligible(10, 10)).toBe(true);
    expect(rankingEligible(9, 10)).toBe(false);
  });
});

describe("reorderWithinSeverity", () => {
  it("reorders eligible items within a severity group by score desc", () => {
    const items = cards([["a", "info"], ["b", "info"], ["c", "info"]]);
    const scores: Record<string, number | null> = { a: 0.2, b: 0.9, c: 0.5 };
    const { items: out, learnedItems } = reorderWithinSeverity(items, c => c.severity, c => scores[c.id]);
    expect(out.map(c => c.id)).toEqual(["b", "c", "a"]);
    expect(learnedItems).toBe(3);
  });

  it("never crosses severity groups", () => {
    const items = cards([["crit", "critical"], ["i1", "info"], ["i2", "info"]]);
    const scores: Record<string, number | null> = { crit: 0.01, i1: 0.5, i2: 0.9 };
    const { items: out } = reorderWithinSeverity(items, c => c.severity, c => scores[c.id]);
    // i2 outranks i1 within info; the critical card keeps its position even
    // with a terrible score.
    expect(out.map(c => c.id)).toEqual(["crit", "i2", "i1"]);
  });

  it("ineligible items keep their EXACT static positions", () => {
    const items = cards([["x", "info"], ["y", "info"], ["z", "info"], ["w", "info"]]);
    // y ineligible; x, z, w eligible with x best.
    const scores: Record<string, number | null> = { x: 0.9, y: null, z: 0.3, w: 0.1 };
    const { items: out, learnedItems } = reorderWithinSeverity(items, c => c.severity, c => scores[c.id]);
    expect(out.map(c => c.id)).toEqual(["x", "y", "z", "w"]);
    expect(out[1].id).toBe("y"); // untouched
    expect(learnedItems).toBe(3);
  });

  it("zero eligible → byte-identical order (cold start = P21 static order)", () => {
    const items = cards([["a", "critical"], ["b", "warning"], ["c", "info"]]);
    const { items: out, learnedItems } = reorderWithinSeverity(items, c => c.severity, () => null);
    expect(out).toEqual(items);
    expect(learnedItems).toBe(0);
  });

  it("ties keep static order", () => {
    const items = cards([["a", "info"], ["b", "info"]]);
    const { items: out } = reorderWithinSeverity(items, c => c.severity, () => 0.5);
    expect(out.map(c => c.id)).toEqual(["a", "b"]);
  });
});
