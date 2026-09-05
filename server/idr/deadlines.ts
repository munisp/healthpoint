/**
 * server/idr/deadlines.ts
 * Statutory deadline engine for the Federal No Surprises Act IDR process.
 *
 * Pure functions only — no I/O, no database, no clock access except where an
 * explicit `now` is injected. All arithmetic is performed on UTC calendar
 * dates so results are timezone-stable.
 *
 * Statutory basis (45 CFR § 149.510, as implemented in the federal IDR rules):
 *   - Open negotiation period: 30 business days from the open negotiation
 *     initiation notice (§ 149.510(b)(1); see also § 149.410 for initiation).
 *   - IDR initiation window: 4 business days beginning the business day after
 *     the open negotiation period ends (§ 149.510(b)(2)(i)).
 *   - Joint certified IDR entity selection: 3 business days after IDR
 *     initiation (§ 149.510(c)(1)); failing agreement, the Departments select.
 *   - Certified IDR entity payment determination: within 30 business days of
 *     selection (§ 149.510(c)(4)(ii)).
 *   - Payment of the determined amount: the statute requires payment within
 *     30 calendar days of the determination (PHSA § 2799A-1(c)(6)).
 *
 * IMPORTANT: these day counts and all holiday/business-day conventions are
 * POLICY VALUES subject to rulemaking change and litigation (the TMA cases
 * vacated portions of the IDR rules). They are therefore configuration-
 * overridable via environment variables (see getDeadlinePolicy); the defaults
 * below cite the CFR sections in effect as of this writing and are NOT a
 * statement that they cannot change.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** Deadline policy. Day counts default to the statutory values cited above. */
export interface IDRDeadlinePolicy {
  /** 45 CFR § 149.510(b)(1) — default 30 business days. */
  openNegotiationBusinessDays: number;
  /** 45 CFR § 149.510(b)(2)(i) — default 4 business days after ON period ends. */
  idrInitiationWindowBusinessDays: number;
  /** 45 CFR § 149.510(c)(1) — default 3 business days after IDR initiation. */
  idreSelectionBusinessDays: number;
  /** 45 CFR § 149.510(c)(3)(i) — default 10 business days after IDRE selection. */
  offerSubmissionBusinessDays: number;
  /** 45 CFR § 149.510(c)(4)(ii) — default 30 business days after IDRE selection. */
  determinationBusinessDays: number;
  /** PHSA § 2799A-1(c)(6) — default 30 CALENDAR days after determination. */
  paymentCalendarDays: number;
  /**
   * Additional non-business days (ISO "YYYY-MM-DD", UTC) beyond weekends and
   * US federal holidays — e.g. declared federal closures. Configurable via
   * IDR_BUSINESS_DAY_EXTRA_CLOSURES.
   */
  extraClosures: ReadonlySet<string>;
  /** Set false to treat only weekends as non-business days. */
  useFederalHolidays: boolean;
}

/** Dates the engine can anchor on. Any may be null if the event has not occurred. */
export interface DisputeDeadlineAnchors {
  /** Date the open negotiation initiation notice was sent. */
  openNegotiationInitiatedAt: Date | null;
  /** Date the open negotiation period ended (if known independently). */
  openNegotiationEndedAt?: Date | null;
  /** Date IDR was initiated (STEP_04_IDR_INITIATED entry). */
  idrInitiatedAt: Date | null;
  /** Date the certified IDR entity was selected (STEP_07 entry). */
  idreSelectedAt: Date | null;
  /** Date the payment determination was issued (STEP_13 entry). */
  determinationIssuedAt?: Date | null;
}

export interface ComputedIDeadlines {
  /** Last business day of the 30-BD open negotiation period. */
  openNegotiationEnd: Date | null;
  /** First business day of the IDR initiation window. */
  idrInitiationWindowStart: Date | null;
  /** Last business day on which IDR may be initiated (window end). */
  idrInitiationDeadline: Date | null;
  /** Deadline for joint IDRE selection (else Departments' random selection). */
  idreSelectionDeadline: Date | null;
  /** Deadline for each party's offer submission. */
  offerSubmissionDeadline: Date | null;
  /** Deadline for the certified IDRE payment determination. */
  determinationDeadline: Date | null;
  /** Deadline for payment of the determined amount (calendar days). */
  paymentDeadline: Date | null;
}

