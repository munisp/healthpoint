/**
 * Good Faith Estimate (GFE) delivery clocks for uninsured/self-pay
 * individuals — 45 CFR 149.610.
 *
 * Delivery deadlines (149.610(a)(2)):
 * - Service scheduled >= 10 business days before the appointment (or GFE
 *   requested without scheduling): GFE within 3 business days of
 *   scheduling/request.
 * - Service scheduled 3–9 business days before the appointment: GFE within
 *   1 business day of scheduling.
 * - Recurring items/services: a single GFE may cover recurring services for
 *   up to 12 months with scope and frequency documented.
 *
 * Content (149.610(b)): patient identifying info, itemized list of
 * reasonably expected items/services with codes (CPT/HCPCS/DRG),
 * expected charges, co-providers/facilities disclaimer, and required
 * disclaimers about the PPDR process. This module validates the presence
 * of required content categories; exact wording must follow current HHS
 * standard templates (re-verify before production use).
 *
 * Business-day computation DELEGATES to the canonical holiday-aware engine
 * in ../idr/deadlines (weekends + US federal holidays + configurable extra
 * closures); caller-supplied `holidays` sets are merged in as extra
 * closures. Previously this module maintained its own weekend-only math with
 * holidays defaulting to none, which produced statutory deadlines that
 * ignored federal holidays.
 */

export const GFE_MAX_BUSINESS_DAYS_LONG_HORIZON = 3;
export const GFE_MAX_BUSINESS_DAYS_SHORT_HORIZON = 1;
export const LONG_HORIZON_THRESHOLD_BUSINESS_DAYS = 10;
export const SHORT_HORIZON_MIN_BUSINESS_DAYS = 3;
export const RECURRING_GFE_MAX_MONTHS = 12;

export type HorizonBand = 'LONG' | 'SHORT' | 'IMMEDIATE';

import {
  availableGfeElements,
  isNoticeLanguage,
  DEFAULT_NOTICE_LANGUAGE,
} from '../../shared/i18n/notices';
import {
  addBusinessDays as idrAddBusinessDays,
  businessDaysBetween as idrBusinessDaysBetween,
  isBusinessDay as idrIsBusinessDay,
  getDeadlinePolicy,
  type IDRDeadlinePolicy,
} from '../idr/deadlines';

/**
 * Resolve the deadline policy: canonical defaults (weekends + US federal
 * holidays + env-configured extra closures) with any caller-supplied holiday
 * set merged in as extra closures.
 */
function policyFor(holidays?: ReadonlySet<string>): IDRDeadlinePolicy {
  const base = getDeadlinePolicy();
  if (!holidays || holidays.size === 0) return base;
  return { ...base, extraClosures: new Set([...Array.from(base.extraClosures), ...Array.from(holidays)]) };
}

export function isBusinessDay(d: Date, holidays?: ReadonlySet<string>): boolean {
  return idrIsBusinessDay(d, policyFor(holidays));
}

/** Add n business days to a date (n >= 0). Holidays are caller-supplied YYYY-MM-DD keys, merged over the canonical federal-holiday calendar. */
export function addBusinessDays(start: Date, n: number, holidays?: ReadonlySet<string>): Date {
  return idrAddBusinessDays(start, n, policyFor(holidays));
}

/** Business days strictly between two dates (exclusive of start, inclusive of end). */
export function businessDaysBetween(start: Date, end: Date, holidays?: ReadonlySet<string>): number {
  return idrBusinessDaysBetween(start, end, policyFor(holidays));
}

/**
 * Classifies the scheduling horizon into the regulatory bands:
 * LONG (>=10 business days before service), SHORT (3–9), IMMEDIATE (<3).
 */
export function classifyHorizon(scheduledAt: Date, serviceAt: Date, holidays?: ReadonlySet<string>): HorizonBand {
  if (serviceAt <= scheduledAt) throw new Error('serviceAt must be after scheduledAt');
  const bd = businessDaysBetween(scheduledAt, serviceAt, holidays);
  if (bd >= LONG_HORIZON_THRESHOLD_BUSINESS_DAYS) return 'LONG';
  if (bd >= SHORT_HORIZON_MIN_BUSINESS_DAYS) return 'SHORT';
  return 'IMMEDIATE';
}

