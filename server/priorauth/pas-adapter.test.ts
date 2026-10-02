import { describe, it, expect } from 'vitest';
import {
  buildPasBundle,
  submitViaPas,
  loadPasConfig,
  PAS_CLAIM_PROFILE_URL,
} from './pas-adapter';

describe('buildPasBundle', () => {
  it('builds a FHIR R4 collection Bundle with a preauthorization Claim', () => {
    const b = buildPasBundle({ id: 'pa-1', urgency: 'STANDARD', createdAt: new Date('2026-03-01T00:00:00Z') });
    expect(b.resourceType).toBe('Bundle');
    expect(b.type).toBe('collection');
    expect(b.entry).toHaveLength(1);
    const claim = b.entry[0].resource;
    expect(claim.resourceType).toBe('Claim');
    expect(claim.use).toBe('preauthorization');
    expect(claim.meta.profile).toContain(PAS_CLAIM_PROFILE_URL);
    expect(claim.meta.profile[0]).toBe('http://hl7.org/fhir/us/davinci-pas/StructureDefinition/profile-claim');
  });

  it('maps EXPEDITED urgency to urgent priority, STANDARD to normal', () => {
    expect(buildPasBundle({ id: 'a', urgency: 'EXPEDITED' }).entry[0].resource.priority!.coding[0].code).toBe('urgent');
    expect(buildPasBundle({ id: 'b', urgency: 'STANDARD' }).entry[0].resource.priority!.coding[0].code).toBe('normal');
  });

  it('throws when id missing', () => {
    expect(() => buildPasBundle({ id: '', urgency: 'STANDARD' })).toThrow();
  });
});

describe('submitViaPas (STATIC-ONLY / BLOCKED)', () => {
  it('BLOCKED when feature flag off', () => {
    const r = submitViaPas({ id: 'pa-1', urgency: 'STANDARD' }, { paApi2027Enabled: false });
    expect(r.status).toBe('BLOCKED');
    if (r.status === 'BLOCKED') expect(r.reason).toContain('PA_API_2027_ENABLED');
  });

  it('BLOCKED when flag on but no payer endpoint configured', () => {
    const r = submitViaPas({ id: 'pa-1', urgency: 'STANDARD' }, { paApi2027Enabled: true });
    expect(r.status).toBe('BLOCKED');
    if (r.status === 'BLOCKED') expect(r.reason).toContain('endpoint');
  });

  it('READY with prepared bundle when flag on and endpoint configured (no network I/O)', () => {
    const r = submitViaPas(
      { id: 'pa-1', urgency: 'EXPEDITED' },
      { paApi2027Enabled: true, payerEndpoint: 'https://payer.example/fhir' },
    );
    expect(r.status).toBe('READY');
    if (r.status === 'READY') expect(r.bundle.entry[0].resource.use).toBe('preauthorization');
  });

  it('loadPasConfig reads env flags strictly', () => {
    expect(loadPasConfig({ PA_API_2027_ENABLED: 'true', PA_PAYER_ENDPOINT: 'x' })).toEqual({
      paApi2027Enabled: true,
      payerEndpoint: 'x',
    });
    expect(loadPasConfig({ PA_API_2027_ENABLED: '1' }).paApi2027Enabled).toBe(false);
    expect(loadPasConfig({}).paApi2027Enabled).toBe(false);
  });
});
