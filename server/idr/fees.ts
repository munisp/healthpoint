/**
 * server/idr/fees.ts
 * Federal IDR fee management — pure configuration and assessment logic.
 *
 * Regulatory grounding (45 CFR § 149.510(d)):
 *   - (d)(1) Administrative fee: each party pays a non-refundable
 *     administrative fee to the Departments for participating in the federal
 *     IDR process. Amount is set by annual guidance, NOT by the CFR text.
 *   - (d)(2) Certified IDR entity fee: the IDRE sets its fee within an
 *     allowable range (single dispute and batched dispute ranges) published
 *     by the Departments. The IDRE fee is paid by the prevailing/non-prevailing
 *     party as allocated in the determination; it must be refunded if the
 *     dispute is found ineligible after selection (§ 149.510(d)(2)(iv)).
 *   - (c)(3) Batching: multiple qualified IDR items/services may be batched
 *     under conditions (same IDRE-eligible items/services, same or similar
 *     service codes, same payer). Specific batching caps and fee amounts have
 *     changed via rulemaking and TMA litigation — they are CONFIGURABLE here.
 *
 * NO fee dollar amount is hardcoded as law. Amounts come from the
 * effective-dated idr_fee_schedules table, optionally seeded from environment
 * variables documented below. If no active schedule exists, assessment
 * returns a `missing_schedule` result rather than inventing a number.
 *
 * Environment seed variables (all integer cents):
 *   IDR_ADMIN_FEE_CENTS              — administrative fee per party
 *   IDR_IDRE_FEE_SINGLE_MIN_CENTS    — certified IDRE fee range, single dispute
 *   IDR_IDRE_FEE_SINGLE_MAX_CENTS
 *   IDR_IDRE_FEE_BATCHED_MIN_CENTS   — certified IDRE fee range, batched dispute
 *   IDR_IDRE_FEE_BATCHED_MAX_CENTS
 *   IDR_BATCHING_MAX_LINE_ITEMS      — batching cap policy value
 *   IDR_FEE_SCHEDULE_EFFECTIVE_FROM  — ISO date the seeded schedule takes effect
 */

import type { IDRFeeSchedule } from "../../drizzle/schema-idr-compliance";

export type FeeScheduleInput = Omit<IDRFeeSchedule, "id" | "createdAt"> & { id?: string };

/** A fee schedule row as stored (subset used by the pure logic). */
export interface FeeScheduleLike {
  id: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  adminFeeCents: number;
  idreFeeSingleMinCents: number | null;
  idreFeeSingleMaxCents: number | null;
  idreFeeBatchedMinCents: number | null;
  idreFeeBatchedMaxCents: number | null;
  currency: string;
}

export type FeePartyRole = "initiating_party" | "responding_party";
export type FeeType = "administrative" | "idre_single" | "idre_batched";

export interface FeeAssessmentLine {
  feeType: FeeType;
  partyRole: FeePartyRole;
  amountCents: number;
  currency: string;
  /** Deterministic key: retrying the same assessment never duplicates. */
  idempotencyKey: string;
}

export type FeeAssessmentResult =
  | { ok: true; scheduleId: string; lines: FeeAssessmentLine[] }
  | { ok: false; reason: "missing_schedule" | "missing_idre_fee_range" | "invalid_party" };

// ── Environment configuration ────────────────────────────────────────────────

export interface FeeEnvConfig {
  adminFeeCents: number | null;
  idreFeeSingleMinCents: number | null;
  idreFeeSingleMaxCents: number | null;
  idreFeeBatchedMinCents: number | null;
  idreFeeBatchedMaxCents: number | null;
  batchingMaxLineItems: number | null;
  effectiveFrom: Date | null;
}

function readCents(env: NodeJS.ProcessEnv, key: string): number | null {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`[idr-fees] ${key} must be a non-negative integer (cents), got "${raw}"`);
  }
  return parsed;
}

/**
 * Read the optional fee-schedule seed from the environment.
 * Returns nulls when unset — the caller decides whether to seed a schedule.
 * NEVER returns an invented amount.
 */