export type DeadlineAlertTier = "t_minus_5" | "t_minus_1" | "overdue";

// ── Statutory defaults (subject to rulemaking change — see header) ───────────

export const STATUTORY_DEADLINE_DEFAULTS = {
  openNegotiationBusinessDays: 30, // 45 CFR § 149.510(b)(1)
  idrInitiationWindowBusinessDays: 4, // 45 CFR § 149.510(b)(2)(i)
  idreSelectionBusinessDays: 3, // 45 CFR § 149.510(c)(1)
  offerSubmissionBusinessDays: 10, // 45 CFR § 149.510(c)(3)(i)
  determinationBusinessDays: 30, // 45 CFR § 149.510(c)(4)(ii)
  paymentCalendarDays: 30, // PHSA § 2799A-1(c)(6)
} as const;

/**
 * Resolve the effective deadline policy: statutory defaults, overridable by
 * environment variables so rulemaking changes do not require a code deploy.
 *   IDR_OPEN_NEGOTIATION_BUSINESS_DAYS      (default 30)
 *   IDR_INITIATION_WINDOW_BUSINESS_DAYS     (default 4)
 *   IDR_IDRE_SELECTION_BUSINESS_DAYS        (default 3)
 *   IDR_OFFER_SUBMISSION_BUSINESS_DAYS      (default 10)
 *   IDR_DETERMINATION_BUSINESS_DAYS         (default 30)
 *   IDR_PAYMENT_CALENDAR_DAYS               (default 30)
 *   IDR_BUSINESS_DAY_EXTRA_CLOSURES         (comma-separated ISO dates)
 *   IDR_USE_FEDERAL_HOLIDAYS                ("true"/"false", default true)
 */
export function getDeadlinePolicy(env: NodeJS.ProcessEnv = process.env): IDRDeadlinePolicy {
  const num = (key: string, fallback: number): number => {
    const raw = env[key];
    if (raw === undefined || raw.trim() === "") return fallback;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`[idr-deadlines] ${key} must be a positive integer, got "${raw}"`);
    }
    return parsed;
  };
  const extra = new Set(
    (env.IDR_BUSINESS_DAY_EXTRA_CLOSURES ?? "")
      .split(",")
      .map(s => s.trim())
      .filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s))
  );
  return {
    openNegotiationBusinessDays: num("IDR_OPEN_NEGOTIATION_BUSINESS_DAYS", STATUTORY_DEADLINE_DEFAULTS.openNegotiationBusinessDays),
    idrInitiationWindowBusinessDays: num("IDR_INITIATION_WINDOW_BUSINESS_DAYS", STATUTORY_DEADLINE_DEFAULTS.idrInitiationWindowBusinessDays),
    idreSelectionBusinessDays: num("IDR_IDRE_SELECTION_BUSINESS_DAYS", STATUTORY_DEADLINE_DEFAULTS.idreSelectionBusinessDays),
    offerSubmissionBusinessDays: num("IDR_OFFER_SUBMISSION_BUSINESS_DAYS", STATUTORY_DEADLINE_DEFAULTS.offerSubmissionBusinessDays),
    determinationBusinessDays: num("IDR_DETERMINATION_BUSINESS_DAYS", STATUTORY_DEADLINE_DEFAULTS.determinationBusinessDays),
    paymentCalendarDays: num("IDR_PAYMENT_CALENDAR_DAYS", STATUTORY_DEADLINE_DEFAULTS.paymentCalendarDays),
    extraClosures: extra,
    useFederalHolidays: (env.IDR_USE_FEDERAL_HOLIDAYS ?? "true").toLowerCase() !== "false",
  };
}

// ── US federal holidays (5 U.S.C. § 6103), with weekend observation shifts ───

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function utcDate(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day));
}

/** nth occurrence of a weekday in a month. weekday: 0=Sun..6=Sat. n=-1 → last. */
function nthWeekdayOfMonth(year: number, monthIndex: number, weekday: number, n: number): Date {
  if (n === -1) {
    const last = utcDate(year, monthIndex + 1, 0); // last day of month
    const dow = last.getUTCDay();
    const back = (dow - weekday + 7) % 7;
    return utcDate(year, monthIndex, last.getUTCDate() - back);
  }
  const first = utcDate(year, monthIndex, 1);
  const dow = first.getUTCDay();
  const offset = (weekday - dow + 7) % 7;
  return utcDate(year, monthIndex, 1 + offset + (n - 1) * 7);
}

