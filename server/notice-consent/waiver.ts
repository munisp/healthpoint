/**
 * Notice & Consent waiver engine — 45 CFR 149.410–450 (No Surprises Act,
 * Subparts E–F balance-billing protections and the notice-and-consent
 * exception).
 *
 * Core rules modeled here:
 * - 149.410(b) / 149.430: emergency services can NEVER be subject to the
 *   notice-and-consent exception (no balance-billing waiver).
 * - 149.410(c)(4) / 149.420: the exception applies only to non-emergency
 *   items/services furnished by an out-of-network (OON) provider at an
 *   in-network facility, and only when the item/service is NOT in a
 *   protected (non-waivable) category.
 * - Non-waivable categories (149.410(c)(4)(iii), 149.420(b)): ancillary
 *   services (anesthesiology, pathology, radiology, neonatology; services of
 *   assistant surgeons, hospitalists, intensivists), diagnostic services
 *   (including radiology and laboratory), items/services from an OON
 *   provider when no in-network provider is available at the facility, and
 *   unforeseen urgent medical needs arising while a covered service is
 *   furnished.
 * - Timing (149.420(c)-(d)): if the appointment is scheduled at least 72
 *   hours before the service, notice must be given at least 72 hours before;
 *   if scheduled within 72 hours (or on the same day), notice must be given
 *   on the day of scheduling and consent obtained at least 3 hours before
 *   the service.
 * - Retention: signed notice-and-consent documents must be retained for 7
 *   years (26 CFR 54.9816-7; 45 CFR 149.420 recordkeeping).
 *
 * All timing thresholds are constants exported for configuration review;
 * nothing is silently hardcoded inside conditionals.
 */

import {
  availableNoticeElements,
  isNoticeLanguage,
  DEFAULT_NOTICE_LANGUAGE,
} from '../../shared/i18n/notices';

/** Specialties/services that are categorically non-waivable (ancillary). */
export const ANCILLARY_SPECIALTIES = [
  'ANESTHESIOLOGY',
  'PATHOLOGY',
  'RADIOLOGY',
  'NEONATOLOGY',
  'ASSISTANT_SURGEON',
  'HOSPITALIST',
  'INTENSIVIST',
] as const;
export type AncillarySpecialty = (typeof ANCILLARY_SPECIALTIES)[number];

export type ServiceCategory =
  | 'EMERGENCY'
  | 'ANCILLARY'
  | 'DIAGNOSTIC'
  | 'UNFORESEEN_URGENT'
  | 'NON_EMERGENCY'
  | 'AIR_AMBULANCE'
  | 'POST_STABILIZATION';

export type WaiverEligibility =
  | 'WAIVABLE'
  | 'NON_WAIVABLE_EMERGENCY'
  | 'NON_WAIVABLE_AIR_AMBULANCE_EMERGENCY'
  | 'NON_WAIVABLE_ANCILLARY'
  | 'NON_WAIVABLE_DIAGNOSTIC'
  | 'NON_WAIVABLE_UNFORESEEN'
  | 'NON_WAIVABLE_NO_IN_NETWORK_AVAILABLE'
  | 'NON_WAIVABLE_IN_NETWORK_PROVIDER'
  | 'NON_WAIVABLE_POST_STABILIZATION_CONDITIONS';

export const NOTICE_HOURS_WHEN_SCHEDULED_EARLY = 72;
export const CONSENT_MIN_HOURS_BEFORE_SERVICE = 3;
export const RETENTION_YEARS = 7;

export interface WaiverEligibilityInput {
  serviceCategory: ServiceCategory;
  /** Provider specialty; checked against the ancillary list. */
  providerSpecialty?: string;
  /** True when no in-network provider for this service is available at the facility. */
  noInNetworkProviderAvailable?: boolean;
  /** True when the rendering provider is in-network (exception never applies). */
  providerInNetwork?: boolean;
  /**
   * W1-F6: set true when an AIR_AMBULANCE service is furnished on an
   * emergency basis — emergency air ambulance is NEVER waivable. When the
   * category is AIR_AMBULANCE and this flag is undefined, the engine fails
   * closed to NON_WAIVABLE (emergency status unresolved).
   */
  emergencyAirAmbulance?: boolean;
  /**
   * W4-F2: post-stabilization services (45 CFR 149.410(b)(2)(ii)). The
   * notice-and-consent exception is available for post-stabilization services
   * ONLY when ALL of the following strict conditions are explicitly true:
   * the patient is stable, the patient can travel to a participating
   * facility, a willing participating facility is reachable, and the patient
   * (or authorized representative) gives informed consent. Fail closed: any
   * missing/false condition makes the service NEVER waivable.
   */
  postStabilization?: {
    patientStable?: boolean;
    canTravelToParticipatingFacility?: boolean;
    receivingFacilityReachable?: boolean;
    informedConsentObtained?: boolean;
  };
}

