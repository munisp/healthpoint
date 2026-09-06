import { describe, expect, it } from "vitest";
import { computeCoolingOff } from "./cooling-off";

const D = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

describe("computeCoolingOff — SINGLE disputes (90 calendar days from determination)", () => {
  it("computes the 90-calendar-day end and next-business-day initiation", () => {
    const r = computeCoolingOff({ paymentDeterminationDate: D("2026-09-01"), disputeType: "SINGLE" });
    expect(iso(r.coolingOffEnd)).toBe("2026-11-30");
    expect(iso(r.earliestInitiationDate)).toBe("2026-12-01");
    expect(r.basis).toContain("90-calendar-day");
    expect(r.citations.join(" ")).toContain("149.510(c)(4)(vii)(B)");
  });

  it("skips weekends and the Christmas federal holiday for earliest initiation", () => {
    // 2026-09-26 + 90 calendar days = 2026-12-25 (Friday, Christmas Day, federal holiday).
    const r = computeCoolingOff({ paymentDeterminationDate: D("2026-09-26"), disputeType: "SINGLE" });
    expect(iso(r.coolingOffEnd)).toBe("2026-12-25");
    expect(iso(r.earliestInitiationDate)).toBe("2026-12-28"); // Monday after the holiday weekend
  });

  it("fails closed when the payment determination date is missing", () => {
    const r = computeCoolingOff({ disputeType: "SINGLE" });
    expect(r.coolingOffEnd).toBeNull();
    expect(r.earliestInitiationDate).toBeNull();
    expect(r.basis).toContain("Fail-closed");
  });

  it("fails closed on an invalid determination date", () => {
    const r = computeCoolingOff({ paymentDeterminationDate: new Date("not-a-date"), disputeType: "SINGLE" });
    expect(r.earliestInitiationDate).toBeNull();
  });
});

describe("computeCoolingOff — BATCHED disputes", () => {
  it("applies the CMS-9897-F 30-business-day cooling-off for ONPs on/after 2026-11-01", () => {
    const r = computeCoolingOff({
      paymentDeterminationDate: D("2026-11-02"),
      disputeType: "BATCHED",
      openNegotiationInitiatedOn: D("2026-11-02"),
    });
    expect(iso(r.coolingOffEnd)).toBe("2026-12-16"); // 30 BD, skipping Veterans Day + Thanksgiving
    expect(iso(r.earliestInitiationDate)).toBe("2026-12-17");
    expect(r.basis).toContain("30-business-day");
  });

  it("applies the legacy 90-calendar-day suspension for ONPs before 2026-11-01", () => {
    const r = computeCoolingOff({
      paymentDeterminationDate: D("2026-09-01"),
      disputeType: "BATCHED",
      openNegotiationInitiatedOn: D("2026-10-31"),
    });
    expect(iso(r.coolingOffEnd)).toBe("2026-11-30");
    expect(iso(r.earliestInitiationDate)).toBe("2026-12-01");
    expect(r.basis).toContain("legacy");
  });

  it("boundary: ONP on 2026-10-31 uses legacy regime; 2026-11-01 uses amended regime", () => {
    const legacy = computeCoolingOff({
      paymentDeterminationDate: D("2026-11-02"),
      disputeType: "BATCHED",
      openNegotiationInitiatedOn: D("2026-10-31"),
    });
    const amended = computeCoolingOff({
      paymentDeterminationDate: D("2026-11-02"),
      disputeType: "BATCHED",
      openNegotiationInitiatedOn: D("2026-11-01"),
    });
    expect(iso(legacy.coolingOffEnd)).toBe("2027-01-31"); // 11/2 + 90 cal days
    expect(iso(amended.coolingOffEnd)).toBe("2026-12-16");
  });

  it("spans the year-end holidays correctly (30 business days over Christmas/New Year)", () => {
    const r = computeCoolingOff({
      paymentDeterminationDate: D("2026-12-18"),
      disputeType: "BATCHED",
      openNegotiationInitiatedOn: D("2026-12-18"),
    });
    expect(iso(r.coolingOffEnd)).toBe("2027-02-01");
    expect(iso(r.earliestInitiationDate)).toBe("2027-02-02");
  });

  it("fails closed when the ONP start date is missing (regime ambiguous)", () => {
    const r = computeCoolingOff({
      paymentDeterminationDate: D("2026-11-02"),
      disputeType: "BATCHED",
    });
    expect(r.coolingOffEnd).toBeNull();
    expect(r.earliestInitiationDate).toBeNull();
    expect(r.basis).toContain("Fail-closed");
  });
});

describe("fail-closed guardrails", () => {
  it("returns null dates for an unknown dispute type", () => {
    const r = computeCoolingOff({
      paymentDeterminationDate: D("2026-09-01"),
      disputeType: "WEIRD" as never,
    });
    expect(r.earliestInitiationDate).toBeNull();
    expect(r.basis).toContain("unknown disputeType");
  });

  it("honors env-driven extra closures in business-day math", () => {
    // Closure on 2026-12-17 does not move the 30th business day (2026-12-16),
    // but pushes earliest initiation from 12/17 to 12/18.
    const env = { IDR_BUSINESS_DAY_EXTRA_CLOSURES: "2026-12-17" };
    const r = computeCoolingOff({
      paymentDeterminationDate: D("2026-11-02"),
      disputeType: "BATCHED",
      openNegotiationInitiatedOn: D("2026-11-02"),
      env,
    });
    expect(iso(r.coolingOffEnd)).toBe("2026-12-16");
    expect(iso(r.earliestInitiationDate)).toBe("2026-12-18");
  });
});