export interface GfeDeadlineInput {
  scheduledAt: Date;
  serviceAt: Date;
  /** True when the individual requested a GFE without scheduling (treated as LONG). */
  requestedWithoutScheduling?: boolean;
  holidays?: ReadonlySet<string>;
}

export interface GfeDeadlineResult {
  deadline: Date;
  horizon: HorizonBand;
  maxBusinessDays: number;
  notes: string;
}

/**
 * Computes the GFE delivery deadline (149.610(a)(2)). IMMEDIATE horizons
 * (service scheduled <3 business days out) have no federal scheduling-based
 * deadline; fail-closed to delivery at scheduling time (deadline = scheduledAt).
 */
export function computeGfeDeadline(input: GfeDeadlineInput): GfeDeadlineResult {
  const { scheduledAt, serviceAt } = input;
  for (const [name, d] of [
    ['scheduledAt', scheduledAt],
    ['serviceAt', serviceAt],
  ] as const) {
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) throw new Error(`${name} must be a valid Date`);
  }
  const holidays = input.holidays ?? new Set<string>();
  const horizon =
    input.requestedWithoutScheduling === true ? 'LONG' : classifyHorizon(scheduledAt, serviceAt, holidays);
  if (horizon === 'LONG') {
    const deadline = addBusinessDays(scheduledAt, GFE_MAX_BUSINESS_DAYS_LONG_HORIZON, holidays);
    deadline.setUTCHours(23, 59, 59, 999); // deadline = end of the 3rd business day
    return {
      deadline,
      horizon,
      maxBusinessDays: GFE_MAX_BUSINESS_DAYS_LONG_HORIZON,
      notes:
        'GFE due within 3 business days of scheduling/request (45 CFR ' +
        '149.610(a)(2)(i)): service scheduled >=10 business days out or GFE ' +
        'requested without scheduling.',
    };
  }
  if (horizon === 'SHORT') {
    const deadline = addBusinessDays(scheduledAt, GFE_MAX_BUSINESS_DAYS_SHORT_HORIZON, holidays);
    deadline.setUTCHours(23, 59, 59, 999); // deadline = end of the next business day
    return {
      deadline,
      horizon,
      maxBusinessDays: GFE_MAX_BUSINESS_DAYS_SHORT_HORIZON,
      notes:
        'GFE due within 1 business day of scheduling (45 CFR 149.610(a)(2)(ii)): ' +
        'service scheduled 3–9 business days out.',
    };
  }
  return {
    deadline: new Date(scheduledAt.getTime()),
    horizon,
    maxBusinessDays: 0,
    notes:
      'Service scheduled <3 business days out: no federal scheduling-based ' +
      'deadline applies; fail-closed to delivery at time of scheduling. Verify ' +
      'current HHS guidance before relying on this path.',
  };
}

export function isGfeLate(result: GfeDeadlineResult, deliveredAt: Date): boolean {
  return deliveredAt.getTime() > result.deadline.getTime();
}

/** Required GFE content categories (45 CFR 149.610(b)). */
export const REQUIRED_GFE_ELEMENTS = [
  'PATIENT_IDENTIFYING_INFO',
  'ITEMIZED_SERVICES_WITH_CODES', // CPT/HCPCS/DRG per expected item/service
  'EXPECTED_CHARGES',
  'PROVIDER_FACILITY_INFO', // name, NPI, TIN, location
  'COPROVIDER_DISCLAIMER', // separate estimates from co-providers/facilities
  'PPDR_DISCLAIMER', // right to initiate patient-provider dispute resolution
  'NOT_A_CONTRACT_DISCLAIMER', // estimate is not a contract; final bill may differ
] as const;
export type RequiredGfeElement = (typeof REQUIRED_GFE_ELEMENTS)[number];

