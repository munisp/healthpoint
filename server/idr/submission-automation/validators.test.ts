import { describe, it, expect, afterEach } from 'vitest';
import {
  isValidNpi,
  isValidTin,
  isValidCmsDisputeReference,
  isServiceDateSane,
  isOnInitiationAfterService,
  resolveStrictMode,
  validateSubmissionFields,
  luhnValid,
} from './validators';
import { buildSubmissionPackage } from './package-builder';

// 1234567893 is the canonical valid NPI from the CMS NPI check-digit examples.
const VALID_NPI = '1234567893';

const NOW = new Date('2026-09-05T12:00:00.000Z');

afterEach(() => {
  delete process.env.CMS_REF_REGEX;
  delete process.env.SUBMISSION_STRICT;
  delete process.env.CMS_SERVICE_DATE_FUTURE_TOLERANCE_DAYS;
});

describe('NPI validation (10-digit + CMS Luhn with 80840 prefix)', () => {
  it('accepts the CMS example NPI', () => {
    expect(isValidNpi(VALID_NPI)).toBe(true);
  });
  it('rejects a bad check digit', () => {
    expect(isValidNpi('1234567890')).toBe(false);
  });
  it('rejects non-10-digit values', () => {
    expect(isValidNpi('123456789')).toBe(false);
    expect(isValidNpi('12345678934')).toBe(false);
    expect(isValidNpi('12345 7893')).toBe(false);
    expect(isValidNpi('')).toBe(false);
  });
  it('luhnValid rejects non-digit input', () => {
    expect(luhnValid('12a4')).toBe(false);
  });
});

describe('TIN/EIN validation', () => {
  it('accepts 9 digits', () => {
    expect(isValidTin('123456789')).toBe(true);
  });
  it('rejects other lengths/characters', () => {
    expect(isValidTin('12345678')).toBe(false);
    expect(isValidTin('1234567890')).toBe(false);
    expect(isValidTin('12-3456789')).toBe(false);
    expect(isValidTin('ABCDEFGHI')).toBe(false);
  });
});

describe('CMS dispute reference number (configurable regex, fail-closed)', () => {
  it('accepts values matching the default ^[A-Z0-9-]{6,32}$', () => {
    expect(isValidCmsDisputeReference('IDR-2026-123456')).toBe(true);
    expect(isValidCmsDisputeReference('ABCDEF')).toBe(true);
  });
  it('rejects lowercase, short, and oversized values', () => {
    expect(isValidCmsDisputeReference('idr-2026')).toBe(false);
    expect(isValidCmsDisputeReference('AB1')).toBe(false);
    expect(isValidCmsDisputeReference('A'.repeat(33))).toBe(false);
    expect(isValidCmsDisputeReference('HAS SPACE1')).toBe(false);
  });
  it('honors CMS_REF_REGEX override', () => {
    process.env.CMS_REF_REGEX = '^X\\d{4}$';
    expect(isValidCmsDisputeReference('X1234')).toBe(true);
    expect(isValidCmsDisputeReference('IDR-2026')).toBe(false);
  });
  it('fails closed when CMS_REF_REGEX is an invalid regex', () => {
    process.env.CMS_REF_REGEX = '([unclosed';
    expect(isValidCmsDisputeReference('IDR-2026-123456')).toBe(false);
  });
});

describe('date sanity', () => {
  it('rejects a future date of service', () => {
    expect(isServiceDateSane('2026-09-06', NOW)).toBe(false);
  });
  it('accepts today and past dates', () => {
    expect(isServiceDateSane('2026-09-05', NOW)).toBe(true);
    expect(isServiceDateSane('2025-01-01', NOW)).toBe(true);
  });
  it('rejects unparseable dates', () => {
    expect(isServiceDateSane('not-a-date', NOW)).toBe(false);
  });
  it('honors the future-tolerance configuration', () => {
    expect(isServiceDateSane('2026-09-07', NOW, 2)).toBe(true);
    expect(isServiceDateSane('2026-09-08', NOW, 2)).toBe(false);
    process.env.CMS_SERVICE_DATE_FUTURE_TOLERANCE_DAYS = '1';
    expect(isServiceDateSane('2026-09-06', NOW)).toBe(true);
  });
  it('requires ON initiation date on/after the date of service', () => {
    expect(isOnInitiationAfterService('2026-09-01', '2026-08-15')).toBe(true);
    expect(isOnInitiationAfterService('2026-08-01', '2026-08-15')).toBe(false);
    expect(isOnInitiationAfterService('bogus', '2026-08-15')).toBe(false);
  });
});

