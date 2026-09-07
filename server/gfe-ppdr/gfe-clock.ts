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
): { complete: boolean; missing: RequiredGfeElement[] } {
  const provided = new Set(elementsProvided.map((e) => e.trim().toUpperCase()));
  const missing = REQUIRED_GFE_ELEMENTS.filter((e) => !provided.has(e));
  return { complete: missing.length === 0, missing };
}

/** Validates the <=12-month window for recurring-services GFEs (149.610(a)(2)(iii)). */
export function validateRecurringGfeWindow(firstServiceAt: Date, lastServiceAt: Date): {
  valid: boolean;
  months: number;
} {
  if (lastServiceAt < firstServiceAt) throw new Error('lastServiceAt must be on/after firstServiceAt');
  const months =
    (lastServiceAt.getUTCFullYear() - firstServiceAt.getUTCFullYear()) * 12 +
    (lastServiceAt.getUTCMonth() - firstServiceAt.getUTCMonth()) +
    (lastServiceAt.getUTCDate() < firstServiceAt.getUTCDate() ? -1 : 0);
  return { valid: months <= RECURRING_GFE_MAX_MONTHS, months };
}
