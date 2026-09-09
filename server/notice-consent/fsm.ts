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
  /** Set when consent is signed; documents must be retained until this date. */
  retentionUntil: Date | null;
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
}): NoticeConsentCase {
  if (!init.id) throw new Error('id is required');
  return {
    id: init.id,
    state: 'NOTICE_REQUIRED',
    waiverInput: init.waiverInput,
    timing: init.timing,
    noticeElements: init.noticeElements,
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
  options: { now?: Date } = {},
): NoticeConsentCase {
  const now = options.now ?? new Date();
  const from = c.state;

  if (!ALLOWED[from].includes(to)) {
    throw new Error(`Invalid notice-consent transition: ${from} -> ${to}`);
  }

  let next: NoticeConsentCase = { ...c };

  if (to === 'NOTICE_DELIVERED') {
    const content = validateNoticeContent(c.noticeElements);
    if (!content.complete) {
      throw new Error(
        `Notice incomplete (45 CFR 149.420(c)); missing elements: ${content.missing.join(', ')}`,
      );
    }
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
