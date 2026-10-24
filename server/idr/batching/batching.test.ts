import { describe, expect, it } from "vitest";
import {
  applicableBatchCap,
  evaluateBatchEligibility,
  type LineItemInput,
} from "./batching";

const D = (iso: string) => new Date(`${iso}T00:00:00Z`);

function item(overrides: Partial<LineItemInput> = {}): LineItemInput {
  return {
    lineItemId: overrides.lineItemId ?? "L1",
    serviceCode: "99285",
    providerNpi: "1234567890",
    payerId: "PAYER-A",
    qualifiedIdrItem: true,
    dateOfService: D("2026-09-08"), // Tuesday
    ...overrides,
  };
}

function batch(n: number, overrides: Partial<LineItemInput> = {}): LineItemInput[] {
  // All on the same date of service so criterion (D) is satisfied by default.
  return Array.from({ length: n }, (_, i) =>
    item({ lineItemId: `L${i + 1}`, ...overrides })
  );
}

describe("evaluateBatchEligibility — happy path", () => {
  it("eligible when all four criteria and cap are satisfied (pre-2026-11-01)", () => {
    const r = evaluateBatchEligibility(batch(3), { openNegotiationNoticeDate: D("2026-09-15") });
    expect(r.eligible).toBe(true);
    expect(r.failures).toEqual([]);
    expect(r.capApplied).toBe(25);
    expect(r.appliedCriteria.length).toBeGreaterThanOrEqual(5);
    expect(r.citations.join(" ")).toContain("149.510(c)(4)(i)");
  });

  it("accepts providerTin as the common provider identifier", () => {
    const items = batch(2).map(i => ({ ...i, providerNpi: undefined, providerTin: "TIN-9" }));
    const r = evaluateBatchEligibility(items, { openNegotiationNoticeDate: D("2026-09-15") });
    expect(r.eligible).toBe(true);
  });
});

describe("criterion (A) — same provider/facility/group", () => {
  it("fails when NPIs differ", () => {
    const items = [item({ lineItemId: "A" }), item({ lineItemId: "B", providerNpi: "9999999999" })];
    const r = evaluateBatchEligibility(items, { openNegotiationNoticeDate: D("2026-09-15") });
    expect(r.eligible).toBe(false);
    expect(r.failures.some(f => f.includes("Criterion (A)"))).toBe(true);
  });

  it("fails closed when a provider identifier is missing", () => {
    const items = [item({ lineItemId: "A" }), item({ lineItemId: "B", providerNpi: undefined })];
    const r = evaluateBatchEligibility(items, { openNegotiationNoticeDate: D("2026-09-15") });
    expect(r.eligible).toBe(false);
    expect(r.failures.some(f => f.includes("fail-closed") && f.includes("NPI"))).toBe(true);
  });
});

describe("criterion (B) — same payer", () => {
  it("fails when payerIds differ", () => {
    const items = [item({ lineItemId: "A" }), item({ lineItemId: "B", payerId: "PAYER-B" })];
    const r = evaluateBatchEligibility(items, { openNegotiationNoticeDate: D("2026-09-15") });
    expect(r.eligible).toBe(false);
    expect(r.failures.some(f => f.includes("Criterion (B)"))).toBe(true);
  });

  it("fails closed on missing payerId", () => {
    const items = [item({ lineItemId: "A" }), item({ lineItemId: "B", payerId: "" })];
    const r = evaluateBatchEligibility(items, { openNegotiationNoticeDate: D("2026-09-15") });
    expect(r.eligible).toBe(false);
    expect(r.failures.some(f => f.includes("Criterion (B) fail-closed"))).toBe(true);
  });
});

describe("criterion (C) — same or similar service code", () => {
  it("fails when service codes differ", () => {
    const items = [item({ lineItemId: "A" }), item({ lineItemId: "B", serviceCode: "99284" })];
    const r = evaluateBatchEligibility(items, { openNegotiationNoticeDate: D("2026-09-15") });
    expect(r.eligible).toBe(false);
    expect(r.failures.some(f => f.includes("Criterion (C)"))).toBe(true);
  });

  it("matches service codes case-insensitively", () => {
    const items = [item({ lineItemId: "A", serviceCode: "a0428" }), item({ lineItemId: "B", serviceCode: "A0428" })];
    const r = evaluateBatchEligibility(items, { openNegotiationNoticeDate: D("2026-09-15") });
    expect(r.eligible).toBe(true);
  });
});