/** Federal "in lieu of" observation: Saturday → Friday before, Sunday → Monday after. */
function observedDate(actual: Date): Date[] {
  const dow = actual.getUTCDay();
  if (dow === 6) return [new Date(actual.getTime() - 86400000)]; // Fri
  if (dow === 0) return [new Date(actual.getTime() + 86400000)]; // Mon
  return [actual];
}

/**
 * All US federal holidays (actual and observed dates) whose observance falls
 * within the given calendar year. Includes the observed New Year's Day from
 * the following year when Jan 1 falls on a Saturday (observed Dec 31).
 */
export function usFederalHolidays(year: number): Set<string> {
  const days = new Set<string>();
  const add = (d: Date) => observedDate(d).forEach(o => days.add(toISO(o)));

  add(utcDate(year, 0, 1)); // New Year's Day
  add(nthWeekdayOfMonth(year, 0, 1, 3)); // MLK Day — 3rd Mon Jan
  add(nthWeekdayOfMonth(year, 1, 1, 3)); // Washington's Birthday — 3rd Mon Feb
  add(nthWeekdayOfMonth(year, 4, 1, -1)); // Memorial Day — last Mon May
  add(utcDate(year, 5, 19)); // Juneteenth (federal holiday since 2021)
  add(utcDate(year, 6, 4)); // Independence Day
  add(nthWeekdayOfMonth(year, 8, 1, 1)); // Labor Day — 1st Mon Sep
  add(nthWeekdayOfMonth(year, 9, 1, 2)); // Columbus Day — 2nd Mon Oct
  add(utcDate(year, 10, 11)); // Veterans Day
  add(nthWeekdayOfMonth(year, 10, 4, 4)); // Thanksgiving — 4th Thu Nov
  add(utcDate(year, 11, 25)); // Christmas Day

  // If next Jan 1 is a Saturday, it is observed on Dec 31 of this year.
  const nextNewYear = utcDate(year + 1, 0, 1);
  if (nextNewYear.getUTCDay() === 6) days.add(toISO(utcDate(year, 11, 31)));

  // Keep only dates that actually fall inside `year` (observations can spill).
  const prefix = `${year}-`;
  return new Set([...days].filter(d => d.startsWith(prefix)));
}

// ── Business-day arithmetic (all UTC) ────────────────────────────────────────

function holidaySet(year: number, policy?: IDRDeadlinePolicy): Set<string> {
  if (policy && !policy.useFederalHolidays) return new Set(policy.extraClosures);
  const set = usFederalHolidays(year);
  if (policy) policy.extraClosures.forEach(d => set.add(d));
  return set;
}

export function isBusinessDay(date: Date, policy?: IDRDeadlinePolicy): boolean {
  const dow = date.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !holidaySet(date.getUTCFullYear(), policy).has(toISO(date));
}

/**
 * Add `n` business days to a date. Day 0 is the input date; the result is the
 * nth following business day. The time-of-day of the input is preserved.
 * `n` must be >= 0.
 */
export function addBusinessDays(start: Date, n: number, policy?: IDRDeadlinePolicy): Date {
  if (!Number.isInteger(n) || n < 0) throw new Error(`addBusinessDays: n must be a non-negative integer, got ${n}`);
  const result = new Date(start.getTime());
  const years = [result.getUTCFullYear(), result.getUTCFullYear() + 1];
  let holidays = new Set<string>([...holidaySet(years[0], policy), ...holidaySet(years[1], policy)]);
  let added = 0;
  while (added < n) {
    result.setUTCDate(result.getUTCDate() + 1);
    const y = result.getUTCFullYear();
    if (!years.includes(y)) {
      years.push(y);
      holidaySet(y, policy).forEach(d => holidays.add(d));
    }
    const dow = result.getUTCDay();
    if (dow !== 0 && dow !== 6 && !holidays.has(toISO(result))) added++;
  }
  return result;
}

/**
 * Number of business days strictly after `fromExclusive` up to and including
 * `toInclusive` (date granularity, UTC). Negative when toInclusive is before
 * fromExclusive (calendar-day difference, sign only).
 */
