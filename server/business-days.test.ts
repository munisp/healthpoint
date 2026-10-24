/**
 * server/business-days.test.ts
 *
 * Verifies that all business-day arithmetic is unified on the canonical,
 * algorithmic implementation in server/idr/deadlines.ts:
 *   - db.ts re-exports the canonical addBusinessDays (no hardcoded holiday
 *     table that silently expires after its last entry).
 *   - US federal holidays are computed per 5 U.S.C. § 6103 for ANY year,
 *     including the federal weekend-observation shifts.
 *   - Statutory step deadlines use the correct business-day counts
 *     (STEP_06 joint IDRE selection is 3 business days per
 *     45 CFR § 149.510(c)(1), not 4).
 */

import { describe, it, expect, vi } from "vitest";

// ── Stub the heavy infrastructure deps of server/db.ts (pure-logic test) ────
vi.mock("drizzle-orm", () => ({
  eq: vi.fn(), desc: vi.fn(), and: vi.fn(), or: vi.fn(), like: vi.fn(),
  count: vi.fn(), sql: vi.fn(), inArray: vi.fn(),
}));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: vi.fn() }));
vi.mock("postgres", () => ({ default: vi.fn() }));
vi.mock("../drizzle/schema", () => ({
  users: {}, disputes: {}, disputeEvents: {}, disputeOffers: {},
  disputeDocuments: {}, idrEntities: {}, notifications: {},
  disputeDrafts: {}, cmsDrafts: {}, disputeTemplates: {}, userProfiles: {},
  marketingLeads: {}, auditLog: {}, webhooks: {}, outcomePredictions: {},
  documentAnalyses: {}, emrConnections: {}, emrSyncLogs: {},
  IDR_STEP: [], DISPUTE_STATUS: [],
}));
vi.mock("./_core/env", () => ({ ENV: { isProduction: false } }));
vi.mock("./permify-write", () => ({
  mirrorDisputeCreation: vi.fn(async () => undefined),
  mirrorOrgMembership: vi.fn(async () => undefined),
}));

import {
  addBusinessDays as canonicalAddBusinessDays,
  usFederalHolidays,
  isBusinessDay,
  businessDaysBetween,
  STATUTORY_DEADLINE_DEFAULTS,
} from "./idr/deadlines";
import { addBusinessDays as dbAddBusinessDays } from "./db";

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("usFederalHolidays — algorithmic per 5 U.S.C. § 6103", () => {
  it("computes fixed-date and floating holidays for 2026", () => {
    const h = usFederalHolidays(2026);
    expect(h.has("2026-01-01")).toBe(true);  // New Year's Day (Thu)
    expect(h.has("2026-01-19")).toBe(true);  // MLK Day — 3rd Mon Jan
    expect(h.has("2026-02-16")).toBe(true);  // Washington's Birthday
    expect(h.has("2026-05-25")).toBe(true);  // Memorial Day — last Mon May
    expect(h.has("2026-06-19")).toBe(true);  // Juneteenth (Fri)
    expect(h.has("2026-07-03")).toBe(true);  // Jul 4 falls Sat 2026 → observed Fri Jul 3
    expect(h.has("2026-09-07")).toBe(true);  // Labor Day — 1st Mon Sep
    expect(h.has("2026-10-12")).toBe(true);  // Columbus Day — 2nd Mon Oct
    expect(h.has("2026-11-11")).toBe(true);  // Veterans Day
    expect(h.has("2026-11-26")).toBe(true);  // Thanksgiving — 4th Thu Nov
    expect(h.has("2026-12-25")).toBe(true);  // Christmas (Fri)
  });

  it("works for years far beyond any hardcoded table (e.g. 2031)", () => {
    const h = usFederalHolidays(2031);
    expect(h.has("2031-01-01")).toBe(true);  // New Year's Day (Wed)
    expect(h.has("2031-01-20")).toBe(true);  // MLK Day — 3rd Mon Jan 2031
    expect(h.has("2031-05-26")).toBe(true);  // Memorial Day — last Mon May 2031
    expect(h.has("2031-07-04")).toBe(true);  // Independence Day (Fri)
    expect(h.has("2031-09-01")).toBe(true);  // Labor Day — 1st Mon Sep 2031
    expect(h.has("2031-11-27")).toBe(true);  // Thanksgiving — 4th Thu Nov 2031
    expect(h.has("2031-12-25")).toBe(true);  // Christmas (Thu)
    expect(h.has("2031-12-31")).toBe(false); // Jan 1 2032 is Thu → no Dec 31 observance
  });

  it("shifts Sunday holidays to the following Monday", () => {
    // Juneteenth 2027 falls on Saturday → observed Friday 2027-06-18
    expect(usFederalHolidays(2027).has("2027-06-18")).toBe(true);
    // Christmas 2022 fell on Sunday → observed Monday 2022-12-26
    expect(usFederalHolidays(2022).has("2022-12-26")).toBe(true);
  });

  it("observes a Saturday New Year's Day on Dec 31 of the prior year", () => {
    // Jan 1 2022 was a Saturday → observed Friday 2021-12-31
    expect(usFederalHolidays(2021).has("2021-12-31")).toBe(true);
    // And 2022 itself does NOT double-count Jan 1
    expect(usFederalHolidays(2022).has("2022-01-01")).toBe(false);
  });
});

