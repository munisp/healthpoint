/**
 * Patient-Provider Dispute Resolution (PPDR) — 45 CFR 149.620.
 *
 * Eligibility (149.620(b)):
 * - Individual is uninsured or self-pay (no plan/insurance coverage billed).
 * - Billed charges are "substantially in excess" of the good faith estimate:
 *   total billed exceeds the GFE total by at least $400 (per provider/facility).
 * - Dispute initiated within 120 calendar days of the initial bill.
 *
 * Process (149.620(c)-(f)): an administrative fee is paid to the certified
 * dispute entity; the fee amount is set by annual HHS guidance and MUST be
 * injected as configuration (never hardcoded). The PPDR entity reviews GFE,
 * bill, and documentation; the determination is binding (subject to limited
 * exceptions: fraud/misrepresentation). If the provider/facility is found to
 * have billed substantially in excess, the billed amount is reduced to the
 * lesser of the billed charges, the GFE amount, or the amount determined by
 * the PPDR entity; the individual pays no more than the GFE total.
 *
 * FSM: DRAFT → INITIATED → DOCS_PENDING → UNDER_REVIEW → DETERMINED →
 *      CLOSED | INELIGIBLE (from any pre-determination state)
 */

export const SUBSTANTIALLY_IN_EXCESS_THRESHOLD_USD = 400;
export const INITIATION_WINDOW_CALENDAR_DAYS = 120;

export type PpdrState =
  | 'DRAFT'
  | 'INITIATED'
  | 'DOCS_PENDING'
  | 'UNDER_REVIEW'
  | 'DETERMINED'
  | 'CLOSED'
  | 'INELIGIBLE';

export interface PpdrEvent {
  type: 'TRANSITION' | 'ELIGIBILITY_CHECK' | 'DETERMINATION_RECORDED';
  at: Date;
  from?: PpdrState;
  to?: PpdrState;
  detail?: string;
}

/**
 * Per-provider/facility totals. 45 CFR 149.620(b) evaluates the $400
 * "substantially in excess" threshold PER provider/facility: if any single
 * provider's billed charges exceed that provider's GFE total by >= $400, the
 * dispute is eligible even when the aggregate excess is below $400.
 */
export interface PpdrProviderTotal {
  /** Provider/facility reference (NPI, TIN, or internal facility id). */
  providerRef: string;
  billedUsd: number;
  gfeUsd: number;
}

export interface PpdrDispute {
  id: string;
  state: PpdrState;
  gfeTotalUsd: number;
  billedTotalUsd: number;
  /**
   * Optional per-provider/facility totals. When absent, the single aggregate
   * totals map to one implicit provider (backward-compatible).
   */
  providerTotals?: PpdrProviderTotal[];
  billedAt: Date;
  /** Coverage: true when any plan/insurance coverage was billed (disqualifying). */
  insuranceBilled: boolean;
  adminFeeUsd: number | null;
  determination: PpdrDetermination | null;
  events: readonly PpdrEvent[];
}

export interface PpdrDetermination {
  /** Certified PPDR entity identifier (from the HHS certification roster). */
  entityId: string;
  determinedAt: Date;
  /** Amount the individual must pay after determination. */
  patientOwesUsd: number;
  /** Binding unless fraud/misrepresentation is later established. */
  binding: boolean;
  rationale: string;
}

export interface EligibilityResult {
  eligible: boolean;
  excessUsd: number;
  daysSinceBill: number;
  reasons: string[];
  /** Per-provider excess detail (billed − GFE) used for the $400 test. */
  providerExcesses: { providerRef: string; excessUsd: number }[];
  /** Providers whose individual excess meets the $400 threshold. */
  qualifyingProviders: string[];
}

/** Resolve the effective per-provider totals (single-total → one implicit provider). */
export function resolveProviderTotals(input: {
  gfeTotalUsd: number;
  billedTotalUsd: number;
  providerTotals?: PpdrProviderTotal[];
}): PpdrProviderTotal[] {
  if (input.providerTotals && input.providerTotals.length > 0) {
    return input.providerTotals;
  }
  return [{ providerRef: 'aggregate', billedUsd: input.billedTotalUsd, gfeUsd: input.gfeTotalUsd }];
}

function calendarDaysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Evaluates PPDR eligibility (149.620(b)). Fail-closed: unknown coverage
 * (insuranceBilled undefined is not representable here — the caller must
 * supply a boolean) and any failed criterion yields eligible=false with
 * explicit reasons.
 */
