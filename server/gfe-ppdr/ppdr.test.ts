import { describe, it, expect } from 'vitest';
import {
  evaluatePpdrEligibility,
  createPpdrDispute,
  transition,
  SUBSTANTIALLY_IN_EXCESS_THRESHOLD_USD,
} from './ppdr';

const billedAt = new Date('2026-04-01T00:00:00Z');
const asOf = new Date('2026-04-20T00:00:00Z');

function eligibleInput() {
  return {
    gfeTotalUsd: 1000,
    billedTotalUsd: 1000 + SUBSTANTIALLY_IN_EXCESS_THRESHOLD_USD + 100,
    billedAt,
    insuranceBilled: false,
    asOf,
  };
}

describe('evaluatePpdrEligibility (149.620(b))', () => {
  it('eligible: uninsured, excess >= $400, within 120 days', () => {
    const r = evaluatePpdrEligibility(eligibleInput());
    expect(r.eligible).toBe(true);
    expect(r.excessUsd).toBeCloseTo(500);
  });

  it('ineligible when excess < $400', () => {
    const r = evaluatePpdrEligibility({ ...eligibleInput(), billedTotalUsd: 1399.99 });
    expect(r.eligible).toBe(false);
    expect(r.reasons.some((x) => x.includes('substantially in excess'))).toBe(true);
  });

  it('eligible at exactly the $400 threshold', () => {
    const r = evaluatePpdrEligibility({ ...eligibleInput(), billedTotalUsd: 1400 });
    expect(r.eligible).toBe(true);
  });

  it('ineligible when insurance was billed', () => {
    const r = evaluatePpdrEligibility({ ...eligibleInput(), insuranceBilled: true });
    expect(r.eligible).toBe(false);
    expect(r.reasons.some((x) => x.includes('uninsured/self-pay'))).toBe(true);
  });

  it('ineligible after the 120-calendar-day window', () => {
    const late = new Date(billedAt.getTime() + 121 * 24 * 60 * 60 * 1000);
    const r = evaluatePpdrEligibility({ ...eligibleInput(), asOf: late });
    expect(r.eligible).toBe(false);
    expect(r.reasons.some((x) => x.includes('120 calendar days'))).toBe(true);
  });

  it('eligible on exactly day 120', () => {
    const day120 = new Date(billedAt.getTime() + 120 * 24 * 60 * 60 * 1000);
    const r = evaluatePpdrEligibility({ ...eligibleInput(), asOf: day120 });
    expect(r.eligible).toBe(true);
  });

  it('rejects invalid monetary inputs', () => {
    expect(() => evaluatePpdrEligibility({ ...eligibleInput(), gfeTotalUsd: -1 })).toThrow();
  });
});

describe('PPDR FSM', () => {
  function makeDispute() {
    return createPpdrDispute({
      id: 'PPDR-1',
      gfeTotalUsd: 1000,
      billedTotalUsd: 1500,
      billedAt,
      insuranceBilled: false,
    });
  }

  it('requires the admin fee to be injected (no hardcoded default)', () => {
    const d = makeDispute();
    expect(() => transition(d, 'INITIATED', { now: asOf })).toThrow('adminFeeUsd');
  });

  it('INITIATED records the injected fee and the eligibility check', () => {
    const d = transition(makeDispute(), 'INITIATED', { now: asOf, adminFeeUsd: 25 });
    expect(d.state).toBe('INITIATED');
    expect(d.adminFeeUsd).toBe(25);
    expect(d.events.some((e) => e.type === 'ELIGIBILITY_CHECK')).toBe(true);
  });

  it('INITIATED fails closed when eligibility criteria are not met', () => {
    const d = createPpdrDispute({
      id: 'PPDR-2',
      gfeTotalUsd: 1000,
      billedTotalUsd: 1200,
      billedAt,
      insuranceBilled: false,
    });
    expect(() => transition(d, 'INITIATED', { now: asOf, adminFeeUsd: 25 })).toThrow(
      'eligibility check failed',
    );
  });

  it('full lifecycle: DRAFT → INITIATED → UNDER_REVIEW → DETERMINED → CLOSED', () => {
    let d = transition(makeDispute(), 'INITIATED', { now: asOf, adminFeeUsd: 25 });
    d = transition(d, 'UNDER_REVIEW');
    d = transition(d, 'DETERMINED', {
      determination: {
        entityId: 'CERT-PPDR-07',
        determinedAt: new Date('2026-05-01T00:00:00Z'),
        patientOwesUsd: 1000,
        rationale: 'Billed $500 over GFE without documented change in scope.',
      },
    });
    expect(d.determination!.binding).toBe(true);
    d = transition(d, 'CLOSED');
    expect(d.state).toBe('CLOSED');
  });

  it('determination cannot leave the patient owing more than the GFE total', () => {
    let d = transition(makeDispute(), 'INITIATED', { now: asOf, adminFeeUsd: 25 });
    d = transition(d, 'UNDER_REVIEW');
    expect(() =>
      transition(d, 'DETERMINED', {
        determination: {
          entityId: 'CERT-PPDR-07',
          determinedAt: new Date('2026-05-01T00:00:00Z'),
          patientOwesUsd: 1001,
          rationale: 'Exceeds GFE total — must be rejected.',
        },
      }),
    ).toThrow('more than the GFE');
  });

  it('DETERMINED requires a certified entity id', () => {
    let d = transition(makeDispute(), 'INITIATED', { now: asOf, adminFeeUsd: 25 });
    d = transition(d, 'UNDER_REVIEW');
    expect(() =>
      transition(d, 'DETERMINED', {
        determination: {
          entityId: '',
          determinedAt: new Date('2026-05-01T00:00:00Z'),
          patientOwesUsd: 900,
          rationale: 'x',
        },
      }),
    ).toThrow('entityId');
  });

  it('INELIGIBLE transition refuses eligible disputes (fail-closed)', () => {
    const d = makeDispute();
    expect(() => transition(d, 'INELIGIBLE', { now: asOf })).toThrow('satisfies');
  });

  it('INELIGIBLE accepted for genuinely ineligible disputes with logged reasons', () => {
    const d = createPpdrDispute({
      id: 'PPDR-3',
      gfeTotalUsd: 1000,
      billedTotalUsd: 1600,
      billedAt,
      insuranceBilled: true,
    });
    const d2 = transition(d, 'INELIGIBLE', { now: asOf });
    expect(d2.state).toBe('INELIGIBLE');
    expect(d2.events.some((e) => e.detail?.includes('uninsured/self-pay'))).toBe(true);
  });

  it('invalid transitions throw and terminal states are closed', () => {
    let d = transition(makeDispute(), 'INITIATED', { now: asOf, adminFeeUsd: 25 });
    expect(() => transition(d, 'DETERMINED', {})).toThrow('Invalid');
    d = transition(d, 'UNDER_REVIEW');
    d = transition(d, 'DETERMINED', {
      determination: {
        entityId: 'CERT-PPDR-07',
        determinedAt: new Date('2026-05-01T00:00:00Z'),
        patientOwesUsd: 800,
        rationale: 'Reduced to GFE minus overpayment.',
      },
    });
    d = transition(d, 'CLOSED');
    expect(() => transition(d, 'INITIATED', { adminFeeUsd: 25 })).toThrow('Invalid');
  });
});
