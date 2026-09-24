import { describe, it, expect } from 'vitest';
import { createNoticeConsentCase, transition } from './fsm';
import { REQUIRED_NOTICE_ELEMENTS } from './waiver';

const timingOk = {
  scheduledAt: new Date('2026-03-01T00:00:00Z'),
  serviceAt: new Date('2026-03-10T10:00:00Z'),
  noticeDeliveredAt: new Date('2026-03-05T00:00:00Z'),
  consentSignedAt: new Date('2026-03-05T01:00:00Z'),
};

function makeCase(overrides: Partial<Parameters<typeof createNoticeConsentCase>[0]> = {}) {
  return createNoticeConsentCase({
    id: 'NC-1',
    waiverInput: { serviceCategory: 'NON_EMERGENCY', providerSpecialty: 'ORTHOPEDICS' },
    timing: { ...timingOk },
    noticeElements: [...REQUIRED_NOTICE_ELEMENTS],
    ...overrides,
  });
}

describe('notice-consent FSM', () => {
  it('walks the happy path NOTICE_REQUIRED → … → SERVICE_RENDERED with retention computed', () => {
    let c = makeCase();
    c = transition(c, 'NOTICE_DELIVERED');
    c = transition(c, 'CONSENT_SIGNED');
    expect(c.retentionUntil).not.toBeNull();
    expect(c.retentionUntil!.getUTCFullYear()).toBe(2033);
    c = transition(c, 'SERVICE_RENDERED');
    expect(c.state).toBe('SERVICE_RENDERED');
    const types = c.events.map((e) => e.type);
    expect(types).toContain('RETENTION_COMPUTED');
    expect(types.filter((t) => t === 'TRANSITION')).toHaveLength(3);
  });

  it('blocks NOTICE_DELIVERED when notice content is incomplete', () => {
    const c = makeCase({ noticeElements: [] });
    expect(() => transition(c, 'NOTICE_DELIVERED')).toThrow('missing elements');
  });

  it('blocks CONSENT_SIGNED for emergency services (non-waivable) and logs rejection', () => {
    let c = makeCase({
      waiverInput: { serviceCategory: 'EMERGENCY', providerSpecialty: 'EMERGENCY_MEDICINE' },
    });
    c = transition(c, 'NOTICE_DELIVERED');
    expect(() => transition(c, 'CONSENT_SIGNED')).toThrow('Emergency services');
    const c2 = transition(c, 'WAIVED_IMPOSSIBLE');
    expect(c2.state).toBe('WAIVED_IMPOSSIBLE');
  });

  it('blocks CONSENT_SIGNED when timing is non-compliant', () => {
    const c = makeCase({
      timing: { ...timingOk, noticeDeliveredAt: new Date('2026-03-09T10:00:00Z') },
    });
    const delivered = transition(c, 'NOTICE_DELIVERED');
    expect(() => transition(delivered, 'CONSENT_SIGNED')).toThrow('timing non-compliant');
  });

  it('blocks CONSENT_SIGNED without a consentSignedAt timestamp', () => {
    const { consentSignedAt: _omit, ...timingNoConsent } = timingOk;
    const c = makeCase({ timing: timingNoConsent });
    const delivered = transition(c, 'NOTICE_DELIVERED');
    expect(() => transition(delivered, 'CONSENT_SIGNED')).toThrow('consentSignedAt');
  });

  it('allows revocation before service from CONSENT_SIGNED (149.420(f))', () => {
    let c = makeCase();
    c = transition(c, 'NOTICE_DELIVERED');
    c = transition(c, 'CONSENT_SIGNED');
    c = transition(c, 'CONSENT_REVOKED');
    expect(c.state).toBe('CONSENT_REVOKED');
  });

  it('forbids revocation after SERVICE_RENDERED', () => {
    let c = makeCase();
    c = transition(c, 'NOTICE_DELIVERED');
    c = transition(c, 'CONSENT_SIGNED');
    c = transition(c, 'SERVICE_RENDERED');
    expect(() => transition(c, 'CONSENT_REVOKED')).toThrow('Invalid');
  });

  it('forbids SERVICE_RENDERED without a signed consent', () => {
    let c = makeCase();
    c = transition(c, 'NOTICE_DELIVERED');
    expect(() => transition(c, 'SERVICE_RENDERED')).toThrow('Invalid');
  });

  it('WAIVED_IMPOSSIBLE guard refuses waivable cases (fail-closed against misuse)', () => {
    const c = makeCase();
    expect(() => transition(c, 'WAIVED_IMPOSSIBLE')).toThrow('non-waivable');
  });

  it('NOTICE_EXPIRED is reachable from NOTICE_DELIVERED (reschedule re-execution path)', () => {
    let c = makeCase();
    c = transition(c, 'NOTICE_DELIVERED');
    c = transition(c, 'NOTICE_EXPIRED');
    expect(c.state).toBe('NOTICE_EXPIRED');
    // terminal: nothing allowed out
    expect(() => transition(c, 'NOTICE_DELIVERED')).toThrow('Invalid');
  });

  it('event log is append-only across transitions', () => {
    let c = makeCase();
    c = transition(c, 'NOTICE_DELIVERED');
    const lenAfterDeliver = c.events.length;
    c = transition(c, 'CONSENT_SIGNED');
    expect(c.events.length).toBeGreaterThan(lenAfterDeliver);
    expect(c.events[0]).toMatchObject({ from: 'NOTICE_REQUIRED', to: 'NOTICE_DELIVERED' });
  });
});
