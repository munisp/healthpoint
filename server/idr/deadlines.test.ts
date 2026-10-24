import { describe, expect, it } from "vitest";
import {
  addBusinessDays,
  addCalendarDays,
  businessDaysBetween,
  computeIDRDeadlines,
  deadlineAlertTier,
  getDeadlinePolicy,
  isBusinessDay,
  usFederalHolidays,
  STATUTORY_DEADLINE_DEFAULTS,
  type IDRDeadlinePolicy,
} from "./deadlines";

const d = (iso: string) => new Date(iso + "T00:00:00Z");
const iso = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

const POLICY: IDRDeadlinePolicy = {
  ...STATUTORY_DEADLINE_DEFAULTS,
  extraClosures: new Set<string>(),
  useFederalHolidays: true,
};

describe("US federal holiday table", () => {
  it("computes 2026 floating holidays correctly", () => {
    const h = usFederalHolidays(2026);
    expect(h.has("2026-01-01")).toBe(true); // New Year's Day (Thu)
    expect(h.has("2026-01-19")).toBe(true); // MLK — 3rd Mon Jan
    expect(h.has("2026-02-16")).toBe(true); // Washington's Birthday — 3rd Mon Feb
    expect(h.has("2026-05-25")).toBe(true); // Memorial Day — last Mon May
    expect(h.has("2026-06-19")).toBe(true); // Juneteenth (Fri)
    expect(h.has("2026-07-03")).toBe(true); // Independence Day observed (Jul 4 is Sat)
    expect(h.has("2026-09-07")).toBe(true); // Labor Day — 1st Mon Sep
    expect(h.has("2026-10-12")).toBe(true); // Columbus Day — 2nd Mon Oct
    expect(h.has("2026-11-11")).toBe(true); // Veterans Day (Wed)
    expect(h.has("2026-11-26")).toBe(true); // Thanksgiving — 4th Thu Nov
    expect(h.has("2026-12-25")).toBe(true); // Christmas (Fri)
  });

  it("observes a Saturday holiday on the preceding Friday", () => {
    // Christmas 2021 fell on a Saturday → observed Friday 2021-12-24
    expect(usFederalHolidays(2021).has("2021-12-24")).toBe(true);
    expect(usFederalHolidays(2021).has("2021-12-25")).toBe(false);
  });

  it("observes a Sunday holiday on the following Monday", () => {
    // New Year's Day 2023 fell on a Sunday → observed Monday 2023-01-02
    expect(usFederalHolidays(2023).has("2023-01-02")).toBe(true);
  });

  it("observes a Saturday New Year's Day on Dec 31 of the prior year", () => {
    // Jan 1, 2022 was a Saturday → observed Friday 2021-12-31
    expect(usFederalHolidays(2021).has("2021-12-31")).toBe(true);
  });
});

describe("isBusinessDay", () => {
  it("treats weekends as non-business days", () => {
    expect(isBusinessDay(d("2026-09-05"), POLICY)).toBe(false); // Saturday
    expect(isBusinessDay(d("2026-09-06"), POLICY)).toBe(false); // Sunday
    expect(isBusinessDay(d("2026-09-08"), POLICY)).toBe(true); // Tuesday
  });

  it("treats federal holidays as non-business days", () => {
    expect(isBusinessDay(d("2026-11-26"), POLICY)).toBe(false); // Thanksgiving (Thu)
    expect(isBusinessDay(d("2026-11-27"), POLICY)).toBe(true); // day after is a business day
  });
});

describe("addBusinessDays", () => {
  it("skips weekends", () => {
    // Friday 2026-09-04 + 1 BD → Monday 2026-09-07 is Labor Day → 09-08
    expect(iso(addBusinessDays(d("2026-09-03"), 1, POLICY))).toBe("2026-09-04");
    expect(iso(addBusinessDays(d("2026-09-04"), 1, POLICY))).toBe("2026-09-08");
  });

  it("skips a midweek federal holiday", () => {
    // Wed 2026-11-25 + 1 BD skips Thanksgiving Thu 11-26 → Fri 11-27
    expect(iso(addBusinessDays(d("2026-11-25"), 1, POLICY))).toBe("2026-11-27");
  });

  it("handles the zero-day boundary (returns the input date)", () => {
    expect(iso(addBusinessDays(d("2026-09-08"), 0, POLICY))).toBe("2026-09-08");
  });

  it("counts 30 business days across a holiday-heavy stretch", () => {
    // Anchor: Mon 2025-11-17. Holidays in window: Thanksgiving 11-27, Christmas 12-25.
    // BD count: Nov 18,19,20,21 (4), 24,25,26,28 (8), Dec 1-5 (13), 8-12 (18),
    // 15-19 (23), 22,23,24,26 (27), 29,30,31 (30) → Wed 2025-12-31.
    expect(iso(addBusinessDays(d("2025-11-17"), 30, POLICY))).toBe("2025-12-31");
  });

  it("rejects negative or fractional day counts", () => {
    expect(() => addBusinessDays(d("2026-09-08"), -1, POLICY)).toThrow();
    expect(() => addBusinessDays(d("2026-09-08"), 1.5, POLICY)).toThrow();
  });
});