describe("criterion (D) — same 30-business-day period", () => {
  it("passes when dates of service are within 30 business days", () => {
    const items = [
      item({ lineItemId: "A", dateOfService: D("2026-09-01") }),
      item({ lineItemId: "B", dateOfService: D("2026-09-30") }),
    ];
    const r = evaluateBatchEligibility(items, { openNegotiationNoticeDate: D("2026-10-01") });
    expect(r.eligible).toBe(true);
  });

  it("fails when dates of service span more than 30 business days", () => {
    const items = [
      item({ lineItemId: "A", dateOfService: D("2026-09-01") }),
      item({ lineItemId: "B", dateOfService: D("2026-11-30") }),
    ];
    const r = evaluateBatchEligibility(items, { openNegotiationNoticeDate: D("2026-12-01") });
    expect(r.eligible).toBe(false);
    expect(r.failures.some(f => f.includes("Criterion (D)"))).toBe(true);
  });

  it("fails closed when a date of service is missing", () => {
    const items = [item({ lineItemId: "A" }), item({ lineItemId: "B", dateOfService: undefined })];
    const r = evaluateBatchEligibility(items, { openNegotiationNoticeDate: D("2026-09-15") });
    expect(r.eligible).toBe(false);
    expect(r.failures.some(f => f.includes("Criterion (D) fail-closed"))).toBe(true);
  });
});

describe("line-item caps (effective-dated)", () => {
  it("25-item cap applies to ONPs beginning before 2026-11-01 (26 items → ineligible)", () => {
    const r = evaluateBatchEligibility(batch(26), { openNegotiationNoticeDate: D("2026-10-30") });
    expect(r.eligible).toBe(false);
    expect(r.capApplied).toBe(25);
    expect(r.failures.some(f => f.includes("25-line-item cap"))).toBe(true);
  });

  it("25 items exactly at the legacy cap remain eligible", () => {
    const r = evaluateBatchEligibility(batch(25), { openNegotiationNoticeDate: D("2026-10-30") });
    expect(r.capApplied).toBe(25);
    expect(r.failures.some(f => f.includes("cap"))).toBe(false);
  });

  it("50-item cap applies on the boundary date 2026-11-01 (26 items → eligible on cap)", () => {
    const r = evaluateBatchEligibility(batch(26), { openNegotiationNoticeDate: D("2026-11-01") });
    expect(r.capApplied).toBe(50);
    expect(r.failures.some(f => f.includes("cap"))).toBe(false);
  });

  it("51 items exceed even the amended 50-item cap post-2026-11-01", () => {
    const r = evaluateBatchEligibility(batch(51), { openNegotiationNoticeDate: D("2026-11-02") });
    expect(r.eligible).toBe(false);
    expect(r.failures.some(f => f.includes("50-line-item cap"))).toBe(true);
  });

  it("fails closed to the 25-item cap when no ONP start date is supplied", () => {
    const r = evaluateBatchEligibility(batch(26));
    expect(r.eligible).toBe(false);
    expect(r.capApplied).toBe(25);
  });

  it("env override IDR_BATCH_CAP may tighten but never loosen the statutory cap", () => {
    const tight = evaluateBatchEligibility(batch(5), {
      openNegotiationNoticeDate: D("2026-11-02"),
      env: { IDR_BATCH_CAP: "4" },
    });
    expect(tight.capApplied).toBe(4);
    expect(tight.failures.some(f => f.includes("cap"))).toBe(true);

    const loose = applicableBatchCap(D("2026-11-02"), { IDR_BATCH_CAP: "99" });
    expect(loose.cap).toBe(50); // invalid loosening ignored
  });
});

describe("misc fail-closed behavior", () => {
  it("rejects an empty batch", () => {
    const r = evaluateBatchEligibility([], { openNegotiationNoticeDate: D("2026-09-15") });
    expect(r.eligible).toBe(false);
  });

  it("rejects non-qualified items", () => {
    const items = [item({ lineItemId: "A" }), item({ lineItemId: "B", qualifiedIdrItem: false })];
    const r = evaluateBatchEligibility(items, { openNegotiationNoticeDate: D("2026-09-15") });
    expect(r.eligible).toBe(false);
    expect(r.failures.some(f => f.includes("Non-qualified"))).toBe(true);
  });

  it("flags a single-item batch (use a single dispute)", () => {
    const r = evaluateBatchEligibility(batch(1), { openNegotiationNoticeDate: D("2026-09-15") });
    expect(r.eligible).toBe(false);
    expect(r.failures.some(f => f.includes("fewer than 2"))).toBe(true);
  });
});
