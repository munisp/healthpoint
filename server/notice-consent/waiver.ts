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
  | 'NON_EMERGENCY';

export type WaiverEligibility =
  | 'WAIVABLE'
  | 'NON_WAIVABLE_EMERGENCY'
  | 'NON_WAIVABLE_ANCILLARY'
  | 'NON_WAIVABLE_DIAGNOSTIC'
  | 'NON_WAIVABLE_UNFORESEEN'
  | 'NON_WAIVABLE_NO_IN_NETWORK_AVAILABLE'
  | 'NON_WAIVABLE_IN_NETWORK_PROVIDER';

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
}

export interface NoticeTimingResult {
  compliant: boolean;
  noticeHoursBeforeService: number;
  consentHoursBeforeService: number | null;
  violations: string[];
}

function hoursBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / (60 * 60 * 1000);
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
    // Scheduled within 72 hours: notice must be given on the day of scheduling.
    const sameDay =
      noticeDeliveredAt.getUTCFullYear() === scheduledAt.getUTCFullYear() &&
      noticeDeliveredAt.getUTCMonth() === scheduledAt.getUTCMonth() &&
      noticeDeliveredAt.getUTCDate() === scheduledAt.getUTCDate();
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
  };
}

/** Validates that the notice contains every required content element. */
export function validateNoticeContent(
  elementsProvided: readonly string[],
): { complete: boolean; missing: RequiredNoticeElement[] } {
  const provided = new Set(elementsProvided.map((e) => e.trim().toUpperCase()));
  const missing = REQUIRED_NOTICE_ELEMENTS.filter((e) => !provided.has(e));
  return { complete: missing.length === 0, missing };
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