describe("businessDaysBetween", () => {
  it("counts business days exclusive of start, inclusive of end", () => {
    // Mon 2026-09-07 (Labor Day) → Fri 2026-09-11: Tue,Wed,Thu,Fri = 4
    expect(businessDaysBetween(d("2026-09-07"), d("2026-09-11"), POLICY)).toBe(4);
  });

  it("returns 0 for the same calendar day", () => {
    expect(businessDaysBetween(d("2026-09-08"), d("2026-09-08"), POLICY)).toBe(0);
  });

  it("returns a negative count when the target precedes the start", () => {
    expect(businessDaysBetween(d("2026-09-11"), d("2026-09-08"), POLICY)).toBe(-3);
  });
});

describe("computeIDRDeadlines (45 CFR § 149.510)", () => {
  it("computes the 30-BD open negotiation end from the initiation notice", () => {
    // ON notice Mon 2025-11-17 → 30 BD later = Wed 2025-12-31 (verified above)
    const r = computeIDRDeadlines({ openNegotiationInitiatedAt: d("2025-11-17"), idrInitiatedAt: null, idreSelectedAt: null }, POLICY);
    expect(iso(r.openNegotiationEnd)).toBe("2025-12-31");
  });

  it("computes the 4-BD IDR initiation window from the ON period end", () => {
    // ON end Wed 2025-12-31 → window opens Thu 2026-01-01? No — Jan 1 is a holiday,
    // so window opens Fri 2026-01-02; 4 BD: 01-02, 01-05, 01-06, 01-07 → Wed 2026-01-07.
    const r = computeIDRDeadlines({ openNegotiationInitiatedAt: d("2025-11-17"), idrInitiatedAt: null, idreSelectedAt: null }, POLICY);
    expect(iso(r.idrInitiationWindowStart)).toBe("2026-01-02");
    expect(iso(r.idrInitiationDeadline)).toBe("2026-01-07");
  });

  it("computes the 3-BD IDRE selection deadline from IDR initiation", () => {
    // IDR initiated Mon 2026-02-16? That's Washington's Birthday — pick Tue 2026-02-17.
    // 3 BD: 18, 19, 20 → Fri 2026-02-20.
    const r = computeIDRDeadlines({ openNegotiationInitiatedAt: null, idrInitiatedAt: d("2026-02-17"), idreSelectedAt: null }, POLICY);
    expect(iso(r.idreSelectionDeadline)).toBe("2026-02-20");
  });

  it("computes the 30-BD determination deadline from IDRE selection", () => {
    // IDRE selected Mon 2026-03-02; no federal holidays until May 25.
    // 30 BD = 6 weeks exactly → Mon 2026-04-13.
    const r = computeIDRDeadlines({ openNegotiationInitiatedAt: null, idrInitiatedAt: null, idreSelectedAt: d("2026-03-02") }, POLICY);
    expect(iso(r.determinationDeadline)).toBe("2026-04-13");
    expect(iso(r.offerSubmissionDeadline)).toBe("2026-03-16"); // 10 BD = 2 weeks
  });

  it("computes the 30-CALENDAR-day payment deadline from determination", () => {
    const r = computeIDRDeadlines({
      openNegotiationInitiatedAt: null,
      idrInitiatedAt: null,
      idreSelectedAt: null,
      determinationIssuedAt: d("2026-04-13"),
    }, POLICY);
    expect(iso(r.paymentDeadline)).toBe("2026-05-13");
  });

  it("returns nulls for deadlines whose anchors have not occurred", () => {
    const r = computeIDRDeadlines({ openNegotiationInitiatedAt: null, idrInitiatedAt: null, idreSelectedAt: null }, POLICY);
    expect(r.openNegotiationEnd).toBeNull();
    expect(r.idrInitiationDeadline).toBeNull();
    expect(r.idreSelectionDeadline).toBeNull();
    expect(r.determinationDeadline).toBeNull();
    expect(r.paymentDeadline).toBeNull();
  });

  it("honors a policy override (rulemaking-change readiness)", () => {
    const custom: IDRDeadlinePolicy = { ...POLICY, idreSelectionBusinessDays: 5 };
    const r = computeIDRDeadlines({ openNegotiationInitiatedAt: null, idrInitiatedAt: d("2026-02-17"), idreSelectedAt: null }, custom);
    // 5 BD from Tue 2026-02-17: 18,19,20,23,24 → Tue 2026-02-24
    expect(iso(r.idreSelectionDeadline)).toBe("2026-02-24");
  });

  it("honors extra configured closure days", () => {
    const custom: IDRDeadlinePolicy = { ...POLICY, extraClosures: new Set(["2026-09-09"]) };
    // Tue 2026-09-08 + 1 BD skips the configured Wed closure → Thu 2026-09-10
    expect(iso(addBusinessDays(d("2026-09-08"), 1, custom))).toBe("2026-09-10");
  });
});

