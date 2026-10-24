import { describe, it, expect } from 'vitest';
import { buildSubmissionPackage, DisputeInput } from './package-builder';

const NOW = new Date(Date.UTC(2026, 8, 5, 12, 0, 0)); // 2026-09-05

const complete: DisputeInput = {
  initiatingPartyName: 'Acme Medical Group',
  initiatingPartyContactEmail: 'idr@acme.example',
  initiatingPartyContactPhone: '555-0100',
  initiatingPartyTin: '12-3456789',
  initiatingPartyNpi: '1234567890',
  initiatingPartyType: 'provider',
  respondingPartyName: 'Big Payer Co',
  respondingPartyContactEmail: 'nsa@payer.example',
  respondingPartyContactPhone: '555-0200',
  claimNumber: 'CLM-0001',
  serviceCode: '99285',
  dateOfService: '2026-07-01',
  billedCharge: 1200,
  qualifyingPaymentAmount: 300,
  initialPlanPayment: 280,
  openNegotiationInitiationDate: '2026-07-15',
  openNegotiationNoticeProofRef: 's3://proof/on-notice.pdf',
  certificationAttestedAt: '2026-09-05',
  certificationAttestorName: 'J. Smith',
  supportingDocuments: ['itemized-bill.pdf'],
  initiatingOffer: 900,
  now: NOW,
};

describe('buildSubmissionPackage', () => {
  it('complete input → complete=true, no missing', () => {
    const p = buildSubmissionPackage(complete);
    expect(p.complete).toBe(true);
    expect(p.missing).toEqual([]);
  });

  it('emits copy-ready portalFields for present values', () => {
    const p = buildSubmissionPackage(complete);
    expect(p.portalFields.claimNumber).toBe('CLM-0001');
    expect(p.portalFields.billedCharge).toBe('1200');
    expect(p.portalFields.supportingDocuments).toBe('itemized-bill.pdf');
    expect(p.portalFields.initiatingPartyNpi).toBe('1234567890');
  });

  it('fail-closed: missing required → complete=false, lists labels', () => {
    const p = buildSubmissionPackage({ ...complete, claimNumber: undefined, qualifyingPaymentAmount: undefined, now: NOW });
    expect(p.complete).toBe(false);
    expect(p.missing).toContain('Per-item/service claim number');
    expect(p.missing).toContain('Qualifying payment amount (QPA)');
  });

  it('empty supportingDocuments array is treated as absent', () => {
    const p = buildSubmissionPackage({ ...complete, supportingDocuments: [] });
    expect(p.complete).toBe(false);
    expect(p.missing).toContain('Supporting documents list');
  });

  it('checklist has one element per required element plus documents', () => {
    const p = buildSubmissionPackage(complete);
    expect(p.checklist.length).toBeGreaterThanOrEqual(18);
    expect(p.checklist.every((c) => c.required && typeof c.present === 'boolean')).toBe(true);
  });

  it('warns when billed charge below $15 admin fee (CMS-9897-F)', () => {
    const p = buildSubmissionPackage({ ...complete, billedCharge: 10 });
    expect(p.warnings.some((w) => w.includes('administrative fee'))).toBe(true);
  });

  it('warns when offer within 20% of QPA', () => {
    const p = buildSubmissionPackage({ ...complete, initiatingOffer: 320, qualifyingPaymentAmount: 300 });
    expect(p.warnings.some((w) => w.includes('within 20% of QPA'))).toBe(true);
  });

  it('no 20%-of-QPA warning when offer is far from QPA', () => {
    const p = buildSubmissionPackage({ ...complete, initiatingOffer: 900, qualifyingPaymentAmount: 300 });
    expect(p.warnings.some((w) => w.includes('within 20% of QPA'))).toBe(false);
  });

  it('warns when certification date is not today', () => {
    const p = buildSubmissionPackage({ ...complete, certificationAttestedAt: '2026-09-01' });
    expect(p.warnings.some((w) => w.includes('not today'))).toBe(true);
  });

  it('warns on missing NPI for provider/facility initiating party', () => {
    const p = buildSubmissionPackage({ ...complete, initiatingPartyNpi: undefined });
    expect(p.warnings.some((w) => w.includes('NPI'))).toBe(true);
  });

  it('no NPI warning for plan/issuer initiating party', () => {
    const p = buildSubmissionPackage({ ...complete, initiatingPartyNpi: undefined, initiatingPartyType: 'plan' });
    expect(p.warnings.some((w) => w.includes('NPI'))).toBe(false);
  });

  it('warnings are non-blocking: complete stays true', () => {
    const p = buildSubmissionPackage({ ...complete, billedCharge: 10, initiatingOffer: 320 });
    expect(p.complete).toBe(true);
    expect(p.warnings.length).toBeGreaterThan(0);
  });

  it('generatedAt reflects provided clock', () => {
    const p = buildSubmissionPackage(complete);
    expect(p.generatedAt).toBe(NOW.toISOString());
  });
});