export interface WaiverEligibilityResult {
  eligibility: WaiverEligibility;
  waivable: boolean;
  reason: string;
}

/**
 * Determines whether the notice-and-consent exception is available at all.
 * Fail-closed: any protected category or an in-network provider yields
 * NON_WAIVABLE. Emergency wins over every other classification.
 */
export function evaluateWaiverEligibility(input: WaiverEligibilityInput): WaiverEligibilityResult {
  if (input.providerInNetwork === true) {
    return {
      eligibility: 'NON_WAIVABLE_IN_NETWORK_PROVIDER',
      waivable: false,
      reason:
        'Rendering provider is in-network; the notice-and-consent exception ' +
        'applies only to out-of-network providers at in-network facilities.',
    };
  }
  // W1-F6: emergency air ambulance transport can NEVER be waived. Air
  // ambulance services furnished on an emergency basis are emergency services
  // for balance-billing purposes (PHSA § 2799A-1(b); 45 CFR 149.410(b)) and
  // the notice-and-consent exception does not exist for them.
  if (input.serviceCategory === 'AIR_AMBULANCE' && input.emergencyAirAmbulance !== false) {
    return {
      eligibility: 'NON_WAIVABLE_AIR_AMBULANCE_EMERGENCY',
      waivable: false,
      reason:
        (input.emergencyAirAmbulance === true
          ? 'Emergency air ambulance services are never subject to notice-and-consent '
          : 'Air ambulance emergency status unresolved; failing closed to non-waivable. Emergency air ambulance services are never subject to notice-and-consent ') +
        '(PHSA § 2799A-1(b); 45 CFR 149.410(b)); balance billing for emergency air ' +
        'ambulance transport is prohibited outright.',
    };
  }
  // W4-F2: post-stabilization services (45 CFR 149.410(b)(2)(ii)). Waivable
  // ONLY when every statutory condition is explicitly satisfied; any absent or
  // false condition flag fails closed to NEVER_WAIVABLE. Evaluated before the
  // generic non-emergency fallthrough and after EMERGENCY/AIR_AMBULANCE.
  if (input.serviceCategory === 'POST_STABILIZATION') {
    const ps = input.postStabilization;
    const conditions = [
      ['patientStable', ps?.patientStable === true],
      ['canTravelToParticipatingFacility', ps?.canTravelToParticipatingFacility === true],
      ['receivingFacilityReachable', ps?.receivingFacilityReachable === true],
      ['informedConsentObtained', ps?.informedConsentObtained === true],
    ] as const;
    const unmet = conditions.filter(([, ok]) => !ok).map(([name]) => name);
    if (unmet.length > 0) {
      return {
        eligibility: 'NON_WAIVABLE_POST_STABILIZATION_CONDITIONS',
        waivable: false,
        reason:
          'Post-stabilization services are waivable only when ALL conditions of ' +
          '45 CFR 149.410(b)(2)(ii) are explicitly satisfied (patient stable; ' +
          'patient can travel to a participating facility; receiving facility ' +
          'reachable; patient/representative informed consent). Unmet or ' +
          `unresolved condition(s): ${unmet.join(', ')} — failing closed to ` +
          'non-waivable; balance billing is prohibited.',
      };
    }
    return {
      eligibility: 'WAIVABLE',
      waivable: true,
      reason:
        'Post-stabilization service with all 45 CFR 149.410(b)(2)(ii) ' +
        'conditions explicitly satisfied; the notice-and-consent exception may ' +
        'apply if timing and content requirements are met (45 CFR 149.420).',
    };
  }
  if (input.serviceCategory === 'EMERGENCY') {
    return {
      eligibility: 'NON_WAIVABLE_EMERGENCY',
      waivable: false,
      reason:
        'Emergency services can never be subject to notice-and-consent ' +
        '(45 CFR 149.410(b), 149.430); balance billing is prohibited outright.',
    };
  }
  const specialty = input.providerSpecialty?.trim().toUpperCase();
  const isAncillary =
    input.serviceCategory === 'ANCILLARY' ||
    (specialty !== undefined &&
      specialty.length > 0 &&
      (ANCILLARY_SPECIALTIES as readonly string[]).includes(specialty));
  if (isAncillary) {
    return {
      eligibility: 'NON_WAIVABLE_ANCILLARY',
      waivable: false,
      reason:
        'Ancillary services (anesthesiology, pathology, radiology, neonatology, ' +
        'assistant surgeons, hospitalists, intensivists) are non-waivable ' +
        '(45 CFR 149.410(c)(4)(iii), 149.420(b)).',
    };
  }
  if (input.serviceCategory === 'DIAGNOSTIC') {
    return {
      eligibility: 'NON_WAIVABLE_DIAGNOSTIC',
      waivable: false,
      reason:
        'Diagnostic services (including radiology and laboratory) are ' +
        'non-waivable (45 CFR 149.410(c)(4)(iii), 149.420(b)).',
    };
  }
  if (input.serviceCategory === 'UNFORESEEN_URGENT') {
    return {
      eligibility: 'NON_WAIVABLE_UNFORESEEN',
      waivable: false,
      reason:
        'Unforeseen urgent medical needs arising while a covered service is ' +
        'furnished are non-waivable (45 CFR 149.410(c)(4)(iii), 149.420(b)).',
    };
  }
  if (input.noInNetworkProviderAvailable === true) {
    return {
      eligibility: 'NON_WAIVABLE_NO_IN_NETWORK_AVAILABLE',
      waivable: false,
      reason:
        'Items/services furnished by an OON provider are non-waivable when no ' +
        'in-network provider is available at the facility (45 CFR ' +
        '149.410(c)(4)(iii), 149.420(b)).',
    };
  }
  return {
    eligibility: 'WAIVABLE',
    waivable: true,
    reason:
      'Non-emergency service by an OON provider at an in-network facility, ' +
      'outside all protected categories; the notice-and-consent exception may ' +
      'apply if timing and content requirements are met (45 CFR 149.420).',
  };
}

