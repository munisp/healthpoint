import { describe, it, expect } from 'vitest';
import { createPaRequest, transition, denialReasonRequired, type PaRequest } from './fsm';

function submittedRequest(overrides: Partial<Parameters<typeof createPaRequest>[0]> = {}, submittedAt = new Date('2026-03-01T00:00:00Z')): PaRequest {
  const req = createPaRequest({ id: 'pa-1', payerType: 'MA', urgency: 'STANDARD', ...overrides });
  return transition(req, 'SUBMITTED', { now: submittedAt });
}

describe('FSM happy path', () => {
  it('walks DRAFT → SUBMITTED → PENDED_INFO → APPROVED → CLOSED', () => {
    let r = createPaRequest({ id: 'pa-1', payerType: 'MA', urgency: 'STANDARD' });
    expect(r.state).toBe('DRAFT');
    r = transition(r, 'SUBMITTED', { now: new Date('2026-03-01T00:00:00Z') });
    r = transition(r, 'PENDED_INFO', { now: new Date('2026-03-02T00:00:00Z') });
    r = transition(r, 'APPROVED', { now: new Date('2026-03-03T00:00:00Z') });
    expect(r.decidedAt!.toISOString()).toBe('2026-03-03T00:00:00.000Z');
    r = transition(r, 'CLOSED', { now: new Date('2026-03-04T00:00:00Z') });
    expect(r.state).toBe('CLOSED');
  });

  it('DENIED → APPEAL_ROUTED → CLOSED with reason', () => {
    let r = submittedRequest();
    r = transition(r, 'DENIED', { now: new Date('2026-03-02T00:00:00Z'), denialReason: 'Not medically necessary per policy X' });
    expect(r.denialReason).toBe('Not medically necessary per policy X');
    r = transition(r, 'APPEAL_ROUTED', { now: new Date('2026-03-03T00:00:00Z') });
    r = transition(r, 'CLOSED', { now: new Date('2026-03-05T00:00:00Z') });
    expect(r.state).toBe('CLOSED');
  });

  it('CANCELLED allowed from DRAFT and SUBMITTED only', () => {
    let r = createPaRequest({ id: 'pa-1', payerType: 'MA', urgency: 'STANDARD' });
    r = transition(r, 'CANCELLED');
    expect(r.state).toBe('CANCELLED');
    const s = submittedRequest({ id: 'pa-2' });
    expect(transition(s, 'CANCELLED').state).toBe('CANCELLED');
  });
});

describe('FSM guards', () => {
  it('invalid transition throws (DRAFT → APPROVED)', () => {
    const r = createPaRequest({ id: 'pa-1', payerType: 'MA', urgency: 'STANDARD' });
    expect(() => transition(r, 'APPROVED')).toThrow(/Invalid PA transition/);
  });

  it('invalid transition throws from terminal CLOSED', () => {
    let r = submittedRequest();
    r = transition(r, 'APPROVED', { now: new Date('2026-03-02T00:00:00Z') });
    r = transition(r, 'CLOSED');
    expect(() => transition(r, 'SUBMITTED')).toThrow(/Invalid PA transition/);
  });

  it('CANCELLED not allowed from PENDED_INFO', () => {
    let r = submittedRequest();
    r = transition(r, 'PENDED_INFO');
    expect(() => transition(r, 'CANCELLED')).toThrow(/Invalid PA transition/);
  });

  it('DENIED without reason is rejected for impacted payer submitted >= 2026-01-01 (fail-closed)', () => {
    const r = submittedRequest();
    expect(() => transition(r, 'DENIED', { now: new Date('2026-03-02T00:00:00Z') })).toThrow(/denialReason/);
    expect(() => transition(r, 'DENIED', { now: new Date('2026-03-02T00:00:00Z'), denialReason: '   ' })).toThrow(/denialReason/);
  });

  it('DENIED without reason also rejected for QHP_FFE (denial-reason provision applies)', () => {
    const r = submittedRequest({ payerType: 'QHP_FFE' });
    expect(denialReasonRequired(r)).toBe(true);
    expect(() => transition(r, 'DENIED', { now: new Date('2026-03-02T00:00:00Z') })).toThrow(/denialReason/);
  });

  it('DENIED without reason allowed for pre-2026 submission', () => {
    const r = submittedRequest({}, new Date('2025-06-01T00:00:00Z'));
    expect(denialReasonRequired(r)).toBe(false);
    const denied = transition(r, 'DENIED', { now: new Date('2025-06-02T00:00:00Z') });
    expect(denied.state).toBe('DENIED');
    expect(denied.denialReason).toBeNull();
  });
});

describe('clock breach integration', () => {
  it('breach event appended when standard decision exceeds 7 calendar days', () => {
    const r = submittedRequest({ urgency: 'STANDARD' }, new Date('2026-03-01T00:00:00Z'));
    const late = transition(r, 'APPROVED', { now: new Date('2026-03-08T00:00:01Z') });
    const breaches = late.events.filter((e) => e.type === 'CLOCK_BREACH');
    expect(breaches).toHaveLength(1);
    expect(breaches[0].detail).toContain('7-calendar-day');
  });

  it('breach event appended when expedited decision exceeds 72 hours', () => {
    const r = submittedRequest({ urgency: 'EXPEDITED' }, new Date('2026-03-01T00:00:00Z'));
    const late = transition(r, 'APPROVED', { now: new Date('2026-03-04T00:00:01Z') });
    expect(late.events.some((e) => e.type === 'CLOCK_BREACH' && e.detail!.includes('72-hour'))).toBe(true);
  });

  it('no breach event when decided within the clock', () => {
    const r = submittedRequest({ urgency: 'EXPEDITED' }, new Date('2026-03-01T00:00:00Z'));
    const ok = transition(r, 'APPROVED', { now: new Date('2026-03-03T23:59:59Z') });
    expect(ok.events.filter((e) => e.type === 'CLOCK_BREACH')).toHaveLength(0);
  });

  it('no breach event for QHP_FFE (NOT_SUBJECT) even when late', () => {
    const r = submittedRequest({ payerType: 'QHP_FFE' }, new Date('2026-03-01T00:00:00Z'));
    const late = transition(r, 'APPROVED', { now: new Date('2026-06-01T00:00:00Z') });
    expect(late.events.filter((e) => e.type === 'CLOCK_BREACH')).toHaveLength(0);
  });

  it('event log is append-only across transitions', () => {
    let r = submittedRequest();
    const before = r.events.length;
    r = transition(r, 'PENDED_INFO');
    expect(r.events.length).toBe(before + 1);
    expect(r.events[0].type).toBe('TRANSITION');
  });
});