export function evaluatePpdrEligibility(input: {
  gfeTotalUsd: number;
  billedTotalUsd: number;
  billedAt: Date;
  insuranceBilled: boolean;
  /**
   * Optional per-provider/facility totals. The $400 "substantially in excess"
   * test is evaluated PER provider (45 CFR 149.620(b)): ANY single provider
   * whose billed charges exceed their GFE total by >= $400 qualifies.
   * Absent this, the aggregate totals are treated as one implicit provider.
   */
  providerTotals?: PpdrProviderTotal[];
  /** Reference date; defaults to now. */
  asOf?: Date;
}): EligibilityResult {
  const { gfeTotalUsd, billedTotalUsd, billedAt, insuranceBilled } = input;
  if (!(billedAt instanceof Date) || Number.isNaN(billedAt.getTime())) {
    throw new Error('billedAt must be a valid Date');
  }
  if (!Number.isFinite(gfeTotalUsd) || gfeTotalUsd < 0) throw new Error('gfeTotalUsd must be >= 0');
  if (!Number.isFinite(billedTotalUsd) || billedTotalUsd < 0) throw new Error('billedTotalUsd must be >= 0');
  for (const p of input.providerTotals ?? []) {
    if (!p || typeof p.providerRef !== 'string' || p.providerRef.length === 0) {
      throw new Error('providerTotals entries require a non-empty providerRef');
    }
    if (!Number.isFinite(p.billedUsd) || p.billedUsd < 0) throw new Error('providerTotals billedUsd must be >= 0');
    if (!Number.isFinite(p.gfeUsd) || p.gfeUsd < 0) throw new Error('providerTotals gfeUsd must be >= 0');
  }
  const asOf = input.asOf ?? new Date();
  const excessUsd = billedTotalUsd - gfeTotalUsd;
  const daysSinceBill = calendarDaysBetween(billedAt, asOf);

  // Per-provider/facility $400 test (149.620(b)).
  const perProvider = resolveProviderTotals(input);
  const providerExcesses = perProvider.map(p => ({
    providerRef: p.providerRef,
    excessUsd: p.billedUsd - p.gfeUsd,
  }));
  const qualifyingProviders = providerExcesses
    .filter(p => p.excessUsd >= SUBSTANTIALLY_IN_EXCESS_THRESHOLD_USD)
    .map(p => p.providerRef);

  const reasons: string[] = [];
  if (insuranceBilled) {
    reasons.push(
      'Items/services were billed to a plan or insurance coverage; PPDR is only ' +
        'for uninsured/self-pay individuals (45 CFR 149.620(b)).',
    );
  }
  if (qualifyingProviders.length === 0) {
    reasons.push(
      `No single provider/facility billed >= $${SUBSTANTIALLY_IN_EXCESS_THRESHOLD_USD} over its ` +
        `GFE total (per-provider excesses: ` +
        providerExcesses.map(p => `${p.providerRef}: $${p.excessUsd.toFixed(2)}`).join(', ') +
        `; aggregate excess $${excessUsd.toFixed(2)}). The "substantially in excess" ` +
        'threshold is evaluated per provider/facility (45 CFR 149.620(b)).',
    );
  }
  if (daysSinceBill > INITIATION_WINDOW_CALENDAR_DAYS) {
    reasons.push(
      `Dispute initiated ${daysSinceBill} calendar days after the initial bill; ` +
        `the window is ${INITIATION_WINDOW_CALENDAR_DAYS} calendar days ` +
        '(45 CFR 149.620(b)).',
    );
  }
  return { eligible: reasons.length === 0, excessUsd, daysSinceBill, reasons, providerExcesses, qualifyingProviders };
}

const ALLOWED: Record<PpdrState, readonly PpdrState[]> = {
  DRAFT: ['INITIATED', 'INELIGIBLE'],
  INITIATED: ['DOCS_PENDING', 'UNDER_REVIEW', 'INELIGIBLE'],
  DOCS_PENDING: ['UNDER_REVIEW', 'INELIGIBLE'],
  UNDER_REVIEW: ['DETERMINED', 'DOCS_PENDING', 'INELIGIBLE'],
  DETERMINED: ['CLOSED'],
  CLOSED: [],
  INELIGIBLE: [],
};