/** Required notice content elements (45 CFR 149.420(c)-(d), HHS standard notice). */
export const REQUIRED_NOTICE_ELEMENTS = [
  'OON_PROVIDER_STATEMENT', // provider/facility is out-of-network
  'GFE_GOOD_FAITH_ESTIMATE', // good-faith estimate of charges
  'PRIOR_AUTHORIZATION_STATEMENT', // prior auth/care management limits may apply
  'IN_NETWORK_OPTION_STATEMENT', // option to select an in-network provider
  'CONSENT_OPTIONAL_STATEMENT', // consent is optional; may revoke before service
  'ITEMS_SERVICES_LIST', // list of items/services covered by the notice
  'COST_SHARING_DISCLAIMER', // estimate is not a contract; actual may differ
  'PLAN_CONTACT_INFO', // how to contact the plan/issuer for in-network options
] as const;
export type RequiredNoticeElement = (typeof REQUIRED_NOTICE_ELEMENTS)[number];

export interface NoticeTimingInput {
  scheduledAt: Date;
  serviceAt: Date;
  noticeDeliveredAt: Date;
  consentSignedAt?: Date;
  /**
   * W4-F7: IANA timezone used for the statutory "day of scheduling"
   * comparison (149.420(d)). The previous implementation compared raw UTC
   * calendar days, which mis-classified same-local-day pairs near midnight
   * UTC. Supply the facility's local timezone (e.g. 'America/Chicago');
   * defaults to 'UTC' and emits a warning because UTC is rarely the correct
   * civil day for a US facility.
   */
  timeZone?: string;
}

export interface NoticeTimingResult {
  compliant: boolean;
  noticeHoursBeforeService: number;
  consentHoursBeforeService: number | null;
  violations: string[];
  /** Non-fatal advisories (e.g. default timezone in use). */
  warnings: string[];
  /** Effective timezone used for the day-of-scheduling comparison. */
  timeZone: string;
}

function hoursBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / (60 * 60 * 1000);
}

