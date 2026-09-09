import { describe, it, expect } from 'vitest';
import {
  createSubmission,
  transition,
  getEventLog,
  InvalidTransitionError,
  SubmissionEntity,
} from './submission-fsm';

const ATTEST = { actorId: 'user-42', attestedAt: '2026-09-05T12:00:00.000Z', portalConfirmationText: 'IDR-2026-123456' };

function toReady(): SubmissionEntity {
  const e = createSubmission('D-1', 'T-1');
  transition(e, 'PACKAGE_READY');
  return e;
}

function toSubmitted(): SubmissionEntity {
  const e = toReady();
  transition(e, 'SUBMITTED', { attestation: ATTEST });
  return e;
}

describe('submission-fsm', () => {
  it('starts in DRAFT with creation event', () => {
    const e = createSubmission('D-1', 'T-1');
    expect(e.state).toBe('DRAFT');
    expect(e.events[0].to).toBe('DRAFT');
  });

  it('walks the happy path to CLOSED', () => {
    const e = createSubmission('D-1', 'T-1');
    transition(e, 'PACKAGE_READY');
    transition(e, 'SUBMITTED', { attestation: ATTEST });
    transition(e, 'ACKNOWLEDGED', { cmsDisputeReferenceNumber: 'IDR-2026-123456' });
    transition(e, 'IDRE_ASSIGNED');
    transition(e, 'OFFER_SUBMITTED');
    transition(e, 'DETERMINATION_RECEIVED');
    transition(e, 'PAYMENT_TRACKING');
    transition(e, 'CLOSED');
    expect(e.state).toBe('CLOSED');
    expect(e.events.length).toBe(9);
  });

  it('SUBMITTED without attestation throws', () => {
    const e = toReady();
    expect(() => transition(e, 'SUBMITTED')).toThrow(InvalidTransitionError);
    expect(e.state).toBe('PACKAGE_READY');
  });

  it('SUBMITTED with empty actorId throws', () => {
    const e = toReady();
    expect(() => transition(e, 'SUBMITTED', { attestation: { actorId: ' ', attestedAt: ATTEST.attestedAt } })).toThrow(/actorId/);
  });

  it('SUBMITTED with invalid attestedAt throws', () => {
    const e = toReady();
    expect(() => transition(e, 'SUBMITTED', { attestation: { actorId: 'u', attestedAt: 'not-a-date' } })).toThrow(InvalidTransitionError);
  });

  it('stores attestation on the entity', () => {
    const e = toSubmitted();
    expect(e.attestation?.actorId).toBe('user-42');
  });

  it('ACKNOWLEDGED requires non-empty reference number', () => {
    const e = toSubmitted();
    expect(() => transition(e, 'ACKNOWLEDGED', { cmsDisputeReferenceNumber: '  ' })).toThrow(/cmsDisputeReferenceNumber/);
    transition(e, 'ACKNOWLEDGED', { cmsDisputeReferenceNumber: ' IDR-X ' });
    expect(e.cmsDisputeReferenceNumber).toBe('IDR-X');
  });

  it('invalid skip transition throws with current+attempted state', () => {
    const e = createSubmission('D-1', 'T-1');
    expect(() => transition(e, 'SUBMITTED', { attestation: ATTEST })).toThrow(/DRAFT -> SUBMITTED/);
  });

  it('WITHDRAWN reachable from pre-determination states', () => {
    const e = toSubmitted();
    transition(e, 'WITHDRAWN');
    expect(e.state).toBe('WITHDRAWN');
  });

  it('WITHDRAWN NOT reachable from DETERMINATION_RECEIVED or later', () => {
    const e = toSubmitted();
    transition(e, 'ACKNOWLEDGED', { cmsDisputeReferenceNumber: 'IDR-X' });
    transition(e, 'IDRE_ASSIGNED');
    transition(e, 'OFFER_SUBMITTED');
    transition(e, 'DETERMINATION_RECEIVED');
    expect(() => transition(e, 'WITHDRAWN')).toThrow(/DETERMINATION_RECEIVED -> WITHDRAWN/);
  });

  it('CLOSED and WITHDRAWN are terminal', () => {
    const e = toReady();
    transition(e, 'WITHDRAWN');
    expect(() => transition(e, 'PACKAGE_READY')).toThrow(InvalidTransitionError);
  });

  it('event log is append-only and defensive-copied', () => {
    const e = toSubmitted();
    const log = getEventLog(e);
    expect(log.map((x) => x.to)).toEqual(['DRAFT', 'PACKAGE_READY', 'SUBMITTED']);
    (log as any).push({ to: 'HACK' });
    expect(e.events.length).toBe(3);
  });
});