export function businessDaysBetween(fromExclusive: Date, toInclusive: Date, policy?: IDRDeadlinePolicy): number {
  const from = toISO(fromExclusive);
  const to = toISO(toInclusive);
  if (to <= from) {
    if (to === from) return 0;
    return -Math.max(1, Math.round((new Date(from + "T00:00:00Z").getTime() - new Date(to + "T00:00:00Z").getTime()) / 86400000));
  }
  let count = 0;
  const cursor = new Date(from + "T00:00:00Z");
  const years = new Set<number>();
  while (toISO(cursor) < to) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (!years.has(cursor.getUTCFullYear())) {
      years.add(cursor.getUTCFullYear());
      holidaySet(cursor.getUTCFullYear(), policy); // warm; recomputed per check below
    }
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6 && !holidaySet(cursor.getUTCFullYear(), policy).has(toISO(cursor))) count++;
  }
  return count;
}

/** Add `n` calendar days (UTC) to a date. */
export function addCalendarDays(start: Date, n: number): Date {
  if (!Number.isInteger(n) || n < 0) throw new Error(`addCalendarDays: n must be a non-negative integer, got ${n}`);
  return new Date(start.getTime() + n * 86400000);
}

// ── Statutory deadline computation ───────────────────────────────────────────

/**
 * Compute every statutory deadline for a dispute from its anchor dates.
 * Missing anchors yield nulls for the deadlines that depend on them.
 */
export function computeIDeadlines(
  anchors: DisputeDeadlineAnchors,
  policy: IDRDeadlinePolicy = getDeadlinePolicy()
): ComputedIDeadlines {
  const openNegotiationEnd = anchors.openNegotiationEndedAt
    ? anchors.openNegotiationEndedAt
    : anchors.openNegotiationInitiatedAt
      ? addBusinessDays(anchors.openNegotiationInitiatedAt, policy.openNegotiationBusinessDays, policy)
      : null;

  const idrInitiationWindowStart = openNegotiationEnd ? addBusinessDays(openNegotiationEnd, 1, policy) : null;
  const idrInitiationDeadline = openNegotiationEnd
    ? addBusinessDays(openNegotiationEnd, policy.idrInitiationWindowBusinessDays, policy)
    : null;

  const idreSelectionDeadline = anchors.idrInitiatedAt
    ? addBusinessDays(anchors.idrInitiatedAt, policy.idreSelectionBusinessDays, policy)
    : null;

  const offerSubmissionDeadline = anchors.idreSelectedAt
    ? addBusinessDays(anchors.idreSelectedAt, policy.offerSubmissionBusinessDays, policy)
    : null;

  const determinationDeadline = anchors.idreSelectedAt
    ? addBusinessDays(anchors.idreSelectedAt, policy.determinationBusinessDays, policy)
    : null;

  const paymentDeadline = anchors.determinationIssuedAt
    ? addCalendarDays(anchors.determinationIssuedAt, policy.paymentCalendarDays)
    : null;

  return {
    openNegotiationEnd,
    idrInitiationWindowStart,
    idrInitiationDeadline,
    idreSelectionDeadline,
    offerSubmissionDeadline,
    determinationDeadline,
    paymentDeadline,
  };
}

// ── Alert tiers (T-5 / T-1 business days / overdue) ──────────────────────────

/**
 * Classify a deadline relative to `now` into an escalation tier:
 *   - "overdue":   the deadline date (UTC) is before today
 *   - "t_minus_1": 1 or fewer business days remain until the deadline
 *   - "t_minus_5": 5 or fewer business days remain until the deadline
 *   - null:        more than 5 business days remain (no alert yet)
 */
export function deadlineAlertTier(
  deadline: Date,
  now: Date = new Date(),
  policy?: IDRDeadlinePolicy
): DeadlineAlertTier | null {
  const today = toISO(now);
  const due = toISO(deadline);
  if (due < today) return "overdue";
  const remaining = businessDaysBetween(now, deadline, policy);
  if (remaining <= 1) return "t_minus_1";
  if (remaining <= 5) return "t_minus_5";
  return null;
}

/** Escalation ordering, highest severity last. */
export const ALERT_TIER_ORDER: DeadlineAlertTier[] = ["t_minus_5", "t_minus_1", "overdue"];
