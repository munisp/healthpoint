import { describe, it, expect } from 'vitest';
import {
  recordDetermination,
  remittanceReconciliation,
  paymentDueDate,
  DeterminationValidationError,
  OutcomeTelemetry,
} from './feedback';

const BASE = {
  idreId: 'IDRE-9',
  determinationDate: '2026-09-15',
  prevailingParty: 'initiating' as const,
  prevailingOffer: 900,
  qpa: 300,
  otherOffer: 250,
  rationaleFactors: ['patient acuity', 'market share'],
  adminFeeAmount: 15,
  idreFeeAmount: 450,
};

describe('recordDetermination', () => {
  it('stores a valid determination and computes +30 calendar day due date', () => {
    const r = recordDetermination('T-1', 'D-1', BASE);
    expect(r.paymentDueDate).toBe('2026-10-15');
    expect(r.disputeId).toBe('D-1');
  });

  it('payment clock crosses month/year boundaries (pure calendar math)', () => {
    expect(paymentDueDate('2026-12-15')).toBe('2027-01-14');
    expect(paymentDueDate('2027-01-31')).toBe('2027-03-02'); // non-leap Feb
  });

  it('rejects bad determinationDate format', () => {
    expect(() => paymentDueDate('09/15/2026')).toThrow(DeterminationValidationError);
    expect(() => recordDetermination('T-1', 'D-1', { ...BASE, determinationDate: 'nope' })).toThrow(/determinationDate/);
  });

  it('validates required fields, aggregating problems', () => {
    try {
      recordDetermination('', '', { ...BASE, idreId: '', prevailingParty: 'x' as any, qpa: NaN });
      expect.unreachable();
    } catch (e) {
      const err = e as DeterminationValidationError;
      expect(err.problems.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('rejects empty rationaleFactors', () => {
    expect(() => recordDetermination('T-1', 'D-1', { ...BASE, rationaleFactors: [] })).toThrow(/rationaleFactors/);
  });

  it('emits outcome telemetry with offer distance from QPA', () => {
    const seen: OutcomeTelemetry[] = [];
    recordDetermination('T-1', 'D-1', BASE, (t) => seen.push(t));
    expect(seen).toHaveLength(1);
    expect(seen[0].tenantId).toBe('T-1');
    expect(seen[0].prevailingParty).toBe('initiating');
    expect(seen[0].offerDistanceFromQpa).toBeCloseTo((900 - 300) / 300);
  });

  it('telemetry distance is zero when QPA is zero (no division blowup)', () => {
    const seen: OutcomeTelemetry[] = [];
    recordDetermination('T-1', 'D-1', { ...BASE, qpa: 0, prevailingOffer: 100 }, (t) => seen.push(t));
    expect(seen[0].offerDistanceFromQpa).toBe(0);
  });

  it('preserves optional determinationDocumentRef and copies rationaleFactors', () => {
    const r = recordDetermination('T-1', 'D-1', { ...BASE, determinationDocumentRef: 's3://det/1.pdf' });
    expect(r.determinationDocumentRef).toBe('s3://det/1.pdf');
    expect(r.rationaleFactors).not.toBe(BASE.rationaleFactors);
  });
});

describe('remittanceReconciliation (STATIC-ONLY/BLOCKED)', () => {
  const FLAG = 'REMITTANCE_2027_ENABLED';
  it('BLOCKED before 2027-01-01 even with flag', () => {
    process.env[FLAG] = 'true';
    const r = remittanceReconciliation(new Date(Date.UTC(2026, 8, 5)));
    expect(r.status).toBe('BLOCKED');
    expect(r.reason).toContain('2027-01-01');
    delete process.env[FLAG];
  });

  it('BLOCKED on/after 2027-01-01 without flag', () => {
    delete process.env[FLAG];
    expect(remittanceReconciliation(new Date(Date.UTC(2027, 0, 1))).status).toBe('BLOCKED');
  });

  it('READY (but unimplemented, STATIC-ONLY) on/after 2027-01-01 with flag', () => {
    process.env[FLAG] = 'true';
    const r = remittanceReconciliation(new Date(Date.UTC(2027, 5, 1)));
    expect(r.status).toBe('READY');
    expect(r.reason).toContain('STATIC-ONLY');
    delete process.env[FLAG];
  });
});
