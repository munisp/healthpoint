/**
 * Phase 16: CMS-9897-F batching regime tests — effective-date switch
 * (25→50 cap on ONPs beginning 2026-11-01) and the three relatedness
 * criteria, incl. injected-clock control.
 */
import { describe, expect, it } from "vitest";
import {
  evaluateBatchEligibility,
  applicableBatchCap,
  batchingRegime,
  cptRelatednessRangeName,
  relatednessSatisfiedBy,
  type LineItemInput,
} from "./batching";

const base = (over: Partial<LineItemInput>): LineItemInput => ({
  lineItemId: over.lineItemId ?? "x",
  serviceCode: over.serviceCode ?? "99285",
  providerNpi: "1234567893",
  payerId: "AETNA",
  qualifiedIdrItem: true,
  dateOfService: new Date("2026-11-02"),
  ...over,
});

describe("effective-date cap switch", () => {
  it("25 before 2026-11-01, 50 on/after", () => {
    expect(applicableBatchCap(new Date("2026-10-31"), {}).cap).toBe(25);
    expect(applicableBatchCap(new Date("2026-11-01"), {}).cap).toBe(50);
    expect(applicableBatchCap(undefined, {}).cap).toBe(25); // fail closed
  });

  it("rejects a 30-line batch pre-effective-date but allows it after", () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      base({ lineItemId: `li${i}`, dateOfService: new Date(Date.UTC(2026, 10, 2 + (i % 5))) })
    );
    const pre = evaluateBatchEligibility(items, { openNegotiationNoticeDate: new Date("2026-10-15") });
    expect(pre.eligible).toBe(false);
    expect(pre.capApplied).toBe(25);
    const post = evaluateBatchEligibility(
      items.map(i => ({ ...i })),
      { openNegotiationNoticeDate: new Date("2026-11-15") }
    );
    expect(post.eligible).toBe(true);
    expect(post.capApplied).toBe(50);
  });

  it("supports injected clock fallback only when explicitly opted in", () => {
    const closed = batchingRegime(undefined, {});
    expect(closed.amended).toBe(false);
    const injected = batchingRegime(undefined, { useNowFallback: true, now: new Date("2026-12-01") });
    expect(injected.amended).toBe(true);
    const injectedPre = batchingRegime(undefined, { useNowFallback: true, now: new Date("2026-06-01") });
    expect(injectedPre.amended).toBe(false);
  });
});

describe("CMS-9897-F relatedness criteria", () => {
  it("(1) same patient encounter satisfies relatedness", () => {
    const items = [
      base({ lineItemId: "a", serviceCode: "99285", patientEncounterId: "enc-1", claimFormId: "cf-1" }),
      base({ lineItemId: "b", serviceCode: "70010", patientEncounterId: "enc-1", claimFormId: "cf-1" }),
    ];
    expect(relatednessSatisfiedBy(items).some(s => s.startsWith("(1)"))).toBe(true);
    const res = evaluateBatchEligibility(items, { openNegotiationNoticeDate: new Date("2026-11-15") });
    expect(res.eligible).toBe(true);
  });

  it("(3) same Category I CPT range (anesthesia) satisfies relatedness", () => {
    expect(cptRelatednessRangeName("01996")).toBe("anesthesiology");
    expect(cptRelatednessRangeName("01402")).toBe("anesthesiology");
    expect(cptRelatednessRangeName("99285")).toBeNull();
    const items = [
      base({ lineItemId: "a", serviceCode: "01996" }),
      base({ lineItemId: "b", serviceCode: "01402" }),
    ];
    expect(relatednessSatisfiedBy(items).some(s => s.startsWith("(3)"))).toBe(true);
    const res = evaluateBatchEligibility(items, { openNegotiationNoticeDate: new Date("2026-11-15") });
    expect(res.eligible).toBe(true);
  });

  it("unrelated codes (no encounter, different ranges) fail post-amendment", () => {
    const items = [
      base({ lineItemId: "a", serviceCode: "99285" }),
      base({ lineItemId: "b", serviceCode: "01402" }),
    ];
    const res = evaluateBatchEligibility(items, { openNegotiationNoticeDate: new Date("2026-11-15") });
    expect(res.eligible).toBe(false);
    expect(res.failures.some(f => f.includes("Relatedness failed"))).toBe(true);
  });

  it("pre-effective-date regime keeps the legacy identical-code rule", () => {
    const items = [
      base({ lineItemId: "a", serviceCode: "01996", patientEncounterId: "enc-1", claimFormId: "cf-1" }),
      base({ lineItemId: "b", serviceCode: "01402", patientEncounterId: "enc-1", claimFormId: "cf-1" }),
    ];
    const res = evaluateBatchEligibility(items, { openNegotiationNoticeDate: new Date("2026-10-15") });
    expect(res.eligible).toBe(false);
    expect(res.failures.some(f => f.includes("Criterion (C) failed"))).toBe(true);
  });
});