export function getFeeEnvConfig(env: NodeJS.ProcessEnv = process.env): FeeEnvConfig {
  const effRaw = env.IDR_FEE_SCHEDULE_EFFECTIVE_FROM?.trim();
  let effectiveFrom: Date | null = null;
  if (effRaw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effRaw)) {
      throw new Error(`[idr-fees] IDR_FEE_SCHEDULE_EFFECTIVE_FROM must be an ISO date (YYYY-MM-DD), got "${effRaw}"`);
    }
    effectiveFrom = new Date(effRaw + "T00:00:00Z");
  }
  return {
    adminFeeCents: readCents(env, "IDR_ADMIN_FEE_CENTS"),
    idreFeeSingleMinCents: readCents(env, "IDR_IDRE_FEE_SINGLE_MIN_CENTS"),
    idreFeeSingleMaxCents: readCents(env, "IDR_IDRE_FEE_SINGLE_MAX_CENTS"),
    idreFeeBatchedMinCents: readCents(env, "IDR_IDRE_FEE_BATCHED_MIN_CENTS"),
    idreFeeBatchedMaxCents: readCents(env, "IDR_IDRE_FEE_BATCHED_MAX_CENTS"),
    batchingMaxLineItems: readCents(env, "IDR_BATCHING_MAX_LINE_ITEMS"),
    effectiveFrom,
  };
}

/** Build a schedule row from env config; null when no admin fee is configured. */
export function buildEnvFeeSchedule(
  env: NodeJS.ProcessEnv = process.env,
  createdBy = "system:env-seed"
): Omit<FeeScheduleLike, "id"> & { source: string; notes: string; createdBy: string; batchingMaxLineItems: number | null } | null {
  const cfg = getFeeEnvConfig(env);
  if (cfg.adminFeeCents === null) return null;
  return {
    effectiveFrom: cfg.effectiveFrom ?? new Date(Date.UTC(2026, 0, 1)),
    effectiveTo: null,
    adminFeeCents: cfg.adminFeeCents,
    idreFeeSingleMinCents: cfg.idreFeeSingleMinCents,
    idreFeeSingleMaxCents: cfg.idreFeeSingleMaxCents,
    idreFeeBatchedMinCents: cfg.idreFeeBatchedMinCents,
    idreFeeBatchedMaxCents: cfg.idreFeeBatchedMaxCents,
    batchingMaxLineItems: cfg.batchingMaxLineItems,
    currency: "USD",
    source: "env:IDR_ADMIN_FEE_CENTS et al.",
    notes:
      "Seeded from environment configuration. Administrative fee and certified IDRE fee ranges " +
      "are set by Departments of HHS/Labor/Treasury guidance under 45 CFR § 149.510(d) and are " +
      "subject to rulemaking change (see TMA v. HHS litigation history). Verify against current " +
      "CMS guidance before relying on these amounts.",
    createdBy,
  };
}

// ── Effective-dated schedule selection ───────────────────────────────────────

/**
 * Select the schedule in effect at `at`: the row with the greatest
 * effectiveFrom <= at whose effectiveTo is null or > at. Returns null when
 * no schedule covers the instant.
 */
export function selectActiveSchedule(schedules: FeeScheduleLike[], at: Date): FeeScheduleLike | null {
  let best: FeeScheduleLike | null = null;
  for (const s of schedules) {
    if (s.effectiveFrom.getTime() > at.getTime()) continue;
    if (s.effectiveTo && s.effectiveTo.getTime() <= at.getTime()) continue;
    if (!best || s.effectiveFrom.getTime() > best.effectiveFrom.getTime()) best = s;
  }
  return best;
}

// ── Assessment construction (idempotent) ─────────────────────────────────────

/**
 * Deterministic idempotency key for one assessment line.
 * Keyed by (dispute, fee type, party role) so retries and duplicate calls
 * converge on the same row; the DB unique index enforces it.
 */
export function feeIdempotencyKey(disputeId: string, feeType: FeeType, partyRole: FeePartyRole): string {
  return `fee:${disputeId}:${feeType}:${partyRole}`;
}

