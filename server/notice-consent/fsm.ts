/**
 * Notice & Consent lifecycle FSM — 45 CFR 149.410–450.
 *
 * States:
 *   NOTICE_REQUIRED → NOTICE_DELIVERED → CONSENT_SIGNED → SERVICE_RENDERED
 *   NOTICE_REQUIRED/NOTICE_DELIVERED/CONSENT_SIGNED → CONSENT_REVOKED
 *   NOTICE_REQUIRED/NOTICE_DELIVERED/CONSENT_SIGNED → WAIVED_IMPOSSIBLE
 *     (when the item/service is found non-waivable; balance billing prohibited)
 *   NOTICE_DELIVERED/CONSENT_SIGNED → NOTICE_EXPIRED (service rescheduled beyond
 *     the consent validity window — notice/consent must be re-executed)
 *
 * Guards (fail-closed):
 * - NOTICE_REQUIRED → NOTICE_DELIVERED requires all REQUIRED_NOTICE_ELEMENTS.
 * - NOTICE_DELIVERED → CONSENT_SIGNED requires waiver eligibility = WAIVABLE,
 *   timing compliance per 149.420(c)-(d), and consent after notice.
 * - SERVICE_RENDERED only from CONSENT_SIGNED.
 * - Revocation is permitted any time before the service is furnished
 *   (149.420(f)); never after SERVICE_RENDERED.
 * - Invalid transitions throw.
 */

import {
  evaluateWaiverEligibility,
  evaluateConsentExpiry,
  validateNoticeContent,
  validateNoticeTiming,
  retentionUntil,
  type WaiverEligibilityInput,
  type NoticeTimingInput,
} from './waiver';

export type NcState =
  | 'NOTICE_REQUIRED'
  | 'NOTICE_DELIVERED'
  | 'CONSENT_SIGNED'
  | 'SERVICE_RENDERED'
  | 'CONSENT_REVOKED'
  | 'NOTICE_EXPIRED'
  | 'WAIVED_IMPOSSIBLE';

export interface NcEvent {
  type: 'TRANSITION' | 'GUARD_REJECTION' | 'RETENTION_COMPUTED';
  at: Date;
  from?: NcState;
  to?: NcState;
  detail?: string;
}

export interface NoticeConsentCase {
  id: string;
  state: NcState;
  waiverInput: WaiverEligibilityInput;
  timing: NoticeTimingInput;
  noticeElements: readonly string[];
  /**
   * W4-F1: language of the statutory notice document ('en' | 'es', ...).
   * Defaults to 'en'; validated against shared/i18n/notices dictionaries.
   */
  language: string;
  /**
   * W4-F3: service date stated in the notice, frozen at NOTICE_DELIVERED.
   * Expiry rule 1 compares the CURRENT timing.serviceAt (mutable via
   * rescheduleService) against this frozen date.
   */
  noticedServiceAt?: Date;
  /** Set when consent is signed; documents must be retained until this date. */
  retentionUntil: Date | null;
  /**
   * W4-F4: tamper-evident e-signature artifact (sha256 of
   * {caseId, signerName, timestamp, ip?}), set by patientSignConsent.
   * Structural type mirrors server/notice-consent/signature.ts (kept as a
   * plain record to avoid a module cycle).
   */
  signatureArtifact?: {
    caseId: string;
    signerName: string;
    signatureText: string;
    attestation: boolean;
    timestamp: string;
    ip?: string;
    artifactHash: string;
  };
  /** Append-only event log. */
  events: readonly NcEvent[];
}

const ALLOWED: Record<NcState, readonly NcState[]> = {
  NOTICE_REQUIRED: ['NOTICE_DELIVERED', 'WAIVED_IMPOSSIBLE'],
  NOTICE_DELIVERED: ['CONSENT_SIGNED', 'CONSENT_REVOKED', 'NOTICE_EXPIRED', 'WAIVED_IMPOSSIBLE'],
  CONSENT_SIGNED: ['SERVICE_RENDERED', 'CONSENT_REVOKED', 'NOTICE_EXPIRED'],
  SERVICE_RENDERED: [],
  CONSENT_REVOKED: [],
  NOTICE_EXPIRED: [],
  WAIVED_IMPOSSIBLE: [],
};

