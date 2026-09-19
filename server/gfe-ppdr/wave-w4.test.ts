/**
 * Wave W4 vitest — GFE: co-provider/co-facility estimates (F5), updated-GFE
 * rule (F5), recurring-GFE 12-month day-level fix (F6), language validation.
 */
import { describe, it, expect } from "vitest";
import {
  computeGfeTotalExpectedCharges,
  validateCoProviderEstimates,
  validateGfeContent,
  validateRecurringGfeWindow,
  validateUpdatedGfeRule,
  addCalendarMonthsUtc,
  REQUIRED_GFE_ELEMENTS,
} from "./gfe-clock";
import { composeGfeDocument, NOTICE_DICTIONARY } from "../../shared/i18n/notices";

/* ── F5: co-provider estimates + aggregation ─────────────────────────────── */

describe("F5 co-provider estimates", () => {
  it("aggregation rule: total = convening + Σ co-providers", () => {
    const total = computeGfeTotalExpectedCharges(1000, [
      { name: "Anesthesia Group", npi: "1234567890", expectedChargesUsd: 400 },
      { name: "Imaging Center", expectedChargesUsd: 250.5 },
    ]);
    expect(total).toBe(1650.5);
  });

  it("empty co-provider list totals the convening charges only", () => {
    expect(computeGfeTotalExpectedCharges(750, [])).toBe(750);
    expect(computeGfeTotalExpectedCharges(750)).toBe(750);
  });

  it("rejects invalid co-provider entries (fail closed)", () => {
    expect(() =>
      computeGfeTotalExpectedCharges(100, [{ name: "", expectedChargesUsd: 10 }]),
    ).toThrow(/name is required/);
    expect(() =>
      computeGfeTotalExpectedCharges(100, [{ name: "X", npi: "123", expectedChargesUsd: 10 }]),
    ).toThrow(/10 digits/);
    expect(() =>
      computeGfeTotalExpectedCharges(100, [{ name: "X", expectedChargesUsd: -1 }]),
    ).toThrow(/>= 0/);
    expect(
      validateCoProviderEstimates([{ name: "X", npi: "1234567890", expectedChargesUsd: 5 }]),
    ).toEqual([]);
  });

  it("validateContent requires the co-provider disclaimer when co-providers supplied", () => {
    const without = REQUIRED_GFE_ELEMENTS.filter((e) => e !== "COPROVIDER_DISCLAIMER");
    const r = validateGfeContent(without, {
      coProviders: [{ name: "Anesthesia Group", expectedChargesUsd: 400 }],
    });
    expect(r.complete).toBe(false);
    expect(r.missing).toContain("COPROVIDER_DISCLAIMER");
    const ok = validateGfeContent(REQUIRED_GFE_ELEMENTS, {
      coProviders: [{ name: "Anesthesia Group", expectedChargesUsd: 400 }],
    });
    expect(ok.complete).toBe(true);
  });

  it("validateContent reports per-entry co-provider errors", () => {
    const r = validateGfeContent(REQUIRED_GFE_ELEMENTS, {
      coProviders: [{ name: "", expectedChargesUsd: 400 }],
    });
    expect(r.complete).toBe(false);
    expect(r.coProviderErrors[0]).toMatch(/name is required/);
  });

  it("validateContent honors language (es complete; unsupported fails closed)", () => {
    expect(validateGfeContent(REQUIRED_GFE_ELEMENTS, { language: "es" }).complete).toBe(true);
    const fr = validateGfeContent(REQUIRED_GFE_ELEMENTS, { language: "fr" });
    expect(fr.complete).toBe(false);
    expect(fr.missing).toEqual([...REQUIRED_GFE_ELEMENTS]);
  });

  it("composeGfeDocument computes the total via the aggregation rule (never caller-supplied)", () => {
    const doc = composeGfeDocument({
      providerName: "General Hospital",
      caseId: "GFE-1",
      conveningChargesUsd: 1000,
      coProviders: [{ name: "Anesthesia Group", npi: "1234567890", expectedChargesUsd: 400 }],
      language: "es",
    });
    expect(doc).toContain("$1400.00");
    expect(doc).toContain(NOTICE_DICTIONARY.es.gfe.coProviderAggregationRule);
    expect(doc).toContain("Anesthesia Group");
  });
});

/* ── F5: updated-GFE rule ────────────────────────────────────────────────── */

