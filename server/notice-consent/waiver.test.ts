import { describe, it, expect } from 'vitest';
import {
  evaluateWaiverEligibility,
  validateNoticeTiming,
  validateNoticeContent,
  retentionUntil,
  REQUIRED_NOTICE_ELEMENTS,
  RETENTION_YEARS,
} from './waiver';

const base = {
  serviceCategory: 'NON_EMERGENCY' as const,
  providerSpecialty: 'ORTHOPEDICS',
};

describe('evaluateWaiverEligibility', () => {
  it('marks non-emergency OON service outside protected categories as WAIVABLE', () => {
    const r = evaluateWaiverEligibility(base);
    expect(r.waivable).toBe(true);
    expect(r.eligibility).toBe('WAIVABLE');
  });

  it('never allows waiver for emergency services (149.410(b))', () => {
    const r = evaluateWaiverEligibility({ ...base, serviceCategory: 'EMERGENCY' });
    expect(r.waivable).toBe(false);
    expect(r.eligibility).toBe('NON_WAIVABLE_EMERGENCY');
  });

  it.each([
    'ANESTHESIOLOGY',
    'PATHOLOGY',
    'RADIOLOGY',
    'NEONATOLOGY',
    'ASSISTANT_SURGEON',
    'HOSPITALIST',
    'INTENSIVIST',
  ])('blocks ancillary specialty %s regardless of category', (specialty) => {
    const r = evaluateWaiverEligibility({ ...base, providerSpecialty: specialty });
    expect(r.waivable).toBe(false);
    expect(r.eligibility).toBe('NON_WAIVABLE_ANCILLARY');
  });

  it('blocks services categorized as ANCILLARY even without specialty match', () => {
    const r = evaluateWaiverEligibility({ ...base, serviceCategory: 'ANCILLARY' });
    expect(r.eligibility).toBe('NON_WAIVABLE_ANCILLARY');
  });

  it('blocks diagnostic services (radiology/lab) (149.420(b))', () => {
    const r = evaluateWaiverEligibility({ ...base, serviceCategory: 'DIAGNOSTIC' });
    expect(r.eligibility).toBe('NON_WAIVABLE_DIAGNOSTIC');
  });

  it('blocks unforeseen urgent medical needs (149.420(b))', () => {
    const r = evaluateWaiverEligibility({ ...base, serviceCategory: 'UNFORESEEN_URGENT' });
    expect(r.eligibility).toBe('NON_WAIVABLE_UNFORESEEN');
  });

  it('blocks when no in-network provider is available at the facility', () => {
    const r = evaluateWaiverEligibility({ ...base, noInNetworkProviderAvailable: true });
    expect(r.eligibility).toBe('NON_WAIVABLE_NO_IN_NETWORK_AVAILABLE');
  });

  it('blocks when the provider is in-network (exception is OON-only)', () => {
    const r = evaluateWaiverEligibility({ ...base, providerInNetwork: true });
    expect(r.eligibility).toBe('NON_WAIVABLE_IN_NETWORK_PROVIDER');
  });

  it('emergency takes precedence over ancillary categorization', () => {
    const r = evaluateWaiverEligibility({
      serviceCategory: 'EMERGENCY',
      providerSpecialty: 'ANESTHESIOLOGY',
    });
    expect(r.eligibility).toBe('NON_WAIVABLE_EMERGENCY');
  });
});

