import { describe, expect, it } from "vitest";
import {
  buildAdminFeeAssessments,
  buildEnvFeeSchedule,
  buildIdreFeeAssessment,
  canTransitionFeeStatus,
  feeIdempotencyKey,
  getFeeEnvConfig,
  selectActiveSchedule,
  type FeeScheduleLike,
} from "./fees";

const sched = (over: Partial<FeeScheduleLike> = {}): FeeScheduleLike => {
  const base: FeeScheduleLike = {
    id: "sched-1",
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    effectiveTo: null,
    adminFeeCents: 11500, // EXAMPLE value in tests only — real amounts are configured
    idreFeeSingleMinCents: 20000,
    idreFeeSingleMaxCents: 84000,
    idreFeeBatchedMinCents: 26800,
    idreFeeBatchedMaxCents: 113800,
    currency: "USD",
  };
  // Spread (not ??) so intentional null overrides are honored.
  return { ...base, ...over };
};

describe("fee environment configuration", () => {
  it("returns nulls when no fee env is configured (never invents amounts)", () => {
    const cfg = getFeeEnvConfig({} as NodeJS.ProcessEnv);
    expect(cfg.adminFeeCents).toBeNull();
    expect(cfg.idreFeeSingleMinCents).toBeNull();
    expect(buildEnvFeeSchedule({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("builds a schedule seed only when the admin fee is configured", () => {
    const seed = buildEnvFeeSchedule({
      IDR_ADMIN_FEE_CENTS: "11500",
      IDR_IDRE_FEE_SINGLE_MIN_CENTS: "20000",
      IDR_IDRE_FEE_SINGLE_MAX_CENTS: "84000",
      IDR_FEE_SCHEDULE_EFFECTIVE_FROM: "2026-01-01",
    } as NodeJS.ProcessEnv);
    expect(seed).not.toBeNull();
    expect(seed!.adminFeeCents).toBe(11500);
    expect(seed!.currency).toBe("USD");
    expect(seed!.source).toContain("env:");
    expect(seed!.notes).toContain("45 CFR § 149.510(d)");
  });

  it("rejects non-integer or negative amounts", () => {
    expect(() => getFeeEnvConfig({ IDR_ADMIN_FEE_CENTS: "11.5" } as NodeJS.ProcessEnv)).toThrow();
    expect(() => getFeeEnvConfig({ IDR_ADMIN_FEE_CENTS: "-100" } as NodeJS.ProcessEnv)).toThrow();
    expect(() => getFeeEnvConfig({ IDR_FEE_SCHEDULE_EFFECTIVE_FROM: "Jan 2026" } as NodeJS.ProcessEnv)).toThrow();
  });
});

describe("effective-dated schedule selection", () => {
  const s2025 = sched({ id: "s2025", effectiveFrom: new Date("2025-01-01T00:00:00Z"), effectiveTo: new Date("2026-01-01T00:00:00Z"), adminFeeCents: 11500 });
  const s2026 = sched({ id: "s2026", effectiveFrom: new Date("2026-01-01T00:00:00Z"), adminFeeCents: 11600 });

  it("selects the schedule in effect at a given instant", () => {
    expect(selectActiveSchedule([s2025, s2026], new Date("2025-06-15T00:00:00Z"))!.id).toBe("s2025");
    expect(selectActiveSchedule([s2025, s2026], new Date("2026-06-15T00:00:00Z"))!.id).toBe("s2026");
  });

  it("honors effectiveFrom boundaries exactly", () => {
    expect(selectActiveSchedule([s2025, s2026], new Date("2025-12-31T23:59:59Z"))!.id).toBe("s2025");
    expect(selectActiveSchedule([s2025, s2026], new Date("2026-01-01T00:00:00Z"))!.id).toBe("s2026");
  });

  it("returns null when no schedule covers the instant", () => {
    expect(selectActiveSchedule([s2026], new Date("2024-06-01T00:00:00Z"))).toBeNull();
    expect(selectActiveSchedule([], new Date())).toBeNull();
  });
});

describe("administrative fee assessment (idempotent, per party)", () => {
  const parties = { initiatingPartyId: "prov-1", respondingPartyId: "payer-1" };

  it("assesses the admin fee once per party with deterministic idempotency keys", () => {
    const r1 = buildAdminFeeAssessments("disp-1", sched(), parties);
    const r2 = buildAdminFeeAssessments("disp-1", sched(), parties);
    expect(r1.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.lines).toHaveLength(2);
    expect(r1.lines.map(l => l.partyRole).sort()).toEqual(["initiating_party", "responding_party"]);
    expect(r1.lines.every(l => l.amountCents === 11500)).toBe(true);
    // Idempotency: identical keys across retries
    expect(r1.lines.map(l => l.idempotencyKey)).toEqual(r2.lines.map(l => l.idempotencyKey));
    expect(new Set(r1.lines.map(l => l.idempotencyKey)).size).toBe(2);
  });

  it("keys differ per dispute so separate disputes are assessed independently", () => {
    const a = buildAdminFeeAssessments("disp-1", sched(), parties);
    const b = buildAdminFeeAssessments("disp-2", sched(), parties);
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(a.lines[0].idempotencyKey).not.toBe(b.lines[0].idempotencyKey);
  });

  it("fails closed when no active schedule exists", () => {
    const r = buildAdminFeeAssessments("disp-1", null, parties);
    expect(r).toEqual({ ok: false, reason: "missing_schedule" });
  });

  it("fails when a party identity is missing", () => {
    const r = buildAdminFeeAssessments("disp-1", sched(), { initiatingPartyId: "prov-1", respondingPartyId: null });
    expect(r).toEqual({ ok: false, reason: "invalid_party" });
  });
});

describe("certified IDRE fee assessment", () => {
  it("validates the assessed amount against the allowable range", () => {
    const inRange = buildIdreFeeAssessment("disp-1", sched(), { batched: false, amountCents: 50000, nonPrevailingPartyRole: "responding_party" });
    expect(inRange.ok && inRange.withinRange).toBe(true);
    const outOfRange = buildIdreFeeAssessment("disp-1", sched(), { batched: false, amountCents: 90000, nonPrevailingPartyRole: "responding_party" });
    expect(outOfRange.ok && outOfRange.withinRange).toBe(false);
  });

  it("uses the batched range for batched disputes", () => {
    const r = buildIdreFeeAssessment("disp-1", sched(), { batched: true, amountCents: 25000, nonPrevailingPartyRole: "initiating_party" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines[0].feeType).toBe("idre_batched");
    expect(r.withinRange).toBe(false); // 25000 < batched min 26800
  });

  it("fails when the schedule lacks an IDRE fee range", () => {
    const noRange = sched({ idreFeeSingleMinCents: null, idreFeeSingleMaxCents: null });
    expect(buildIdreFeeAssessment("disp-1", noRange, { batched: false, amountCents: 50000, nonPrevailingPartyRole: "responding_party" }))
      .toEqual({ ok: false, reason: "missing_idre_fee_range" });
  });
});

describe("fee payment status transitions", () => {
  it("follows the allowed lifecycle including refund-after-paid for IDRE fees", () => {
    expect(canTransitionFeeStatus("assessed", "invoiced")).toBe(true);
    expect(canTransitionFeeStatus("invoiced", "paid")).toBe(true);
    expect(canTransitionFeeStatus("assessed", "paid")).toBe(true);
    expect(canTransitionFeeStatus("paid", "refunded", "idre_single")).toBe(true); // § 149.510(d)(2)(iv) ineligibility refund
    expect(canTransitionFeeStatus("assessed", "waived")).toBe(true);
  });

  it("never refunds the non-refundable administrative fee (§ 149.510(d)(1))", () => {
    expect(canTransitionFeeStatus("paid", "refunded", "administrative")).toBe(false);
    expect(canTransitionFeeStatus("paid", "refunded", "idre_batched")).toBe(true);
  });

  it("rejects backwards and terminal transitions", () => {
    expect(canTransitionFeeStatus("paid", "assessed")).toBe(false);
    expect(canTransitionFeeStatus("paid", "invoiced")).toBe(false);
    expect(canTransitionFeeStatus("refunded", "paid")).toBe(false);
    expect(canTransitionFeeStatus("void", "assessed")).toBe(false);
    expect(canTransitionFeeStatus("waived", "paid")).toBe(false);
  });
});

describe("feeIdempotencyKey", () => {
  it("is stable and collision-free across dimensions", () => {
    expect(feeIdempotencyKey("d1", "administrative", "initiating_party")).toBe("fee:d1:administrative:initiating_party");
    const keys = new Set([
      feeIdempotencyKey("d1", "administrative", "initiating_party"),
      feeIdempotencyKey("d1", "administrative", "responding_party"),
      feeIdempotencyKey("d1", "idre_single", "responding_party"),
      feeIdempotencyKey("d2", "administrative", "initiating_party"),
    ]);
    expect(keys.size).toBe(4);
  });
});
