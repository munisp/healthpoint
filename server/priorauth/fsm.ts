/**
 * Prior Authorization lifecycle finite state machine (CMS-0057-F aligned).
 *
 * States: DRAFT → SUBMITTED → PENDED_INFO → APPROVED | DENIED → APPEAL_ROUTED → CLOSED
 * CANCELLED reachable from DRAFT and SUBMITTED only.
 *
 * Guards:
 * - Transition to DENIED requires a non-empty denialReason for impacted payers
 *   with submittedAt >= 2026-01-01 (CMS-0057-F denial-reason provision).
 *   Fail-closed: when in doubt, the reason is required.
 * - Transitions to APPROVED/DENIED record decidedAt and automatically evaluate
 *   the decision clock; breaches append an event to an append-only event log.
 * - Invalid transitions throw.
 */

import {
  computeDecisionDeadline,
  isBreach,
  CMS_0057F_OPERATIONAL_EFFECTIVE,
  type PayerType,
  type Urgency,
  type DecisionDeadlineResult,
} from './clocks';

export type PaState =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'PENDED_INFO'
  | 'APPROVED'
  | 'DENIED'
  | 'APPEAL_ROUTED'
  | 'CLOSED'
  | 'CANCELLED';

export interface PaEvent {
  type: 'TRANSITION' | 'CLOCK_BREACH';
  at: Date;
  from?: PaState;
  to?: PaState;
  detail?: string;
}

export interface PaRequest {
  id: string;
  state: PaState;
  payerType: PayerType;
  urgency: Urgency;
  submittedAt: Date | null;
  decidedAt: Date | null;
  denialReason: string | null;
  /** Append-only event log; never mutated in place by consumers. */
  events: readonly PaEvent[];
}

export interface TransitionOptions {
  now?: Date;
  denialReason?: string;
  enforcementDiscretion?: boolean;
}

const ALLOWED: Record<PaState, readonly PaState[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['PENDED_INFO', 'APPROVED', 'DENIED', 'CANCELLED'],
  PENDED_INFO: ['APPROVED', 'DENIED'],
  APPROVED: ['APPEAL_ROUTED', 'CLOSED'],
  DENIED: ['APPEAL_ROUTED', 'CLOSED'],
  APPEAL_ROUTED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
};

export function createPaRequest(init: {
  id: string;
  payerType: PayerType;
  urgency: Urgency;
}): PaRequest {
  if (!init.id) throw new Error('id is required');
  return {
    id: init.id,
    state: 'DRAFT',
    payerType: init.payerType,
    urgency: init.urgency,
    submittedAt: null,
    decidedAt: null,
    denialReason: null,
    events: [],
  };
}

/**
 * Denial-reason guard (fail-closed): a specific reason is required for
 * impacted payers once CMS-0057-F operational provisions are effective
 * (submittedAt >= 2026-01-01). Pre-2026 submissions are not under the
 * mandate. QHP_FFE is not subject to the timeframe provisions but IS subject
 * to the denial-reason provision per CMS-0057-F, so a reason is required for
 * all payer types once the rule is effective.
 */
export function denialReasonRequired(request: PaRequest): boolean {
  if (request.submittedAt === null) return false;
  if (request.submittedAt < CMS_0057F_OPERATIONAL_EFFECTIVE) return false;
  return true;
}

function appendEvent(request: PaRequest, event: PaEvent): PaRequest {
  return { ...request, events: [...request.events, event] };
}

export function transition(
  request: PaRequest,
  to: PaState,
  options: TransitionOptions = {},
): PaRequest {
  const now = options.now ?? new Date();
  const from = request.state;

  if (!ALLOWED[from].includes(to)) {
    throw new Error(`Invalid PA transition: ${from} -> ${to}`);
  }

  let next: PaRequest = { ...request };

  if (to === 'SUBMITTED') {
    next = { ...next, submittedAt: now };
  }

  if (to === 'APPROVED' || to === 'DENIED') {
    if (request.submittedAt === null) {
      // Defensive: SUBMITTED always sets submittedAt, but fail closed.
      throw new Error('Cannot decide a request that has no submittedAt timestamp');
    }

    if (to === 'DENIED') {
      const reason = options.denialReason?.trim() ?? '';
      if (denialReasonRequired(request) && reason.length === 0) {
        throw new Error(
          'CMS-0057-F: DENIED requires a specific, non-empty denialReason for ' +
            'impacted payers with submittedAt >= 2026-01-01 (fail-closed)',
        );
      }
      next = { ...next, denialReason: reason.length > 0 ? reason : null };
    }

    next = { ...next, decidedAt: now };

    // Automatic clock-breach evaluation.
    const clock: DecisionDeadlineResult = computeDecisionDeadline({
      urgency: request.urgency,
      payerType: request.payerType,
      submittedAt: request.submittedAt,
      enforcementDiscretion: options.enforcementDiscretion,
    });
    if (isBreach(clock, now)) {
      next = appendEvent(next, {
        type: 'CLOCK_BREACH',
        at: now,
        detail:
          `Decision at ${now.toISOString()} breached ${clock.basis} deadline ` +
          `${clock.deadline!.toISOString()}`,
      });
    }
  }

  next = appendEvent(next, { type: 'TRANSITION', at: now, from, to });
  return { ...next, state: to };
}