export function createPpdrDispute(init: {
  id: string;
  gfeTotalUsd: number;
  billedTotalUsd: number;
  billedAt: Date;
  insuranceBilled: boolean;
  providerTotals?: PpdrProviderTotal[];
}): PpdrDispute {
  if (!init.id) throw new Error('id is required');
  if (!(init.billedAt instanceof Date) || Number.isNaN(init.billedAt.getTime())) {
    throw new Error('billedAt must be a valid Date');
  }
  return {
    id: init.id,
    state: 'DRAFT',
    gfeTotalUsd: init.gfeTotalUsd,
    billedTotalUsd: init.billedTotalUsd,
    ...(init.providerTotals ? { providerTotals: init.providerTotals } : {}),
    billedAt: init.billedAt,
    insuranceBilled: init.insuranceBilled,
    adminFeeUsd: null,
    determination: null,
    events: [],
  };
}

function appendEvent(d: PpdrDispute, event: PpdrEvent): PpdrDispute {
  return { ...d, events: [...d.events, event] };
}

export interface TransitionOptions {
  now?: Date;
  /**
   * Administrative fee (USD) as set by current annual HHS guidance. REQUIRED
   * for INITIATED; never defaulted — configuration injection is mandatory
   * because the amount changes by guidance year.
   */
  adminFeeUsd?: number;
  determination?: Omit<PpdrDetermination, 'binding'>;
}

export function transition(d: PpdrDispute, to: PpdrState, options: TransitionOptions = {}): PpdrDispute {
  const now = options.now ?? new Date();
  const from = d.state;
  if (!ALLOWED[from].includes(to)) {
    throw new Error(`Invalid PPDR transition: ${from} -> ${to}`);
  }

  let next: PpdrDispute = { ...d };

  if (to === 'INITIATED') {
    const fee = options.adminFeeUsd;
    if (fee === undefined || !Number.isFinite(fee) || fee < 0) {
      throw new Error(
        'INITIATED requires adminFeeUsd injected from current annual HHS ' +
          'guidance (45 CFR 149.620(d)); no hardcoded default is permitted.',
      );
    }
    next = { ...next, adminFeeUsd: fee };
    const eligibility = evaluatePpdrEligibility({
      gfeTotalUsd: d.gfeTotalUsd,
      billedTotalUsd: d.billedTotalUsd,
      billedAt: d.billedAt,
      insuranceBilled: d.insuranceBilled,
      providerTotals: d.providerTotals,
      asOf: now,
    });
    next = appendEvent(next, {
      type: 'ELIGIBILITY_CHECK',
      at: now,
      detail: eligibility.eligible
        ? `Eligible: billed exceeds GFE by $${eligibility.excessUsd.toFixed(2)}, ` +
          `${eligibility.daysSinceBill} days since bill.`
        : `Ineligible: ${eligibility.reasons.join(' | ')}`,
    });
    if (!eligibility.eligible) {
      throw new Error('PPDR eligibility check failed: ' + eligibility.reasons.join('; '));
    }
  }

  if (to === 'INELIGIBLE') {
    // Explicit ineligibility must be justified against the same criteria.
    const eligibility = evaluatePpdrEligibility({
      gfeTotalUsd: d.gfeTotalUsd,
      billedTotalUsd: d.billedTotalUsd,
      billedAt: d.billedAt,
      insuranceBilled: d.insuranceBilled,
      providerTotals: d.providerTotals,
      asOf: now,
    });
    if (eligibility.eligible) {
      throw new Error('Cannot mark INELIGIBLE: dispute satisfies 45 CFR 149.620(b) criteria.');
    }
    next = appendEvent(next, {
      type: 'ELIGIBILITY_CHECK',
      at: now,
      detail: `Ineligible: ${eligibility.reasons.join(' | ')}`,
    });
  }

  if (to === 'DETERMINED') {
    const det = options.determination;
    if (!det) throw new Error('DETERMINED requires a determination payload');
    if (!det.entityId) throw new Error('determination.entityId is required (certified PPDR entity)');
    if (!Number.isFinite(det.patientOwesUsd) || det.patientOwesUsd < 0) {
      throw new Error('determination.patientOwesUsd must be >= 0');
    }
    if (det.patientOwesUsd > d.gfeTotalUsd) {
      throw new Error(
        'Determination cannot leave the individual owing more than the GFE ' +
          'total when the provider billed substantially in excess ' +
          '(45 CFR 149.620(f)).',
      );
    }
    const determination: PpdrDetermination = { ...det, binding: true };
    next = { ...next, determination };
    next = appendEvent(next, {
      type: 'DETERMINATION_RECORDED',
      at: now,
      detail: `Entity ${det.entityId}: patient owes $${det.patientOwesUsd.toFixed(2)} (binding).`,
    });
  }

  next = appendEvent(next, { type: 'TRANSITION', at: now, from, to });
  return { ...next, state: to };
}