describe('validateSubmissionFields', () => {
  it('collects all field problems as warnings', () => {
    const { warnings } = validateSubmissionFields({
      initiatingPartyNpi: '1234567890',
      initiatingPartyTin: '12345',
      cmsDisputeReferenceNumber: 'bad ref!',
      dateOfService: '2027-01-01',
      openNegotiationInitiationDate: '2026-01-01',
      now: NOW,
    });
    expect(warnings.length).toBeGreaterThanOrEqual(5);
  });
  it('returns no warnings for clean input', () => {
    const { warnings } = validateSubmissionFields({
      initiatingPartyNpi: VALID_NPI,
      initiatingPartyTin: '123456789',
      cmsDisputeReferenceNumber: 'IDR-2026-123456',
      dateOfService: '2026-08-01',
      openNegotiationInitiationDate: '2026-08-20',
      now: NOW,
    });
    expect(warnings).toEqual([]);
  });
});

const COMPLETE_INPUT = {
  disputeId: 'D-1',
  tenantId: 'T-1',
  initiatingPartyName: 'Provider Co',
  initiatingPartyContactEmail: 'p@example.com',
  initiatingPartyContactPhone: '555-0100',
  respondingPartyName: 'Plan Inc',
  respondingPartyContactEmail: 'r@example.com',
  respondingPartyContactPhone: '555-0200',
  initiatingPartyTin: '123456789',
  claimNumber: 'CLM-1',
  serviceCode: '99213',
  dateOfService: '2026-08-01',
  billedCharge: 1200,
  qualifyingPaymentAmount: 1000,
  initialPlanPayment: 800,
  openNegotiationInitiationDate: '2026-08-20',
  openNegotiationNoticeProofRef: 's3://proof',
  certificationAttestedAt: '2026-09-05',
  certificationAttestorName: 'Jane Doe',
  supportingDocuments: ['doc1'],
  now: NOW,
};

describe('strictMode promotion in package-builder', () => {
  it('warnings are non-blocking by default', () => {
    const pkg = buildSubmissionPackage({ ...COMPLETE_INPUT, initiatingPartyNpi: '1234567890' });
    expect(pkg.warnings.some((w) => w.includes('NPI'))).toBe(true);
    expect(pkg.complete).toBe(true);
  });
  it('strictMode=true promotes warnings to blocking (complete=false)', () => {
    const pkg = buildSubmissionPackage({ ...COMPLETE_INPUT, initiatingPartyNpi: '1234567890', strictMode: true });
    expect(pkg.complete).toBe(false);
  });
  it('SUBMISSION_STRICT=1 promotes warnings to blocking', () => {
    process.env.SUBMISSION_STRICT = '1';
    const pkg = buildSubmissionPackage({ ...COMPLETE_INPUT, initiatingPartyNpi: '1234567890' });
    expect(pkg.complete).toBe(false);
  });
  it('strictMode with clean input stays complete', () => {
    const pkg = buildSubmissionPackage({ ...COMPLETE_INPUT, initiatingPartyNpi: VALID_NPI, strictMode: true });
    expect(pkg.warnings).toEqual([]);
    expect(pkg.complete).toBe(true);
  });
  it('resolveStrictMode: explicit option wins over env', () => {
    process.env.SUBMISSION_STRICT = '1';
    expect(resolveStrictMode(false)).toBe(false);
    expect(resolveStrictMode(true)).toBe(true);
    expect(resolveStrictMode(undefined)).toBe(true);
  });
});