export function createNoticeConsentCase(init: {
  id: string;
  waiverInput: WaiverEligibilityInput;
  timing: NoticeTimingInput;
  noticeElements: readonly string[];
  language?: string;
}): NoticeConsentCase {
  if (!init.id) throw new Error('id is required');
  return {
    id: init.id,
    state: 'NOTICE_REQUIRED',
    waiverInput: init.waiverInput,
    timing: init.timing,
    noticeElements: init.noticeElements,
    language: init.language ?? 'en',
    retentionUntil: null,
    events: [],
  };
}

function appendEvent(c: NoticeConsentCase, event: NcEvent): NoticeConsentCase {
  return { ...c, events: [...c.events, event] };
}

export function transition(
  c: NoticeConsentCase,
  to: NcState,
  options: { now?: Date; currentServiceAt?: Date } = {},
): NoticeConsentCase {
  const now = options.now ?? new Date();
  const from = c.state;

  if (!ALLOWED[from].includes(to)) {
    throw new Error(`Invalid notice-consent transition: ${from} -> ${to}`);
  }

  let next: NoticeConsentCase = { ...c };

  if (to === 'NOTICE_DELIVERED') {
    const content = validateNoticeContent(c.noticeElements, c.language);
    if (!content.complete) {
      throw new Error(
        `Notice incomplete (45 CFR 149.420(c); language ${content.language}); ` +
          `missing elements: ${content.missing.join(', ')}`,
      );
    }
    // Freeze the noticed service date for later reschedule/expiry comparison.
    next = { ...next, noticedServiceAt: c.noticedServiceAt ?? c.timing.serviceAt };
  }

  if (to === 'CONSENT_SIGNED') {
    const eligibility = evaluateWaiverEligibility(c.waiverInput);
    if (!eligibility.waivable) {
      next = appendEvent(next, {
        type: 'GUARD_REJECTION',
        at: now,
        from,
        to,
        detail: `Non-waivable (${eligibility.eligibility}): ${eligibility.reason}`,
      });
      throw new Error(
        'Notice-and-consent exception unavailable: ' + eligibility.reason,
      );
    }
    const timing = validateNoticeTiming(c.timing);
    if (!timing.compliant) {
      next = appendEvent(next, {
        type: 'GUARD_REJECTION',
        at: now,
        from,
        to,
        detail: timing.violations.join(' | '),
      });
      throw new Error(
        'Notice/consent timing non-compliant (45 CFR 149.420(c)-(d)): ' +
          timing.violations.join('; '),
      );
    }
    if (c.timing.consentSignedAt === undefined) {
      throw new Error('consentSignedAt is required to record a signed consent');
    }
    const retainUntil = retentionUntil(c.timing.consentSignedAt);
    next = appendEvent(next, {
      type: 'RETENTION_COMPUTED',
      at: now,
      detail: `Signed notice-and-consent documents must be retained until ` +
        `${retainUntil.toISOString()} (7-year retention, 26 CFR 54.9816-7).`,
    });
    next = { ...next, retentionUntil: retainUntil };
  }

  if (to === 'NOTICE_EXPIRED') {
    // W4-F3: fail closed — only a genuinely expired consent may flip.
    const verdict = evaluateConsentExpiry({
      consentSignedAt: c.timing.consentSignedAt,
      noticeDeliveredAt: c.timing.noticeDeliveredAt,
      noticedServiceAt: c.noticedServiceAt ?? c.timing.serviceAt,
      currentServiceAt: options.currentServiceAt ?? c.timing.serviceAt,
      asOf: now,
    });
    if (!verdict.expired) {
      throw new Error(
        'NOTICE_EXPIRED requires an expired consent (rescheduled beyond the ' +
          'noticed service window or past the 90-day validity ceiling); no ' +
          'expiry condition is currently met.',
      );
    }
    next = appendEvent(next, {
      type: 'GUARD_REJECTION',
      at: now,
      from,
      to,
      detail: `Consent expired: ${verdict.reasons.join(' | ')}`,
    });
  }

  if (to === 'WAIVED_IMPOSSIBLE') {
    const eligibility = evaluateWaiverEligibility(c.waiverInput);
    if (eligibility.waivable) {
      throw new Error(
        'WAIVED_IMPOSSIBLE is only valid when the item/service is non-waivable; ' +
          `current evaluation: ${eligibility.eligibility}`,
      );
    }
  }

  next = appendEvent(next, { type: 'TRANSITION', at: now, from, to });
  return { ...next, state: to };
}