/** YYYY-MM-DD civil date of `d` in the given IANA timezone (en-CA locale). */
export function civilDateKey(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Resolve + validate an IANA timezone identifier; throws on garbage input. */
export function resolveTimeZone(timeZone?: string): { timeZone: string; warning: string | null } {
  if (timeZone === undefined || timeZone.trim() === '') {
    return {
      timeZone: 'UTC',
      warning:
        "No timeZone supplied; defaulting to 'UTC' for the day-of-scheduling " +
        'comparison (45 CFR 149.420(d)). Supply the facility local IANA ' +
        "timezone (e.g. 'America/Chicago') — UTC civil dates can straddle the " +
        'local statutory day.',
    };
  }
  const tz = timeZone.trim();
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
  } catch {
    throw new Error(`timeZone must be a valid IANA timezone identifier; got '${tz}'`);
  }
  return { timeZone: tz, warning: null };
}

/**
 * Validates the 72-hour / same-day / 3-hour timing rules of 149.420(c)-(d).
 * - Appointment scheduled >= 72h before service: notice >= 72h before service.
 * - Appointment scheduled < 72h before service (incl. same-day): notice on the
 *   day of scheduling and consent >= 3h before the service.
 * Notice must always be delivered before consent is signed.
 */
export function validateNoticeTiming(input: NoticeTimingInput): NoticeTimingResult {
  const { scheduledAt, serviceAt, noticeDeliveredAt, consentSignedAt } = input;
  for (const [name, d] of [
    ['scheduledAt', scheduledAt],
    ['serviceAt', serviceAt],
    ['noticeDeliveredAt', noticeDeliveredAt],
  ] as const) {
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
      throw new Error(`${name} must be a valid Date`);
    }
  }
  if (serviceAt <= scheduledAt) {
    throw new Error('serviceAt must be after scheduledAt');
  }

  const violations: string[] = [];
  const warnings: string[] = [];
  // W4-F7: day-of-scheduling comparison in the caller-supplied civil timezone.
  const { timeZone, warning } = resolveTimeZone(input.timeZone);
  if (warning) warnings.push(warning);
  const schedulingHorizonHours = hoursBetween(scheduledAt, serviceAt);
  const noticeHours = hoursBetween(noticeDeliveredAt, serviceAt);
  let consentHours: number | null = null;

  if (schedulingHorizonHours >= NOTICE_HOURS_WHEN_SCHEDULED_EARLY) {
    if (noticeHours < NOTICE_HOURS_WHEN_SCHEDULED_EARLY) {
      violations.push(
        `Notice delivered ${noticeHours.toFixed(2)}h before service; required ` +
          `>= ${NOTICE_HOURS_WHEN_SCHEDULED_EARLY}h when the appointment is ` +
          `scheduled >= ${NOTICE_HOURS_WHEN_SCHEDULED_EARLY}h in advance ` +
          '(45 CFR 149.420(c)).',
      );
    }
  } else {
    // Scheduled within 72 hours: notice must be given on the day of scheduling
    // (civil day in the effective timezone — NOT raw UTC getters).
    const sameDay =
      civilDateKey(noticeDeliveredAt, timeZone) === civilDateKey(scheduledAt, timeZone);
    if (!sameDay) {
      violations.push(
        'Appointment scheduled within 72 hours of service: notice must be ' +
          'delivered on the day of scheduling (45 CFR 149.420(d)).',
      );
    }
    if (consentSignedAt !== undefined) {
      consentHours = hoursBetween(consentSignedAt, serviceAt);
      if (consentHours < CONSENT_MIN_HOURS_BEFORE_SERVICE) {
        violations.push(
          `Consent signed ${consentHours.toFixed(2)}h before service; required ` +
            `>= ${CONSENT_MIN_HOURS_BEFORE_SERVICE}h when scheduled within 72h ` +
            '(45 CFR 149.420(d)).',
        );
      }
    }
  }

  if (consentSignedAt !== undefined && consentSignedAt < noticeDeliveredAt) {
    violations.push('Consent signed before the notice was delivered.');
  }

  return {
    compliant: violations.length === 0,
    noticeHoursBeforeService: noticeHours,
    consentHoursBeforeService: consentHours,
    violations,
    warnings,
    timeZone,
  };
}

