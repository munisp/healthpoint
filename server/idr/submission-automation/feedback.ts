/**
 * feedback.ts
 *
 * Determination feedback ingestion + follow-through for the federal IDR
 * process. Pure functions; no network calls.
 *
 * - recordDetermination(): validates and stores a certified IDRE
 *   determination, computes the 30-calendar-day payment due date
 *   (45 CFR 149.510(c)(4)(vii)-style payment clock — pure calendar math,
 *   no holiday adjustment), and emits outcome telemetry for the empirical
 *   win-rate program.
 * - remittanceReconciliation(): STATIC-ONLY/BLOCKED stub — CARC/RARC
 *   remittance data elements apply to items/services furnished on or after
 *   2027-01-01 (CMS-9897-F); not yet operative.
 */

export type PrevailingParty = 'initiating' | 'responding';

export interface DeterminationInput {
  idreId: string;
  determinationDate: string; // ISO date, e.g. '2026-09-15'
  prevailingParty: PrevailingParty;
  prevailingOffer: number;
  qpa: number;
  otherOffer: number;
  rationaleFactors: string[];
  adminFeeAmount: number;
  idreFeeAmount: number;
  determinationDocumentRef?: string;
}

export interface OutcomeTelemetry {
  tenantId: string;
  disputeId: string;
  prevailingParty: PrevailingParty;
  offerDistanceFromQpa: number;
  recordedAt: string;
}

export interface DeterminationRecord extends DeterminationInput {
  disputeId: string;
  tenantId: string;
  paymentDueDate: string; // determinationDate + 30 calendar days
  telemetry: OutcomeTelemetry;
}

export type TelemetrySink = (t: OutcomeTelemetry) => void;

export class DeterminationValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid determination: ${problems.join('; ')}`);
    this.name = 'DeterminationValidationError';
  }
}

/** determinationDate + 30 calendar days, pure UTC calendar math. */
export function paymentDueDate(determinationDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(determinationDate.trim());
  if (!m) throw new DeterminationValidationError([`determinationDate must be YYYY-MM-DD, got '${determinationDate}'`]);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (isNaN(d.getTime())) throw new DeterminationValidationError(['determinationDate is not a real date']);
  d.setUTCDate(d.getUTCDate() + 30);
  return d.toISOString().slice(0, 10);
}

export function recordDetermination(
  tenantId: string,
  disputeId: string,
  input: DeterminationInput,
  sink?: TelemetrySink,
  now?: Date
): DeterminationRecord {
  const problems: string[] = [];
  if (typeof input.idreId !== 'string' || input.idreId.trim().length === 0) problems.push('idreId is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.determinationDate ?? '')) problems.push('determinationDate must be YYYY-MM-DD');
  if (input.prevailingParty !== 'initiating' && input.prevailingParty !== 'responding')
    problems.push("prevailingParty must be 'initiating' or 'responding'");
  for (const k of ['prevailingOffer', 'qpa', 'otherOffer', 'adminFeeAmount', 'idreFeeAmount'] as const) {
    if (typeof input[k] !== 'number' || !isFinite(input[k])) problems.push(`${k} must be a finite number`);
  }
  if (!Array.isArray(input.rationaleFactors) || input.rationaleFactors.length === 0)
    problems.push('rationaleFactors must be a non-empty array');
  if (typeof tenantId !== 'string' || tenantId.trim().length === 0) problems.push('tenantId is required');
  if (typeof disputeId !== 'string' || disputeId.trim().length === 0) problems.push('disputeId is required');
  if (problems.length > 0) throw new DeterminationValidationError(problems);

  const telemetry: OutcomeTelemetry = {
    tenantId: tenantId.trim(),
    disputeId: disputeId.trim(),
    prevailingParty: input.prevailingParty,
    offerDistanceFromQpa:
      input.qpa !== 0 ? Math.abs(input.prevailingOffer - input.qpa) / Math.abs(input.qpa) : 0,
    recordedAt: (now ?? new Date()).toISOString(),
  };
  sink?.(telemetry);

  return {
    ...input,
    rationaleFactors: [...input.rationaleFactors],
    disputeId: disputeId.trim(),
    tenantId: tenantId.trim(),
    paymentDueDate: paymentDueDate(input.determinationDate),
    telemetry,
  };
}

export interface RemittanceReconciliationResult {
  status: 'BLOCKED' | 'READY';
  reason: string;
}

/**
 * STATIC-ONLY/BLOCKED: CARC/RARC remittance advice data elements under
 * CMS-9897-F apply only to items/services furnished on or after 2027-01-01.
 * Until that date (and the feature flag), no reconciliation can be computed.
 */
export function remittanceReconciliation(now?: Date): RemittanceReconciliationResult {
  const d = now ?? new Date();
  const flag = process.env.REMITTANCE_2027_ENABLED === 'true';
  const operative = d.getTime() >= Date.UTC(2027, 0, 1);
  if (operative && flag) {
    return {
      status: 'READY',
      reason: 'CARC/RARC remittance data elements operative (>= 2027-01-01) and REMITTANCE_2027_ENABLED=true; reconciliation logic not yet implemented — STATIC-ONLY.',
    };
  }
  return {
    status: 'BLOCKED',
    reason:
      'CARC/RARC remittance advice data elements apply to items/services furnished on or after 2027-01-01 (CMS-9897-F); not yet operative',
  };
}
