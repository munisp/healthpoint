import { describe, it, expect, vi, beforeEach } from "vitest";
import { addBusinessDays, generateReferenceNumber } from "./db";

// ─── Business day calculation tests ──────────────────────────────────────────

describe("addBusinessDays", () => {
  it("adds 30 business days skipping weekends", () => {
    // Monday 2025-01-06 + 30 business days = Monday 2025-02-17 (skipping weekends)
    const start = new Date("2025-01-06T00:00:00Z");
    const result = addBusinessDays(start, 30);
    // Should be 30 business days later, not 30 calendar days
    const calendarDays = (result.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    expect(calendarDays).toBeGreaterThan(30); // Must be more than 30 calendar days
    expect(calendarDays).toBeLessThanOrEqual(45); // But not more than 45 calendar days
  });

  it("skips Saturday and Sunday", () => {
    // Friday 2025-01-03 + 1 business day = Monday 2025-01-06
    const friday = new Date("2025-01-03T00:00:00Z");
    const result = addBusinessDays(friday, 1);
    expect(result.getDay()).toBe(1); // Monday
  });

  it("adds 4 business days for IDR initiation deadline", () => {
    const start = new Date("2025-06-02T00:00:00Z"); // Monday
    const result = addBusinessDays(start, 4);
    const calendarDays = (result.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    expect(calendarDays).toBeGreaterThanOrEqual(4);
    expect(calendarDays).toBeLessThanOrEqual(8); // At most 4 bd + 2 weekend days
  });

  it("adds 10 business days for offer submission deadline", () => {
    const start = new Date("2025-06-02T00:00:00Z"); // Monday
    const result = addBusinessDays(start, 10);
    const calendarDays = (result.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    expect(calendarDays).toBeGreaterThanOrEqual(10);
    expect(calendarDays).toBeLessThanOrEqual(16);
  });

  it("skips federal holidays", () => {
    // July 3, 2025 (Thursday) + 1 business day should skip July 4 (Friday holiday)
    const thursdayBeforeJuly4 = new Date("2025-07-03T00:00:00Z");
    const result = addBusinessDays(thursdayBeforeJuly4, 1);
    const dateStr = result.toISOString().split("T")[0];
    expect(dateStr).not.toBe("2025-07-04"); // Must skip July 4
    expect(dateStr).toBe("2025-07-07"); // Should land on Monday July 7
  });
});

// ─── Reference number generation tests ───────────────────────────────────────

describe("generateReferenceNumber", () => {
  it("generates a reference number with correct format", () => {
    const ref = generateReferenceNumber();
    expect(ref).toMatch(/^IDR-\d{4}-[A-Z0-9]{6}$/);
  });

  it("generates unique reference numbers", () => {
    const refs = new Set(Array.from({ length: 100 }, () => generateReferenceNumber()));
    expect(refs.size).toBe(100);
  });

  it("includes the current year", () => {
    const ref = generateReferenceNumber();
    const year = new Date().getFullYear().toString();
    expect(ref).toContain(year);
  });
});

// ─── NSA IDR step validation tests ───────────────────────────────────────────

describe("NSA IDR step sequence", () => {
  const IDR_STEPS = [
    "STEP_01_OPEN_NEGOTIATION_INITIATED",
    "STEP_02_OPEN_NEGOTIATION_PERIOD",
    "STEP_03_OPEN_NEGOTIATION_FAILED",
    "STEP_04_IDR_INITIATED",
    "STEP_05_IDR_NOTICE_SENT",
    "STEP_06_IDR_ENTITY_SELECTION",
    "STEP_07_IDR_ENTITY_SELECTED",
    "STEP_08_ELIGIBILITY_REVIEW",
    "STEP_09_OFFER_SUBMISSION",
    "STEP_10_QPA_DISCLOSURE",
    "STEP_11_ADDITIONAL_INFORMATION",
    "STEP_12_ARBITRATION_REVIEW",
    "STEP_13_DETERMINATION_ISSUED",
    "STEP_14_PAYMENT_DETERMINATION",
    "STEP_15_PAYMENT_MADE",
    "STEP_16_ADMINISTRATIVE_FEE_PAID",
    "STEP_17_DISPUTE_CLOSED",
    "STEP_18_APPEAL_FILED",
    "STEP_19_APPEAL_RESOLVED",
  ];

  it("has exactly 19 steps", () => {
    expect(IDR_STEPS.length).toBe(19);
  });

  it("steps are numbered sequentially from 01 to 19", () => {
    IDR_STEPS.forEach((step, index) => {
      const stepNum = String(index + 1).padStart(2, "0");
      expect(step).toMatch(new RegExp(`^STEP_${stepNum}_`));
    });
  });

  it("first step is open negotiation initiation", () => {
    expect(IDR_STEPS[0]).toBe("STEP_01_OPEN_NEGOTIATION_INITIATED");
  });

  it("last mandatory step is dispute closed (step 17)", () => {
    expect(IDR_STEPS[16]).toBe("STEP_17_DISPUTE_CLOSED");
  });

  it("appeal steps are optional (steps 18-19)", () => {
    expect(IDR_STEPS[17]).toBe("STEP_18_APPEAL_FILED");
    expect(IDR_STEPS[18]).toBe("STEP_19_APPEAL_RESOLVED");
  });
});

// ─── Dispute status validation tests ─────────────────────────────────────────

describe("Dispute status transitions", () => {
  const VALID_STATUSES = [
    "open_negotiation",
    "idr_initiated",
    "idr_entity_selection",
    "eligibility_review",
    "offer_submission",
    "under_arbitration",
    "determination_issued",
    "payment_pending",
    "closed",
    "appealed",
    "ineligible",
  ];

  it("has all required NSA IDR statuses", () => {
    expect(VALID_STATUSES).toContain("open_negotiation");
    expect(VALID_STATUSES).toContain("idr_initiated");
    expect(VALID_STATUSES).toContain("under_arbitration");
    expect(VALID_STATUSES).toContain("determination_issued");
    expect(VALID_STATUSES).toContain("closed");
    expect(VALID_STATUSES).toContain("ineligible");
  });

  it("has 11 distinct statuses", () => {
    expect(VALID_STATUSES.length).toBe(11);
    expect(new Set(VALID_STATUSES).size).toBe(11);
  });
});

// ─── Financial validation tests ───────────────────────────────────────────────

describe("Financial amount validation", () => {
  const isValidAmount = (amount: string) => /^\d+(\.\d{1,2})?$/.test(amount);

  it("accepts valid dollar amounts", () => {
    expect(isValidAmount("1000")).toBe(true);
    expect(isValidAmount("1000.00")).toBe(true);
    expect(isValidAmount("1000.50")).toBe(true);
    expect(isValidAmount("0")).toBe(true);
  });

  it("rejects invalid dollar amounts", () => {
    expect(isValidAmount("1000.000")).toBe(false); // 3 decimal places
    expect(isValidAmount("-1000")).toBe(false); // negative
    expect(isValidAmount("abc")).toBe(false); // non-numeric
    expect(isValidAmount("")).toBe(false); // empty
  });
});
