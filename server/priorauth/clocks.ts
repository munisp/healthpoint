/**
 * CMS-0057-F (Interoperability and Prior Authorization Final Rule, 89 FR,
 * published 2024-02-08) decision-clock engine.
 *
 * Operational provisions effective 2026-01-01: impacted payers must decide
 * expedited PA requests within 72 hours and standard requests within 7
 * calendar days.
 *
 * QHP-FFE exception: QHP issuers on Federally-Facilitated Exchanges are NOT
 * currently subject to the 72-hr / 7-day decision timeframes (CMS-0062-P
 * proposes to extend them; not final). They remain subject to denial-reason
 * and metrics/API provisions. This is modeled here, not hardcoded away.
 *
 * Enforcement discretion during 2026 is modeled via configurable options
 * (enforcementDiscretion), never hardcoded.
 */

export type Urgency = 'STANDARD' | 'EXPEDITED';
export type PayerType =
  | 'MA'
  | 'MEDICAID_FFS'
  | 'MEDICAID_MCO'
  | 'CHIP_FFS'
  | 'CHIP_MCO'
  | 'QHP_FFE';

export type DeadlineBasis = 'CMS-0057-F 72-hour' | '7-calendar-day' | 'NOT_SUBJECT';

export const CMS_0057F_OPERATIONAL_EFFECTIVE = new Date('2026-01-01T00:00:00Z');

export const EXPEDITED_HOURS = 72;
export const STANDARD_CALENDAR_DAYS = 7;

export interface ComputeDeadlineInput {
  urgency: Urgency;
  payerType: PayerType;
  submittedAt: Date;
  /** Reference date for determining rule applicability; defaults to submittedAt. */
  asOfDate?: Date;
  /**
   * Enforcement-discretion configuration. When true, decision timeframes are
   * treated as advisory (NOT_SUBJECT for clock purposes) during the discretion
   * window. Configurable per policy; not hardcoded.
   */
  enforcementDiscretion?: boolean;
}

export interface DecisionDeadlineResult {
  /** Decision deadline; null when the payer/request is not subject to a timeframe. */
  deadline: Date | null;
  basis: DeadlineBasis;
  notes: string;
}

const QHP_FFE_NOTE =
  'QHP-FFE issuers are not currently subject to CMS-0057-F 72-hour/7-day ' +
  'decision timeframes. CMS-0062-P proposes to extend these requirements to ' +
  'QHP-FFE issuers but is not final. Denial-reason and metrics/API provisions ' +
  'still apply.';

const PRE_2026_NOTE =
  'Request submitted before the CMS-0057-F operational effective date ' +
  '(2026-01-01); decision timeframes do not apply.';

const DISCRETION_NOTE =
  'Enforcement discretion is configured as active; decision clock is advisory ' +
  'and no breach deadline is computed. This is a configuration, not a ' +
  'regulatory exemption.';

export function computeDecisionDeadline(input: ComputeDeadlineInput): DecisionDeadlineResult {
  const { urgency, payerType, submittedAt } = input;
  if (!(submittedAt instanceof Date) || Number.isNaN(submittedAt.getTime())) {
    throw new Error('submittedAt must be a valid Date');
  }
  const asOf = input.asOfDate ?? submittedAt;

  if (submittedAt < CMS_0057F_OPERATIONAL_EFFECTIVE || asOf < CMS_0057F_OPERATIONAL_EFFECTIVE) {
    return { deadline: null, basis: 'NOT_SUBJECT', notes: PRE_2026_NOTE };
  }

  if (payerType === 'QHP_FFE') {
    return { deadline: null, basis: 'NOT_SUBJECT', notes: QHP_FFE_NOTE };
  }

  if (input.enforcementDiscretion === true) {
    return { deadline: null, basis: 'NOT_SUBJECT', notes: DISCRETION_NOTE };
  }

  if (urgency === 'EXPEDITED') {
    // Exact hour math: 72 hours from submission.
    const deadline = new Date(submittedAt.getTime() + EXPEDITED_HOURS * 60 * 60 * 1000);
    return {
      deadline,
      basis: 'CMS-0057-F 72-hour',
      notes:
        'Expedited PA request: impacted payer must decide within 72 hours of ' +
        'submission (CMS-0057-F, effective 2026-01-01).',
    };
  }

  // STANDARD: 7 calendar days — date math only, no business-day adjustment.
  const deadline = new Date(submittedAt.getTime());
  deadline.setUTCDate(deadline.getUTCDate() + STANDARD_CALENDAR_DAYS);
  return {
    deadline,
    basis: '7-calendar-day',
    notes:
      'Standard PA request: impacted payer must decide within 7 calendar days ' +
      'of submission (CMS-0057-F, effective 2026-01-01).',
  };
}

/** Returns true when `now` is at or past the deadline. NOT_SUBJECT never breaches. */
export function isBreach(result: DecisionDeadlineResult, now: Date): boolean {
  if (result.deadline === null) return false;
  return now.getTime() >= result.deadline.getTime();
}

/**
 * Next escalation timestamp. Escalate at the deadline itself when subject to a
 * timeframe; null otherwise (nothing to escalate against).
 */
export function nextEscalationAt(result: DecisionDeadlineResult): Date | null {
  return result.deadline;
}