/**
 * Validates that the notice contains every required content element.
 *
 * W4-F1: accepts an optional `language` (IANA code from shared/i18n/notices).
 * The required set is the elements AVAILABLE in the matching language's
 * dictionary — an element whose statutory text has no translation in the
 * requested language is reported missing (fail closed), so a document can
 * never be certified in a language whose text blocks are incomplete. An
 * unsupported language yields every element missing (fail closed).
 */
export function validateNoticeContent(
  elementsProvided: readonly string[],
  language?: string,
): { complete: boolean; missing: RequiredNoticeElement[]; language: string } {
  const provided = new Set(elementsProvided.map((e) => e.trim().toUpperCase()));
  const available = new Set(availableNoticeElements(language));
  const effectiveLanguage = isNoticeLanguage(language) ? language : DEFAULT_NOTICE_LANGUAGE;
  const missing =
    language !== undefined && !isNoticeLanguage(language)
      ? [...REQUIRED_NOTICE_ELEMENTS] // unsupported language: fail closed
      : REQUIRED_NOTICE_ELEMENTS.filter((e) => !provided.has(e) || !available.has(e));
  return { complete: missing.length === 0, missing, language: effectiveLanguage };
}

/**
 * W4-F3: consent expiry rule (documented; no fixed federal expiry exists).
 * A signed consent EXPIRES — requiring re-execution — when EITHER:
 *   1. The service is rescheduled beyond the noticed service window (the
 *      consent is specific to the noticed items/services and appointment
 *      date, 45 CFR 149.420(c)(2)(ii)); OR
 *   2. CONSENT_MAX_VALIDITY_DAYS calendar days elapsed since the consent was
 *      signed (documented conservative ceiling; tighten, never loosen).
 */
export const CONSENT_MAX_VALIDITY_DAYS = 90;

export interface ConsentExpiryInput {
  /** When the consent was signed (falls back to notice delivery when unsigned). */
  consentSignedAt?: Date;
  noticeDeliveredAt: Date;
  /** Service date stated in the notice. */
  noticedServiceAt: Date;
  /** Currently scheduled service date (after any rescheduling). */
  currentServiceAt?: Date;
  /** Reference instant; defaults to now. */
  asOf?: Date;
}

export interface ConsentExpiryResult {
  expired: boolean;
  reasons: string[];
}

function isValidDate(d: unknown): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

/** Pure expiry predicate (fail closed on corrupt dates → expired). */
export function evaluateConsentExpiry(input: ConsentExpiryInput): ConsentExpiryResult {
  const asOf = input.asOf ?? new Date();
  const reasons: string[] = [];

  if (!isValidDate(input.noticeDeliveredAt) || !isValidDate(input.noticedServiceAt)) {
    return { expired: true, reasons: ['Notice dates invalid; failing closed to expired.'] };
  }

  // Rule 1: rescheduled beyond the noticed service window.
  if (input.currentServiceAt && isValidDate(input.currentServiceAt)) {
    if (input.currentServiceAt.getTime() > input.noticedServiceAt.getTime()) {
      reasons.push(
        `Service rescheduled from ${input.noticedServiceAt.toISOString()} to ` +
          `${input.currentServiceAt.toISOString()} — beyond the service window stated ` +
          'in the notice; the notice and consent must be re-executed ' +
          '(45 CFR 149.420(c)(2)(ii)).',
      );
    }
  }

  // Rule 2: N-day ceiling from signature (or delivery when unsigned).
  const basis =
    input.consentSignedAt && isValidDate(input.consentSignedAt)
      ? input.consentSignedAt
      : input.noticeDeliveredAt;
  const ageDays = Math.floor((asOf.getTime() - basis.getTime()) / (24 * 60 * 60 * 1000));
  if (ageDays > CONSENT_MAX_VALIDITY_DAYS) {
    reasons.push(
      `Consent basis date ${basis.toISOString()} is ${ageDays} days old; the ` +
        `documented validity ceiling is ${CONSENT_MAX_VALIDITY_DAYS} days.`,
    );
  }

  return { expired: reasons.length > 0, reasons };
}

/** Compute the end of the 7-year document-retention window. */
export function retentionUntil(signedAt: Date): Date {
  if (!(signedAt instanceof Date) || Number.isNaN(signedAt.getTime())) {
    throw new Error('signedAt must be a valid Date');
  }
  const until = new Date(signedAt.getTime());
  until.setUTCFullYear(until.getUTCFullYear() + RETENTION_YEARS);
  return until;
}