export function validateGfeContent(
  elementsProvided: readonly string[],
  options: { language?: string; coProviders?: readonly CoProviderEstimate[] } = {},
): { complete: boolean; missing: RequiredGfeElement[]; language: string; coProviderErrors: string[] } {
  const provided = new Set(elementsProvided.map((e) => e.trim().toUpperCase()));
  const available = new Set(availableGfeElements(options.language));
  const effectiveLanguage = isNoticeLanguage(options.language) ? options.language : DEFAULT_NOTICE_LANGUAGE;
  const missing =
    options.language !== undefined && !isNoticeLanguage(options.language)
      ? [...REQUIRED_GFE_ELEMENTS] // unsupported language: fail closed
      : REQUIRED_GFE_ELEMENTS.filter((e) => !provided.has(e) || !available.has(e));
  const coProviderErrors = options.coProviders ? validateCoProviderEstimates(options.coProviders) : [];
  // W4-F5: when co-providers are supplied the disclaimer must be present AND
  // every co-provider entry valid; either failure makes content incomplete.
  if (options.coProviders && options.coProviders.length > 0 && !provided.has('COPROVIDER_DISCLAIMER')) {
    if (!missing.includes('COPROVIDER_DISCLAIMER')) missing.push('COPROVIDER_DISCLAIMER');
  }
  return {
    complete: missing.length === 0 && coProviderErrors.length === 0,
    missing,
    language: effectiveLanguage,
    coProviderErrors,
  };
}

/* ── W4-F5: co-provider / co-facility estimates (149.610(b)(2)) ──────────── */

/**
 * Co-provider/co-facility estimate entry. 45 CFR 149.610(b)(1)(iii),
 * (b)(2): the convening provider must include (or separately transmit)
 * expected charges from co-providers/co-facilities reasonably expected to
 * furnish items/services in connection with the primary service.
 */
export interface CoProviderEstimate {
  name: string;
  npi?: string;
  expectedChargesUsd: number;
}

/** Per-entry validation; returns human-readable errors (empty when valid). */
export function validateCoProviderEstimates(coProviders: readonly CoProviderEstimate[]): string[] {
  const errors: string[] = [];
  coProviders.forEach((c, i) => {
    if (!c || typeof c.name !== 'string' || c.name.trim().length === 0) {
      errors.push(`coProviders[${i}].name is required`);
    }
    if (c && c.npi !== undefined && !/^\d{10}$/.test(c.npi)) {
      errors.push(`coProviders[${i}].npi must be 10 digits when supplied`);
    }
    if (!c || !Number.isFinite(c.expectedChargesUsd) || c.expectedChargesUsd < 0) {
      errors.push(`coProviders[${i}].expectedChargesUsd must be a finite number >= 0`);
    }
  });
  return errors;
}

/**
 * Aggregation rule (149.610(b)): the GFE total equals the convening
 * provider's/facility's expected charges PLUS the sum of all co-provider /
 * co-facility expected charges (total = convening + Σ co-providers).
 */
export function computeGfeTotalExpectedCharges(
  conveningChargesUsd: number,
  coProviders: readonly CoProviderEstimate[] = [],
): number {
  if (!Number.isFinite(conveningChargesUsd) || conveningChargesUsd < 0) {
    throw new Error('conveningChargesUsd must be a finite number >= 0');
  }
  const errors = validateCoProviderEstimates(coProviders);
  if (errors.length > 0) throw new Error('Invalid co-provider estimates: ' + errors.join('; '));
  return conveningChargesUsd + coProviders.reduce((s, c) => s + c.expectedChargesUsd, 0);
}

/**
 * Updated-GFE rule (45 CFR 149.610(a)(2)(iv) / HHS GFE guidance): if the
 * expected charges or items/services change, an UPDATED GFE must be
 * delivered no later than 1 business day before the service is furnished.
 * Fail closed: when charges changed and no delivery timestamp is supplied,
 * the validation is non-compliant.
 */