describe('validateNoticeTiming', () => {
  it('passes when notice is >=72h before service for early-scheduled appointments', () => {
    const r = validateNoticeTiming({
      scheduledAt: new Date('2026-03-01T00:00:00Z'),
      serviceAt: new Date('2026-03-10T10:00:00Z'),
      noticeDeliveredAt: new Date('2026-03-06T00:00:00Z'),
      consentSignedAt: new Date('2026-03-06T00:00:00Z'),
    });
    expect(r.compliant).toBe(true);
    expect(r.violations).toHaveLength(0);
  });

  it('fails when notice is <72h before service for early-scheduled appointments', () => {
    const r = validateNoticeTiming({
      scheduledAt: new Date('2026-03-01T00:00:00Z'),
      serviceAt: new Date('2026-03-10T10:00:00Z'),
      noticeDeliveredAt: new Date('2026-03-09T10:00:00Z'), // 24h before
      consentSignedAt: new Date('2026-03-09T10:00:00Z'),
    });
    expect(r.compliant).toBe(false);
    expect(r.violations.some((v) => v.includes('72'))).toBe(true);
  });

  it('passes same-day-scheduled case when notice on scheduling day and consent >=3h before', () => {
    const r = validateNoticeTiming({
      scheduledAt: new Date('2026-03-10T06:00:00Z'),
      serviceAt: new Date('2026-03-10T15:00:00Z'),
      noticeDeliveredAt: new Date('2026-03-10T06:30:00Z'),
      consentSignedAt: new Date('2026-03-10T11:00:00Z'), // 4h before
    });
    expect(r.compliant).toBe(true);
  });

  it('fails same-day-scheduled case when consent is <3h before service', () => {
    const r = validateNoticeTiming({
      scheduledAt: new Date('2026-03-10T06:00:00Z'),
      serviceAt: new Date('2026-03-10T15:00:00Z'),
      noticeDeliveredAt: new Date('2026-03-10T06:30:00Z'),
      consentSignedAt: new Date('2026-03-10T14:00:00Z'), // 1h before
    });
    expect(r.compliant).toBe(false);
    expect(r.violations.some((v) => v.includes('>= 3h'))).toBe(true);
  });

  it('fails same-day-scheduled case when notice is not delivered on scheduling day', () => {
    const r = validateNoticeTiming({
      scheduledAt: new Date('2026-03-09T20:00:00Z'),
      serviceAt: new Date('2026-03-11T10:00:00Z'), // 38h horizon
      noticeDeliveredAt: new Date('2026-03-10T08:00:00Z'), // next day
    });
    expect(r.compliant).toBe(false);
    expect(r.violations.some((v) => v.includes('day of scheduling'))).toBe(true);
  });

  it('fails when consent is signed before notice delivery', () => {
    const r = validateNoticeTiming({
      scheduledAt: new Date('2026-03-01T00:00:00Z'),
      serviceAt: new Date('2026-03-10T10:00:00Z'),
      noticeDeliveredAt: new Date('2026-03-05T00:00:00Z'),
      consentSignedAt: new Date('2026-03-04T00:00:00Z'),
    });
    expect(r.compliant).toBe(false);
    expect(r.violations.some((v) => v.includes('before the notice'))).toBe(true);
  });

  it('throws when serviceAt is not after scheduledAt', () => {
    expect(() =>
      validateNoticeTiming({
        scheduledAt: new Date('2026-03-10T00:00:00Z'),
        serviceAt: new Date('2026-03-09T00:00:00Z'),
        noticeDeliveredAt: new Date('2026-03-08T00:00:00Z'),
      }),
    ).toThrow('after scheduledAt');
  });
});

describe('validateNoticeContent', () => {
  it('passes when all required elements are present', () => {
    const r = validateNoticeContent([...REQUIRED_NOTICE_ELEMENTS]);
    expect(r.complete).toBe(true);
    expect(r.missing).toHaveLength(0);
  });

  it('reports missing elements (GFE omitted)', () => {
    const r = validateNoticeContent(
      REQUIRED_NOTICE_ELEMENTS.filter((e) => e !== 'GFE_GOOD_FAITH_ESTIMATE'),
    );
    expect(r.complete).toBe(false);
    expect(r.missing).toEqual(['GFE_GOOD_FAITH_ESTIMATE']);
  });
});

describe('retentionUntil', () => {
  it('computes a 7-year retention window from signing', () => {
    const signed = new Date('2026-06-15T12:00:00Z');
    const until = retentionUntil(signed);
    expect(until.getUTCFullYear()).toBe(2026 + RETENTION_YEARS);
    expect(until.getUTCMonth()).toBe(signed.getUTCMonth());
    expect(until.getUTCDate()).toBe(signed.getUTCDate());
  });

  it('throws on invalid date', () => {
    expect(() => retentionUntil(new Date('not-a-date'))).toThrow();
  });
});