describe("deadlineAlertTier (T-5 / T-1 / overdue)", () => {
  // Deadline: Fri 2026-09-18 (a business day).
  const deadline = d("2026-09-18");

  it("returns null when more than 5 business days remain", () => {
    // Mon 2026-09-07 is a holiday; from Fri 09-04: BD remaining = 09-08..09-18 = 9
    expect(deadlineAlertTier(deadline, d("2026-09-04"), POLICY)).toBeNull();
  });

  it("returns t_minus_5 exactly 5 business days out", () => {
    // Fri 2026-09-11 → remaining BD: 14,15,16,17,18 = 5
    expect(deadlineAlertTier(deadline, d("2026-09-11"), POLICY)).toBe("t_minus_5");
  });

  it("returns t_minus_1 on the business day before the deadline", () => {
    expect(deadlineAlertTier(deadline, d("2026-09-17"), POLICY)).toBe("t_minus_1");
  });

  it("returns t_minus_1 on the deadline day itself", () => {
    expect(deadlineAlertTier(deadline, d("2026-09-18"), POLICY)).toBe("t_minus_1");
  });

  it("returns overdue once the deadline date has passed", () => {
    expect(deadlineAlertTier(deadline, d("2026-09-19"), POLICY)).toBe("overdue");
    expect(deadlineAlertTier(deadline, d("2026-12-31"), POLICY)).toBe("overdue");
  });

  it("escalates through tiers over a weekend boundary", () => {
    // Deadline Mon 2026-09-21; on Fri 09-18 remaining BD = 21 → 1 → t_minus_1
    expect(deadlineAlertTier(d("2026-09-21"), d("2026-09-18"), POLICY)).toBe("t_minus_1");
    // On Sat 09-19 (weekend), still 1 BD remaining → t_minus_1, not overdue
    expect(deadlineAlertTier(d("2026-09-21"), d("2026-09-19"), POLICY)).toBe("t_minus_1");
  });
});

describe("getDeadlinePolicy (env-driven configuration)", () => {
  it("uses statutory CFR defaults when no env is set", () => {
    const p = getDeadlinePolicy({} as NodeJS.ProcessEnv);
    expect(p.openNegotiationBusinessDays).toBe(30);
    expect(p.idrInitiationWindowBusinessDays).toBe(4);
    expect(p.idreSelectionBusinessDays).toBe(3);
    expect(p.offerSubmissionBusinessDays).toBe(10);
    expect(p.determinationBusinessDays).toBe(30);
    expect(p.paymentCalendarDays).toBe(30);
    expect(p.useFederalHolidays).toBe(true);
  });

  it("reads overrides and rejects invalid values", () => {
    const p = getDeadlinePolicy({ IDR_DETERMINATION_BUSINESS_DAYS: "45" } as NodeJS.ProcessEnv);
    expect(p.determinationBusinessDays).toBe(45);
    expect(() => getDeadlinePolicy({ IDR_DETERMINATION_BUSINESS_DAYS: "zero" } as NodeJS.ProcessEnv)).toThrow();
    expect(() => getDeadlinePolicy({ IDR_DETERMINATION_BUSINESS_DAYS: "-3" } as NodeJS.ProcessEnv)).toThrow();
  });

  it("parses extra closures and the holiday toggle", () => {
    const p = getDeadlinePolicy({
      IDR_BUSINESS_DAY_EXTRA_CLOSURES: "2026-12-24, 2026-12-31,not-a-date",
      IDR_USE_FEDERAL_HOLIDAYS: "false",
    } as NodeJS.ProcessEnv);
    expect(p.useFederalHolidays).toBe(false);
    expect(p.extraClosures.has("2026-12-24")).toBe(true);
    expect(p.extraClosures.has("not-a-date")).toBe(false);
    // With holidays disabled, Christmas 2026 (Fri) is a business day
    expect(isBusinessDay(d("2026-12-25"), p)).toBe(true);
  });
});

describe("addCalendarDays", () => {
  it("adds calendar days ignoring weekends and holidays", () => {
    expect(iso(addCalendarDays(d("2026-11-25"), 4))).toBe("2026-11-29");
    expect(() => addCalendarDays(d("2026-11-25"), -1)).toThrow();
  });
});
