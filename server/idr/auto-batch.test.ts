/**
 * Unit tests for the Phase 18 auto-batcher (pure module — no DB).
 * EXECUTED-VERIFIED: vitest.
 */
import { describe, it, expect } from "vitest";
import { proposeBatches, IDRE_FEE_RANGE_SINGLE_USD, IDRE_FEE_RANGE_BATCHED_USD } from "./auto-batch";
import type { AutoBatchCandidate } from "./auto-batch";

const ADMIN_FEE = 350;

function cand(id: string, over: Partial<AutoBatchCandidate> = {}): AutoBatchCandidate {
  return {
    lineItemId: id,
    serviceCode: "99285",
    providerNpi: "1234567893",
    payerId: "AETNA",
    qualifiedIdrItem: true,
    dateOfService: new Date("2026-09-10"),
    ...over,
  };
}

describe("proposeBatches", () => {
  it("groups same-payer/same-provider/same-code items into one batch with rationale + economics", () => {
    const res = proposeBatches([cand("a"), cand("b", { dateOfService: new Date("2026-09-11") }), cand("c", { dateOfService: new Date("2026-09-12") })], {
      openNegotiationNoticeDate: new Date("2026-09-20"),
      adminFeeUsd: ADMIN_FEE,
    });
    expect(res.batches).toHaveLength(1);
    const b = res.batches[0];
    expect(b.items).toHaveLength(3);
    expect(b.capApplied).toBe(25); // ONP before 2026-11-01
    expect(b.rationale.join(" ")).toMatch(/AETNA/);
    // Economics: (3-1)×$350 admin savings.
    expect(b.economics.adminFeeSavingsUsd).toBe(700);
    expect(b.economics.label).toBe("projection_not_guarantee");
    expect(b.economics.batchedIdreFeeRangeUsd).toEqual(IDRE_FEE_RANGE_BATCHED_USD);
    expect(b.economics.singleFilingsIdreFeeRangeUsd.min).toBe(3 * IDRE_FEE_RANGE_SINGLE_USD.min);
    expect(b.economics.totalProjectedSavingsRangeUsd.max).toBeGreaterThanOrEqual(b.economics.adminFeeSavingsUsd);
  });

  it("splits by payer and provider into separate batches", () => {
    const res = proposeBatches(
      [cand("a"), cand("b"), cand("c", { payerId: "CIGNA" }), cand("d", { payerId: "CIGNA" }), cand("e", { providerNpi: "1987654321" }), cand("f", { providerNpi: "1987654321" })],
      { openNegotiationNoticeDate: new Date("2026-09-20"), adminFeeUsd: ADMIN_FEE }
    );
    expect(res.batches).toHaveLength(3);
    expect(res.batches.every(b => b.items.length === 2)).toBe(true);
  });

  it("enforces the cap by splitting oversized groupings (25 pre-2026-11-01, 50 after)", () => {
    const many = Array.from({ length: 30 }, (_, i) => cand(`x${i}`, { dateOfService: new Date("2026-09-10") }));
    const legacy = proposeBatches(many, { openNegotiationNoticeDate: new Date("2026-09-20"), adminFeeUsd: ADMIN_FEE });
    expect(legacy.batches.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...legacy.batches.map(b => b.items.length))).toBeLessThanOrEqual(25);

    const many50 = Array.from({ length: 55 }, (_, i) => cand(`y${i}`, { dateOfService: new Date("2026-11-10") }));
    const amended = proposeBatches(many50, { openNegotiationNoticeDate: new Date("2026-11-15"), adminFeeUsd: ADMIN_FEE });
    expect(Math.max(...amended.batches.map(b => b.items.length))).toBe(50);
    expect(amended.batches[0].capApplied).toBe(50);
  });

  it("fails closed: missing identifiers and non-qualified items go to unbatched with reasons", () => {
    const res = proposeBatches(
      [cand("ok1"), cand("ok2"), cand("noDos", { dateOfService: undefined }), cand("noPayer", { payerId: "" }), cand("notQ", { qualifiedIdrItem: false })],
      { openNegotiationNoticeDate: new Date("2026-09-20"), adminFeeUsd: ADMIN_FEE }
    );
    expect(res.batches).toHaveLength(1);
    expect(res.unbatched.map(u => u.item.lineItemId).sort()).toEqual(["noDos", "noPayer", "notQ"]);
    expect(res.unbatched.every(u => u.reason.length > 0)).toBe(true);
  });

  it("legacy regime: differing service codes split batches (relatedness unchanged pre-2026-11-01)", () => {
    const res = proposeBatches(
      [cand("a", { serviceCode: "99285" }), cand("b", { serviceCode: "99284" })],
      { openNegotiationNoticeDate: new Date("2026-09-20"), adminFeeUsd: ADMIN_FEE }
    );
    expect(res.batches).toHaveLength(0);
    expect(res.unbatched).toHaveLength(2); // each a singleton after split
  });

  it("amended regime: Category I CPT range relatedness batches anesthesia codes", () => {
    const res = proposeBatches(
      [cand("a", { serviceCode: "01996", dateOfService: new Date("2026-11-02") }), cand("b", { serviceCode: "01402", dateOfService: new Date("2026-11-03") })],
      { openNegotiationNoticeDate: new Date("2026-11-15"), adminFeeUsd: ADMIN_FEE }
    );
    expect(res.batches).toHaveLength(1);
    expect(res.batches[0].rationale.join(" ")).toMatch(/Category I CPT range/);
  });
});