/**
 * Build the administrative-fee assessment lines for IDR initiation: one
 * non-refundable administrative fee PER PARTY (45 CFR § 149.510(d)(1)).
 */
export function buildAdminFeeAssessments(
  disputeId: string,
  schedule: FeeScheduleLike | null,
  parties: { initiatingPartyId: string | null; respondingPartyId: string | null }
): FeeAssessmentResult {
  if (!schedule) return { ok: false, reason: "missing_schedule" };
  const lines: FeeAssessmentLine[] = [];
  for (const partyRole of ["initiating_party", "responding_party"] as const) {
    const partyId = partyRole === "initiating_party" ? parties.initiatingPartyId : parties.respondingPartyId;
    if (!partyId) return { ok: false, reason: "invalid_party" };
    lines.push({
      feeType: "administrative",
      partyRole,
      amountCents: schedule.adminFeeCents,
      currency: schedule.currency,
      idempotencyKey: feeIdempotencyKey(disputeId, "administrative", partyRole),
    });
  }
  return { ok: true, scheduleId: schedule.id, lines };
}

/**
 * Build a certified-IDRE-fee assessment line at the chosen amount. The amount
 * must fall within the schedule's allowable range for the dispute kind
 * (single vs batched) when a range is configured (45 CFR § 149.510(d)(2)).
 * The fee is assessed to the NON-prevailing party per the determination.
 */
export function buildIdreFeeAssessment(
  disputeId: string,
  schedule: FeeScheduleLike | null,
  opts: { batched: boolean; amountCents: number; nonPrevailingPartyRole: FeePartyRole }
): FeeAssessmentResult & { withinRange?: boolean } {
  if (!schedule) return { ok: false, reason: "missing_schedule" };
  const min = opts.batched ? schedule.idreFeeBatchedMinCents : schedule.idreFeeSingleMinCents;
  const max = opts.batched ? schedule.idreFeeBatchedMaxCents : schedule.idreFeeSingleMaxCents;
  if (min === null || max === null) return { ok: false, reason: "missing_idre_fee_range" };
  const withinRange = opts.amountCents >= min && opts.amountCents <= max;
  return {
    ok: true,
    scheduleId: schedule.id,
    withinRange,
    lines: [
      {
        feeType: opts.batched ? "idre_batched" : "idre_single",
        partyRole: opts.nonPrevailingPartyRole,
        amountCents: opts.amountCents,
        currency: schedule.currency,
        idempotencyKey: feeIdempotencyKey(disputeId, opts.batched ? "idre_batched" : "idre_single", opts.nonPrevailingPartyRole),
      },
    ],
  };
}

// ── Payment status transitions ───────────────────────────────────────────────

export type FeePaymentStatus = "assessed" | "invoiced" | "paid" | "waived" | "refunded" | "void";

const FEE_STATUS_TRANSITIONS: Record<FeePaymentStatus, FeePaymentStatus[]> = {
  assessed: ["invoiced", "paid", "waived", "void"],
  invoiced: ["paid", "waived", "void"],
  paid: ["refunded"], // refund path exists for certified IDRE fees on ineligibility (§ 149.510(d)(2)(iv))
  waived: [],
  refunded: [],
  void: [],
};

export function canTransitionFeeStatus(from: FeePaymentStatus, to: FeePaymentStatus, feeType?: FeeType): boolean {
  if (!(FEE_STATUS_TRANSITIONS[from] ?? []).includes(to)) return false;
  // The administrative fee is NON-REFUNDABLE (45 CFR § 149.510(d)(1)); only
  // certified IDRE entity fees may be refunded (e.g. on post-selection
  // ineligibility, § 149.510(d)(2)(iv)).
  if (to === "refunded" && feeType === "administrative") return false;
  return true;
}

export function assertFeeStatusTransition(from: FeePaymentStatus, to: FeePaymentStatus, feeType?: FeeType): void {
  if (!canTransitionFeeStatus(from, to, feeType)) {
    throw new Error(`Invalid fee status transition: ${from} → ${to}${feeType ? ` for fee type ${feeType}` : ""}`);
  }
}
