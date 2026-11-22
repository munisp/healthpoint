import { describe, expect, it } from "vitest";
import { getEffectiveIDRParameters } from "./params-2026";

const D = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("administrative fee tiers", () => {
  it("$15 for disputes initiated on/after 2026-06-11", () => {
    expect(getEffectiveIDRParameters(D("2026-06-11")).adminFeeUsd).toBe(15);
    expect(getEffectiveIDRParameters(D("2026-12-31")).adminFeeUsd).toBe(15);
  });

  it("$115 for disputes initiated 2024-01-22 through 2026-06-10", () => {
    expect(getEffectiveIDRParameters(D("2026-06-10")).adminFeeUsd).toBe(115);
    expect(getEffectiveIDRParameters(D("2024-01-22")).adminFeeUsd).toBe(115);
  });

  it("$50 before 2024-01-22", () => {
    expect(getEffectiveIDRParameters(D("2024-01-21")).adminFeeUsd).toBe(50);
    expect(getEffectiveIDRParameters(D("2023-01-01")).adminFeeUsd).toBe(50);
  });
});

describe("batch cap effective date", () => {
  it("25 before 2026-11-01, 50 on/after", () => {
    expect(getEffectiveIDRParameters(D("2026-10-31")).batchCap).toBe(25);
    expect(getEffectiveIDRParameters(D("2026-11-01")).batchCap).toBe(50);
    expect(getEffectiveIDRParameters(D("2027-06-01")).batchCap).toBe(50);
  });
});

describe("CARC/RARC requirements", () => {
  it("not required before 2027-01-01; required for items furnished on/after", () => {
    expect(getEffectiveIDRParameters(D("2026-12-31")).carcRarcRequired).toBe(false);
    expect(getEffectiveIDRParameters(D("2027-01-01")).carcRarcRequired).toBe(true);
  });
});

describe("IDR registry flag", () => {
  it("defaults to false even after the rule effective date", () => {
    expect(getEffectiveIDRParameters(D("2027-06-01"), {}).idrRegistryLive).toBe(false);
  });

  it("env override IDR_REGISTRY_LIVE=true enables it post-rule", () => {
    expect(getEffectiveIDRParameters(D("2027-06-01"), { IDR_REGISTRY_LIVE: "true" }).idrRegistryLive).toBe(true);
  });

  it("env override can never enable the registry before the rule effective date (fail closed)", () => {
    expect(getEffectiveIDRParameters(D("2026-08-02"), { IDR_REGISTRY_LIVE: "true" }).idrRegistryLive).toBe(false);
  });
});

describe("batched cooling-off parameter", () => {
  it("null before 2026-11-01, 30 business days on/after", () => {
    expect(getEffectiveIDRParameters(D("2026-10-31")).batchedCoolingOffBusinessDays).toBeNull();
    expect(getEffectiveIDRParameters(D("2026-11-01")).batchedCoolingOffBusinessDays).toBe(30);
  });
});

describe("QPA enforcement discretion", () => {
  it("applies to items/services furnished before 2026-10-01 only", () => {
    expect(getEffectiveIDRParameters(D("2026-09-30")).qpaEnforcementDiscretion).toBe(true);
    expect(getEffectiveIDRParameters(D("2026-10-01")).qpaEnforcementDiscretion).toBe(false);
  });
});

describe("fail-closed behavior", () => {
  it("throws on an unparseable date", () => {
    expect(() => getEffectiveIDRParameters(new Date("bogus"))).toThrow(/fail-closed/);
    expect(() => getEffectiveIDRParameters(undefined as never)).toThrow(/fail-closed/);
  });

  it("yields pre-amendment parameters before the rule effective date 2026-08-03", () => {
    const p = getEffectiveIDRParameters(D("2026-08-02"));
    expect(p.batchCap).toBe(25);
    expect(p.carcRarcRequired).toBe(false);
    expect(p.batchedCoolingOffBusinessDays).toBeNull();
    expect(p.idrRegistryLive).toBe(false);
    // ...but the $15 fee (own applicability date 2026-06-11) already applies.
    expect(p.adminFeeUsd).toBe(15);
  });

  it("exposes effective dates and citations", () => {
    const p = getEffectiveIDRParameters(D("2026-09-07"));
    expect(p.effectiveDates.ruleEffectiveDate).toBe("2026-08-03");
    expect(p.effectiveDates.batchCap50Effective).toBe("2026-11-01");
    expect(p.citations.join(" ")).toContain("91 FR 33900");
  });
});