describe("F5 updated-GFE rule", () => {
  // Service Monday 2026-03-09 → deadline end of Friday 2026-03-06.
  const serviceAt = new Date("2026-03-09T15:00:00Z");

  it("no change → not required, compliant", () => {
    const r = validateUpdatedGfeRule({ expectedChargesChanged: false, serviceAt });
    expect(r.compliant).toBe(true);
    expect(r.required).toBe(false);
  });

  it("changed + delivered >1 business day before service → compliant", () => {
    const r = validateUpdatedGfeRule({
      expectedChargesChanged: true,
      updatedGfeDeliveredAt: new Date("2026-03-05T12:00:00Z"), // Thursday
      serviceAt,
    });
    expect(r.compliant).toBe(true);
    expect(r.required).toBe(true);
    expect(r.deadline?.toISOString()).toBe("2026-03-06T23:59:59.999Z");
  });

  it("changed + delivered ON the deadline day → compliant", () => {
    const r = validateUpdatedGfeRule({
      expectedChargesChanged: true,
      updatedGfeDeliveredAt: new Date("2026-03-06T18:00:00Z"), // Friday
      serviceAt,
    });
    expect(r.compliant).toBe(true);
  });

  it("changed + delivered same day as service → violation", () => {
    const r = validateUpdatedGfeRule({
      expectedChargesChanged: true,
      updatedGfeDeliveredAt: new Date("2026-03-09T10:00:00Z"),
      serviceAt,
    });
    expect(r.compliant).toBe(false);
    expect(r.violations[0]).toMatch(/1 business day/);
  });

  it("changed + no delivery timestamp → fail closed non-compliant", () => {
    const r = validateUpdatedGfeRule({ expectedChargesChanged: true, serviceAt });
    expect(r.compliant).toBe(false);
    expect(r.violations[0]).toMatch(/no delivery timestamp/);
  });
});

/* ── F6: recurring-GFE 12-month window (day-level) ───────────────────────── */

describe("F6 recurring GFE window (45 CFR 149.610(a)(2)(iii))", () => {
  it("12 calendar months exactly is valid", () => {
    const r = validateRecurringGfeWindow(
      new Date("2026-01-01T00:00:00Z"),
      new Date("2027-01-01T00:00:00Z"),
    );
    expect(r.valid).toBe(true);
    expect(r.days).toBe(365);
  });

  it("2026-01-01 → 2027-01-30 is INVALID (12 months 29 days)", () => {
    const r = validateRecurringGfeWindow(
      new Date("2026-01-01T00:00:00Z"),
      new Date("2027-01-30T00:00:00Z"),
    );
    expect(r.valid).toBe(false);
  });

  it("2026-01-01 → 2027-01-02 is invalid by one day", () => {
    expect(
      validateRecurringGfeWindow(new Date("2026-01-01T00:00:00Z"), new Date("2027-01-02T00:00:00Z")).valid,
    ).toBe(false);
  });

  it("leap-year span (2024-01-01 → 2025-01-01, 366 days) is valid — calendar months, not day count", () => {
    const r = validateRecurringGfeWindow(
      new Date("2024-01-01T00:00:00Z"),
      new Date("2025-01-01T00:00:00Z"),
    );
    expect(r.days).toBe(366);
    expect(r.valid).toBe(true);
  });

  it("month-end clamping: 2026-01-31 + 12 months → 2027-01-31 (valid); 2027-02-01 invalid", () => {
    expect(
      validateRecurringGfeWindow(new Date("2026-01-31T00:00:00Z"), new Date("2027-01-31T00:00:00Z")).valid,
    ).toBe(true);
    expect(
      validateRecurringGfeWindow(new Date("2026-01-31T00:00:00Z"), new Date("2027-02-01T00:00:00Z")).valid,
    ).toBe(false);
  });

  it("addCalendarMonthsUtc clamps to short month (Jan 31 2026 + 1 → Feb 28 2026)", () => {
    expect(addCalendarMonthsUtc(new Date("2026-01-31T12:00:00Z"), 1).toISOString()).toBe(
      "2026-02-28T12:00:00.000Z",
    );
  });

  it("rejects invalid inputs", () => {
    expect(() =>
      validateRecurringGfeWindow(new Date("2026-02-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z")),
    ).toThrow(/on\/after/);
    expect(() => validateRecurringGfeWindow(new Date(NaN), new Date())).toThrow(/firstServiceAt/);
  });
});