export function validateUpdatedGfeRule(input: {
  /** True when expected charges/items changed after the initial GFE. */
  expectedChargesChanged: boolean;
  /** When the updated GFE was (or will be) delivered. */
  updatedGfeDeliveredAt?: Date;
  serviceAt: Date;
  holidays?: ReadonlySet<string>;
}): { compliant: boolean; required: boolean; deadline: Date | null; violations: string[] } {
  const violations: string[] = [];
  if (!input.expectedChargesChanged) {
    return { compliant: true, required: false, deadline: null, violations };
  }
  // Deadline: end of the business day immediately preceding the service day.
  // Compute by walking back to the previous business day of serviceAt.
  const serviceDay = new Date(serviceAtUtcMidnight(input.serviceAt));
  let cursor = new Date(serviceDay.getTime() - 24 * 60 * 60 * 1000);
  while (!isBusinessDay(cursor, input.holidays)) {
    cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
  }
  const deadline = new Date(cursor);
  deadline.setUTCHours(23, 59, 59, 999);
  if (!input.updatedGfeDeliveredAt) {
    violations.push(
      'Expected charges changed: an updated GFE is required no later than 1 ' +
        'business day before the service (45 CFR 149.610(a)(2)); no delivery ' +
        'timestamp supplied — failing closed.',
    );
    return { compliant: false, required: true, deadline, violations };
  }
  if (input.updatedGfeDeliveredAt.getTime() > deadline.getTime()) {
    violations.push(
      `Updated GFE delivered ${input.updatedGfeDeliveredAt.toISOString()}, after ` +
        `the deadline ${deadline.toISOString()} (1 business day before service, ` +
        '45 CFR 149.610(a)(2)).',
    );
  }
  return { compliant: violations.length === 0, required: true, deadline, violations };
}

function serviceAtUtcMidnight(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Validates the recurring-services GFE window (45 CFR 149.610(a)(2)(iii)):
 * a single GFE may cover recurring items/services whose expected scope
 * spans "no more than 12 months".
 *
 * W4-F6 FIX (statute-faithful, day-level precision): "12 months" is computed
 * as CALENDAR months — the span is valid iff lastServiceAt is on or before
 * the 12-calendar-month anniversary of firstServiceAt (same day-of-month,
 * clamped to the month end when the target month is shorter, e.g.
 * Jan 31 → Jan 31 next year). This is strict day-level precision and handles
 * leap years correctly (a 12-calendar-month span may be 365 or 366 days; the
 * statute's bound is the calendar-month anniversary, NOT a day count).
 * The previous month-arithmetic implementation accepted e.g.
 * 2026-01-01 → 2027-01-30 (spanning 12 months 29 days) — a bug.
 */
export function validateRecurringGfeWindow(firstServiceAt: Date, lastServiceAt: Date): {
  valid: boolean;
  months: number;
  /** Exclusive upper bound: the 12-calendar-month anniversary date. */
  maxLastServiceAt: Date;
  days: number;
} {
  if (!(firstServiceAt instanceof Date) || Number.isNaN(firstServiceAt.getTime())) {
    throw new Error('firstServiceAt must be a valid Date');
  }
  if (!(lastServiceAt instanceof Date) || Number.isNaN(lastServiceAt.getTime())) {
    throw new Error('lastServiceAt must be a valid Date');
  }
  if (lastServiceAt < firstServiceAt) throw new Error('lastServiceAt must be on/after firstServiceAt');

  const max = addCalendarMonthsUtc(firstServiceAt, RECURRING_GFE_MAX_MONTHS);
  const days = Math.floor(
    (Date.UTC(lastServiceAt.getUTCFullYear(), lastServiceAt.getUTCMonth(), lastServiceAt.getUTCDate()) -
      Date.UTC(firstServiceAt.getUTCFullYear(), firstServiceAt.getUTCMonth(), firstServiceAt.getUTCDate())) /
      (24 * 60 * 60 * 1000),
  );
  // Whole elapsed calendar months (informational).
  const months =
    (lastServiceAt.getUTCFullYear() - firstServiceAt.getUTCFullYear()) * 12 +
    (lastServiceAt.getUTCMonth() - firstServiceAt.getUTCMonth()) +
    (lastServiceAt.getUTCDate() < firstServiceAt.getUTCDate() ? -1 : 0);
  return { valid: lastServiceAt.getTime() <= max.getTime(), months, maxLastServiceAt: max, days };
}

/** Add n calendar months in UTC, clamping the day-of-month to month length. */
export function addCalendarMonthsUtc(d: Date, n: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const targetY = y + Math.floor(m / 12);
  const targetM = ((m % 12) + 12) % 12;
  const maxDay = new Date(Date.UTC(targetY, targetM + 1, 0)).getUTCDate();
  const day = Math.min(d.getUTCDate(), maxDay);
  return new Date(Date.UTC(targetY, targetM, day, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
}