describe("addBusinessDays (canonical)", () => {
  it("skips weekends", () => {
    // Friday 2026-09-04 + 1 BD = Monday 2026-09-07 is Labor Day → Tue 2026-09-08
    const start = new Date("2026-09-04T12:00:00Z");
    expect(iso(canonicalAddBusinessDays(start, 1))).toBe("2026-09-08");
  });

  it("skips federal holidays mid-week", () => {
    // Wed 2026-11-25 + 1 BD: Thu 11-26 is Thanksgiving → Fri 2026-11-27
    expect(iso(canonicalAddBusinessDays(new Date("2026-11-25T00:00:00Z"), 1))).toBe("2026-11-27");
  });

  it("preserves time-of-day and crosses year boundaries", () => {
    // Thu 2026-12-31 15:30Z + 1 BD: Fri 2027-01-01 is New Year's → Mon 2027-01-04
    const r = canonicalAddBusinessDays(new Date("2026-12-31T15:30:00Z"), 1);
    expect(iso(r)).toBe("2027-01-04");
    expect(r.toISOString().slice(11, 19)).toBe("15:30:00");
  });

  it("counts 30 business days correctly across holidays (open negotiation)", () => {
    // From Mon 2026-11-02, 30 BD crosses Veterans Day (11-11) and
    // Thanksgiving (11-26) → ends 2026-12-16
    const r = canonicalAddBusinessDays(new Date("2026-11-02T00:00:00Z"), 30);
    expect(iso(r)).toBe("2026-12-16");
    expect(businessDaysBetween(new Date("2026-11-02T00:00:00Z"), r)).toBe(30);
  });

  it("rejects negative or non-integer n", () => {
    expect(() => canonicalAddBusinessDays(new Date(), -1)).toThrow();
    expect(() => canonicalAddBusinessDays(new Date(), 1.5)).toThrow();
  });
});

describe("db.ts unification — no local hardcoded holiday table", () => {
  it("re-exports the canonical addBusinessDays (identical results)", () => {
    const start = new Date("2027-06-30T09:00:00Z");
    // Jul 4 2027 is a Sunday → observed Mon Jul 5; canonical handles it,
    // the old hardcoded table (ending 2026-09-07) could not.
    expect(iso(dbAddBusinessDays(start, 3))).toBe(iso(canonicalAddBusinessDays(start, 3)));
    expect(iso(dbAddBusinessDays(start, 3))).toBe("2027-07-06");
  });

  it("db.addBusinessDays honors algorithmic holidays for any future year", () => {
    // Start Fri 2031-08-29; Mon 2031-09-01 is Labor Day → +1 BD = Tue 2031-09-02
    expect(iso(dbAddBusinessDays(new Date("2031-08-29T00:00:00Z"), 1))).toBe("2031-09-02");
  });
});

describe("statutory business-day counts", () => {
  it("STEP_06 joint IDRE selection is 3 business days (45 CFR § 149.510(c)(1))", () => {
    expect(STATUTORY_DEADLINE_DEFAULTS.idreSelectionBusinessDays).toBe(3);
  });

  it("STEP_04 IDR initiation window is 4 business days (45 CFR § 149.510(b)(2)(i))", () => {
    expect(STATUTORY_DEADLINE_DEFAULTS.idrInitiationWindowBusinessDays).toBe(4);
  });

  it("isBusinessDay agrees with addBusinessDays skipping behavior", () => {
    expect(isBusinessDay(new Date("2026-09-07T00:00:00Z"))).toBe(false); // Labor Day
    expect(isBusinessDay(new Date("2026-09-08T00:00:00Z"))).toBe(true);  // Tuesday
    expect(isBusinessDay(new Date("2026-09-05T00:00:00Z"))).toBe(false); // Saturday
  });
});
