import { describe, it, expect } from 'vitest';
import {
  computeDecisionDeadline,
  isBreach,
  nextEscalationAt,
  CMS_0057F_OPERATIONAL_EFFECTIVE,
} from './clocks';

const POST_2026 = new Date('2026-03-10T12:00:00Z');

describe('computeDecisionDeadline', () => {
  it('expedited: deadline is exactly 72 hours after submission', () => {
    const r = computeDecisionDeadline({ urgency: 'EXPEDITED', payerType: 'MA', submittedAt: POST_2026 });
    expect(r.basis).toBe('CMS-0057-F 72-hour');
    expect(r.deadline!.getTime()).toBe(POST_2026.getTime() + 72 * 3600 * 1000);
  });

  it('expedited boundary: isBreach false at 72h-1ms, true at exactly 72h', () => {
    const r = computeDecisionDeadline({ urgency: 'EXPEDITED', payerType: 'MA', submittedAt: POST_2026 });
    expect(isBreach(r, new Date(r.deadline!.getTime() - 1))).toBe(false);
    expect(isBreach(r, r.deadline!)).toBe(true);
  });

  it('standard: deadline is exactly 7 calendar days after submission', () => {
    const r = computeDecisionDeadline({ urgency: 'STANDARD', payerType: 'MEDICAID_FFS', submittedAt: POST_2026 });
    expect(r.basis).toBe('7-calendar-day');
    expect(r.deadline!.toISOString()).toBe('2026-03-17T12:00:00.000Z');
  });

  it('standard day-7 boundary: breach at day 7, not before', () => {
    const r = computeDecisionDeadline({ urgency: 'STANDARD', payerType: 'CHIP_MCO', submittedAt: POST_2026 });
    expect(isBreach(r, new Date('2026-03-17T11:59:59.999Z'))).toBe(false);
    expect(isBreach(r, new Date('2026-03-17T12:00:00.000Z'))).toBe(true);
  });

  it('standard calendar days cross month boundary without business-day adjustment', () => {
    const submitted = new Date('2026-02-26T09:30:00Z');
    const r = computeDecisionDeadline({ urgency: 'STANDARD', payerType: 'MEDICAID_MCO', submittedAt: submitted });
    expect(r.deadline!.toISOString()).toBe('2026-03-05T09:30:00.000Z');
  });

  it('QHP_FFE is NOT_SUBJECT with proposal note (CMS-0062-P not final)', () => {
    const r = computeDecisionDeadline({ urgency: 'EXPEDITED', payerType: 'QHP_FFE', submittedAt: POST_2026 });
    expect(r.basis).toBe('NOT_SUBJECT');
    expect(r.deadline).toBeNull();
    expect(r.notes).toContain('CMS-0062-P');
    expect(isBreach(r, new Date('2030-01-01T00:00:00Z'))).toBe(false);
  });

  it('pre-2026-01-01 submissions are NOT_SUBJECT', () => {
    const r = computeDecisionDeadline({
      urgency: 'STANDARD',
      payerType: 'MA',
      submittedAt: new Date('2025-12-31T23:59:59Z'),
    });
    expect(r.basis).toBe('NOT_SUBJECT');
    expect(r.deadline).toBeNull();
    expect(r.notes).toContain('2026-01-01');
  });

  it('submission exactly at 2026-01-01T00:00:00Z is subject', () => {
    const r = computeDecisionDeadline({
      urgency: 'EXPEDITED',
      payerType: 'MA',
      submittedAt: CMS_0057F_OPERATIONAL_EFFECTIVE,
    });
    expect(r.basis).toBe('CMS-0057-F 72-hour');
  });

  it('enforcement discretion config makes clock advisory (NOT_SUBJECT)', () => {
    const r = computeDecisionDeadline({
      urgency: 'STANDARD',
      payerType: 'CHIP_FFS',
      submittedAt: POST_2026,
      enforcementDiscretion: true,
    });
    expect(r.basis).toBe('NOT_SUBJECT');
    expect(r.notes.toLowerCase()).toContain('discretion');
  });

  it('nextEscalationAt equals deadline when subject, null when not', () => {
    const subject = computeDecisionDeadline({ urgency: 'EXPEDITED', payerType: 'MA', submittedAt: POST_2026 });
    expect(nextEscalationAt(subject)!.getTime()).toBe(subject.deadline!.getTime());
    const notSubject = computeDecisionDeadline({ urgency: 'EXPEDITED', payerType: 'QHP_FFE', submittedAt: POST_2026 });
    expect(nextEscalationAt(notSubject)).toBeNull();
  });

  it('throws on invalid submittedAt', () => {
    expect(() =>
      computeDecisionDeadline({ urgency: 'STANDARD', payerType: 'MA', submittedAt: new Date('nope') }),
    ).toThrow();
  });
});
