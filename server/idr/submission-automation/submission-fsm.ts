/**
 * submission-fsm.ts
 *
 * Submission lifecycle state machine for the assisted-manual IDR portal
 * workflow. Fail-closed: only the transitions declared in the guard table
 * are permitted; anything else throws with the current and attempted state.
 *
 * Honest assisted-manual model: the SUBMITTED transition requires a human
 * attestation payload confirming the package was entered into idr.cms.gov
 * by a person. This service never submits anything itself.
 */

export type SubmissionState =
  | 'DRAFT'
  | 'PACKAGE_READY'
  | 'SUBMITTED'
  | 'ACKNOWLEDGED'
  | 'IDRE_ASSIGNED'
  | 'OFFER_SUBMITTED'
  | 'DETERMINATION_RECEIVED'
  | 'PAYMENT_TRACKING'
  | 'CLOSED'
  | 'WITHDRAWN';

export interface AttestationPayload {
  actorId: string;
  attestedAt: string; // ISO timestamp
  portalConfirmationText?: string;
}

export interface SubmissionEvent {
  seq: number;
  from: SubmissionState | null;
  to: SubmissionState;
  at: string;
  actorId?: string;
  detail?: string;
}

export interface SubmissionEntity {
  disputeId: string;
  tenantId: string;
  state: SubmissionState;
  events: SubmissionEvent[];
  cmsDisputeReferenceNumber?: string;
  attestation?: AttestationPayload;
}

const PRE_DETERMINATION: SubmissionState[] = [
  'DRAFT',
  'PACKAGE_READY',
  'SUBMITTED',
  'ACKNOWLEDGED',
  'IDRE_ASSIGNED',
  'OFFER_SUBMITTED',
];

/** Guard table: allowed forward transitions. WITHDRAWN handled separately. */
const GUARD_TABLE: Record<SubmissionState, SubmissionState[]> = {
  DRAFT: ['PACKAGE_READY'],
  PACKAGE_READY: ['SUBMITTED'],
  SUBMITTED: ['ACKNOWLEDGED'],
  ACKNOWLEDGED: ['IDRE_ASSIGNED'],
  IDRE_ASSIGNED: ['OFFER_SUBMITTED'],
  OFFER_SUBMITTED: ['DETERMINATION_RECEIVED'],
  DETERMINATION_RECEIVED: ['PAYMENT_TRACKING'],
  PAYMENT_TRACKING: ['CLOSED'],
  CLOSED: [],
  WITHDRAWN: [],
};

export function createSubmission(disputeId: string, tenantId: string, now?: Date): SubmissionEntity {
  const at = (now ?? new Date()).toISOString();
  return {
    disputeId,
    tenantId,
    state: 'DRAFT',
    events: [{ seq: 0, from: null, to: 'DRAFT', at, detail: 'submission created' }],
  };
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly currentState: SubmissionState,
    public readonly attemptedState: SubmissionState,
    reason?: string
  ) {
    super(
      `Invalid transition: ${currentState} -> ${attemptedState}` + (reason ? ` (${reason})` : '')
    );
    this.name = 'InvalidTransitionError';
  }
}

function assertGuard(entity: SubmissionEntity, to: SubmissionState): void {
  if (to === 'WITHDRAWN') {
    if (!PRE_DETERMINATION.includes(entity.state)) {
      throw new InvalidTransitionError(
        entity.state,
        to,
        'WITHDRAWN only reachable before DETERMINATION_RECEIVED'
      );
    }
    return;
  }
  const allowed = GUARD_TABLE[entity.state] ?? [];
  if (!allowed.includes(to)) {
    throw new InvalidTransitionError(entity.state, to);
  }
}

function appendEvent(
  entity: SubmissionEntity,
  to: SubmissionState,
  at: string,
  actorId?: string,
  detail?: string
): void {
  entity.events.push({
    seq: entity.events.length,
    from: entity.state,
    to,
    at,
    actorId,
    detail,
  });
  entity.state = to;
}

export function transition(
  entity: SubmissionEntity,
  to: SubmissionState,
  opts: {
    actorId?: string;
    now?: Date;
    attestation?: AttestationPayload;
    cmsDisputeReferenceNumber?: string;
    detail?: string;
  } = {}
): SubmissionEntity {
  assertGuard(entity, to);
  const at = (opts.now ?? new Date()).toISOString();

  if (to === 'SUBMITTED') {
    const a = opts.attestation;
    if (!a || typeof a.actorId !== 'string' || a.actorId.trim().length === 0) {
      throw new InvalidTransitionError(
        entity.state,
        to,
        'SUBMITTED requires attestation { actorId, attestedAt } — human portal entry confirmation'
      );
    }
    if (typeof a.attestedAt !== 'string' || a.attestedAt.trim().length === 0 || isNaN(Date.parse(a.attestedAt))) {
      throw new InvalidTransitionError(entity.state, to, 'attestation.attestedAt must be a valid ISO timestamp');
    }
    entity.attestation = a;
  }

  if (to === 'ACKNOWLEDGED') {
    const ref = opts.cmsDisputeReferenceNumber;
    if (typeof ref !== 'string' || ref.trim().length === 0) {
      throw new InvalidTransitionError(
        entity.state,
        to,
        'ACKNOWLEDGED requires a non-empty cmsDisputeReferenceNumber'
      );
    }
    entity.cmsDisputeReferenceNumber = ref.trim();
  }

  appendEvent(entity, to, at, opts.actorId ?? opts.attestation?.actorId, opts.detail);
  return entity;
}

/** Append-only: returns a defensive copy of the event log. */
export function getEventLog(entity: SubmissionEntity): ReadonlyArray<SubmissionEvent> {
  return entity.events.map((e) => ({ ...e }));
}
