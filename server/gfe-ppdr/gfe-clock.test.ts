import { describe, it, expect } from 'vitest';
import {
  computeGfeDeadline,
  isGfeLate,
  classifyHorizon,
  addBusinessDays,
  businessDaysBetween,
  validateGfeContent,
  validateRecurringGfeWindow,
  REQUIRED_GFE_ELEMENTS,
} from './gfe-clock';

describe('business-day math', () => {
  it('addBusinessDays skips weekends', () => {
    // Friday 2026-03-06 → +1 business day = Monday 2026-03-09
    const r = addBusinessDays(new Date('2026-03-06T12:00:00Z'), 1);
    expect(r.toISOString().slice(0, 10)).toBe('2026-03-09');
  });

  it('addBusinessDays honors caller-supplied holidays', () => {
    const holidays = new Set(['2026-03-09']);
    const r = addBusinessDays(new Date('2026-03-06T12:00:00Z'), 1, holidays);
    expect(r.toISOString().slice(0, 10)).toBe('2026-03-10');
  });

  it('businessDaysBetween counts business days exclusive-of-start inclusive-of-end', () => {
    // Mon 2026-03-02 → Fri 2026-03-06 = 4
    expect(
      businessDaysBetween(new Date('2026-03-02T00:00:00Z'), new Date('2026-03-06T00:00:00Z')),
    ).toBe(4);
  });

  it('addBusinessDays(0) returns the start date', () => {
    const start = new Date('2026-03-06T12:00:00Z');
    expect(addBusinessDays(start, 0).getTime()).toBe(start.getTime());
  });
});

describe('classifyHorizon', () => {
  it('LONG when scheduled >=10 business days before service', () => {
    // Mon 2026-03-02 → Wed 2026-03-18: 12 business days
    expect(classifyHorizon(new Date('2026-03-02T09:00:00Z'), new Date('2026-03-18T09:00:00Z'))).toBe('LONG');
  });

  it('SHORT when scheduled 3–9 business days before service', () => {
    // Mon 2026-03-02 → Fri 2026-03-06: 4 business days
    expect(classifyHorizon(new Date('2026-03-02T09:00:00Z'), new Date('2026-03-06T09:00:00Z'))).toBe('SHORT');
  });

  it('IMMEDIATE when scheduled <3 business days before service', () => {
    expect(classifyHorizon(new Date('2026-03-05T09:00:00Z'), new Date('2026-03-06T09:00:00Z'))).toBe('IMMEDIATE');
  });

  it('throws when serviceAt is not after scheduledAt', () => {
    expect(() =>
      classifyHorizon(new Date('2026-03-06T09:00:00Z'), new Date('2026-03-06T09:00:00Z')),
    ).toThrow();
  });
});

describe('computeGfeDeadline (149.610(a)(2))', () => {
  it('LONG horizon: 3 business days after scheduling', () => {
    // Scheduled Mon 2026-03-02 → deadline Thu 2026-03-05
    const r = computeGfeDeadline({
      scheduledAt: new Date('2026-03-02T09:00:00Z'),
      serviceAt: new Date('2026-03-18T09:00:00Z'),
    });
    expect(r.horizon).toBe('LONG');
    expect(r.maxBusinessDays).toBe(3);
    expect(r.deadline.toISOString().slice(0, 10)).toBe('2026-03-05');
  });

  it('SHORT horizon: 1 business day after scheduling', () => {
    // Scheduled Mon 2026-03-02 → deadline Tue 2026-03-03
    const r = computeGfeDeadline({
      scheduledAt: new Date('2026-03-02T09:00:00Z'),
      serviceAt: new Date('2026-03-06T09:00:00Z'),
    });
    expect(r.horizon).toBe('SHORT');
    expect(r.deadline.toISOString().slice(0, 10)).toBe('2026-03-03');
  });

  it('requested-without-scheduling is treated as LONG', () => {
    const r = computeGfeDeadline({
      scheduledAt: new Date('2026-03-02T09:00:00Z'),
      serviceAt: new Date('2026-03-03T09:00:00Z'),
      requestedWithoutScheduling: true,
    });
    expect(r.horizon).toBe('LONG');
  });

  it('IMMEDIATE horizon fails closed to delivery at scheduling time', () => {
    const scheduled = new Date('2026-03-05T09:00:00Z');
    const r = computeGfeDeadline({
      scheduledAt: scheduled,
      serviceAt: new Date('2026-03-06T09:00:00Z'),
    });
    expect(r.horizon).toBe('IMMEDIATE');
    expect(r.deadline.getTime()).toBe(scheduled.getTime());
  });

  it('isGfeLate flags delivery after the deadline', () => {
    const r = computeGfeDeadline({
      scheduledAt: new Date('2026-03-02T09:00:00Z'),
      serviceAt: new Date('2026-03-18T09:00:00Z'),
    });
    expect(isGfeLate(r, new Date('2026-03-05T23:59:00Z'))).toBe(false);
    expect(isGfeLate(r, new Date('2026-03-06T00:00:01Z'))).toBe(true);
  });
});

describe('validateGfeContent (149.610(b))', () => {
  it('passes with all required elements', () => {
    expect(validateGfeContent([...REQUIRED_GFE_ELEMENTS]).complete).toBe(true);
  });

  it('reports missing PPDR disclaimer', () => {
    const r = validateGfeContent(REQUIRED_GFE_ELEMENTS.filter((e) => e !== 'PPDR_DISCLAIMER'));
    expect(r.complete).toBe(false);
    expect(r.missing).toEqual(['PPDR_DISCLAIMER']);
  });
});

describe('validateRecurringGfeWindow (149.610(a)(2)(iii))', () => {
  it('accepts a 12-month recurring window', () => {
    const r = validateRecurringGfeWindow(new Date('2026-01-05T00:00:00Z'), new Date('2026-12-20T00:00:00Z'));
    expect(r.valid).toBe(true);
    expect(r.months).toBeLessThanOrEqual(12);
  });

  it('rejects a >12-month recurring window', () => {
    const r = validateRecurringGfeWindow(new Date('2026-01-05T00:00:00Z'), new Date('2027-02-05T00:00:00Z'));
    expect(r.valid).toBe(false);
    expect(r.months).toBe(13);
  });
});
