/**
 * server/idr/batching/batching.ts
 * Batched-dispute eligibility evaluation for the Federal IDR process.
 *
 * Regulatory basis (verified 2026-09-07):
 *  - 45 CFR § 149.510(c)(4)(i)(A)–(D): qualified IDR items/services may be
 *    batched when they are (A) billed by the same provider, group of
 *    providers, or facility under the same NPI or TIN; (B) paid (or denied)
 *    by the same group health plan or health insurance issuer (or FEHB
 *    carrier); (C) the same or similar item or service (same service code,
 *    or codes in the same Category I CPT code range for anesthesiology,
 *    radiology, pathology, laboratory items/services); and (D) furnished
 *    within the same 30-business-day period following the date the first
 *    batched item or service was furnished.
 *    Sources:
 *      https://www.cms.gov/files/document/federal-idr-guidance-idr-entities-march-2023.pdf
 *      https://public-inspection.federalregister.gov/2023-23716.pdf (proposed (c)(4)(i)(D) text)
 *  - Line-item cap: legacy maximum 25 line items per batched dispute; raised
 *    to 50 by CMS-9897-F (Federal Independent Dispute Resolution Operations
 *    Final Rule, published 91 FR 33900, effective 2026-08-03). Per the CMS
 *    implementation timeline, "Any batched dispute submitted with an open
 *    negotiation start date on or after November 1, 2026, will be limited to
 *    50 dispute line items" — i.e., the 50-item cap applies to disputes whose
 *    open negotiation period (ONP) begins on or after 2026-11-01; the 25-item
 *    cap applies before that date.
 *    Sources:
 *      https://www.cms.gov/files/document/federal-idr-operations-implementation-timeline.pdf
 *      https://www.cms.gov/nosurprises/notices
 *
 * FAIL-CLOSED: unknown/ambiguous input (missing provider/payer/service-code
 * identifiers, missing dates of service, or a missing ONP start date) resolves
 * toward ineligibility or toward the lower (25-item) cap, never permissive.
 */

import {
  businessDaysBetween,
  getDeadlinePolicy,
  type IDRDeadlinePolicy,
} from "../deadlines";

export interface LineItemInput {
  lineItemId: string;
  /** Service/billing code (CPT/HCPCS/DRG), with modifiers if applicable. */
  serviceCode: string;
  /** Billing provider NPI or group TIN (must be identical across the batch). */
  providerNpi?: string;
  providerTin?: string;
  /** Payer: same group health plan / issuer / FEHB carrier identifier. */
  payerId: string;
  /** Whether the item is a qualified IDR item or service. */
  qualifiedIdrItem: boolean;
  /** Date of service (UTC). Required for criterion (D). */
  dateOfService?: Date;
}

export interface BatchEligibilityOptions {
  /**
   * Date the open negotiation period for this dispute begins. Drives which
   * line-item cap applies (25 before 2026-11-01, 50 on/after). If omitted,
   * fail-closed to the legacy 25-item cap.
   */
  openNegotiationNoticeDate?: Date;
  env?: NodeJS.ProcessEnv;
}

export interface BatchEligibilityResult {
  eligible: boolean;
  failures: string[];
  appliedCriteria: string[];
  capApplied: number;
  citations: string[];
}

export const BATCHING_CITATIONS = [
  "45 CFR 149.510(c)(4)(i)(A)-(D)",
  "CMS-9897-F (91 FR 33900, eff. 2026-08-03)",
  "https://www.cms.gov/files/document/federal-idr-operations-implementation-timeline.pdf",
  "https://www.cms.gov/nosurprises/notices",
] as const;

/** Applicability date of the CMS-9897-F 50-item cap (ONPs beginning on/after). */
export const BATCH_CAP_50_EFFECTIVE = "2026-11-01";
export const LEGACY_BATCH_CAP = 25;
export const AMENDED_BATCH_CAP = 50;

/** Criterion (D): batched items must be furnished within a 30-business-day period. */
export const BATCH_SERVICE_WINDOW_BUSINESS_DAYS = 30;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Resolve the applicable line-item cap. Effective-dated on the ONP start date;
 * overridable via IDR_BATCH_CAP (fail-closed: invalid override is ignored and
 * the statutory cap applies — the cap is an upper bound, never relaxed by env
 * beyond the statutory value for the period).
 */
export function applicableBatchCap(
  openNegotiationNoticeDate: Date | undefined,
  env: NodeJS.ProcessEnv = process.env
): { cap: number; basis: string } {
  const statutoryCap =
    openNegotiationNoticeDate && isoDay(openNegotiationNoticeDate) >= BATCH_CAP_50_EFFECTIVE
      ? AMENDED_BATCH_CAP
      : LEGACY_BATCH_CAP;
  const basis =
    openNegotiationNoticeDate === undefined
      ? `No open-negotiation start date supplied; failing closed to legacy ${LEGACY_BATCH_CAP}-item cap (45 CFR 149.510(c)(4)(i), pre-CMS-9897-F).`
      : statutoryCap === AMENDED_BATCH_CAP
        ? `ONP begins ${isoDay(openNegotiationNoticeDate)} (on/after ${BATCH_CAP_50_EFFECTIVE}); CMS-9897-F 50-item cap applies. Source: https://www.cms.gov/files/document/federal-idr-operations-implementation-timeline.pdf`
        : `ONP begins ${isoDay(openNegotiationNoticeDate)} (before ${BATCH_CAP_50_EFFECTIVE}); legacy 25-item cap applies.`;

  const raw = env.IDR_BATCH_CAP;
  if (raw !== undefined && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= statutoryCap) {
      return { cap: parsed, basis: `${basis} Env IDR_BATCH_CAP=${parsed} tightens the cap.` };
    }
  }
  return { cap: statutoryCap, basis };
}

/**
 * Evaluate whether a set of line items may be submitted as one batched
 * determination under 45 CFR § 149.510(c)(4)(i)(A)–(D) and the applicable
 * line-item cap.
 */
export function evaluateBatchEligibility(
  items: LineItemInput[],
  opts: BatchEligibilityOptions = {}
): BatchEligibilityResult {
  const failures: string[] = [];
  const appliedCriteria: string[] = [];
  const policy: IDRDeadlinePolicy = getDeadlinePolicy(opts.env ?? process.env);

  if (!Array.isArray(items) || items.length === 0) {
    return {
      eligible: false,
      failures: ["Batch is empty; a batched dispute requires at least two qualified IDR line items."],
      appliedCriteria,
      capApplied: LEGACY_BATCH_CAP,
      citations: [...BATCHING_CITATIONS],
    };
  }
  if (items.length < 2) {
    failures.push("Batch contains fewer than 2 line items; use a single dispute instead.");
  }

  // ── Cap check (fail closed; effective-dated) ────────────────────────────
  const { cap, basis } = applicableBatchCap(opts.openNegotiationNoticeDate, opts.env ?? process.env);
  appliedCriteria.push(basis);
  if (items.length > cap) {
    failures.push(
      `Batch has ${items.length} line items, exceeding the applicable ${cap}-line-item cap. ${basis}`
    );
  }

  // ── Qualified IDR items only ────────────────────────────────────────────
  const nonQualified = items.filter(i => !i.qualifiedIdrItem);
  if (nonQualified.length > 0) {
    failures.push(
      `Non-qualified items may not be batched: ${nonQualified.map(i => i.lineItemId).join(", ")}.`
    );
  }
  appliedCriteria.push("All line items must be qualified IDR items or services (45 CFR 149.510(c)(4)(i)).");

  // ── Criterion (A): same provider/facility/group (same NPI or TIN) ───────
  const providerKey = (i: LineItemInput) => i.providerNpi ?? i.providerTin ?? null;
  const providerKeys = new Set(items.map(providerKey));
  if (providerKeys.has(null)) {
    failures.push("Criterion (A) fail-closed: at least one line item lacks a provider NPI/TIN identifier.");
  } else if (providerKeys.size > 1) {
    failures.push("Criterion (A) failed: line items are not billed by the same provider/group/facility under the same NPI or TIN.");
  }
  appliedCriteria.push("(A) Same provider, group of providers, or facility under the same NPI or TIN — 45 CFR 149.510(c)(4)(i)(A).");

  // ── Criterion (B): same payer (same plan/issuer/FEHB carrier) ───────────
  const payerKeys = new Set(items.map(i => (i.payerId ?? "").trim()));
  if (payerKeys.has("")) {
    failures.push("Criterion (B) fail-closed: at least one line item lacks a payer identifier.");
  } else if (payerKeys.size > 1) {
    failures.push("Criterion (B) failed: payment (or denial) for the line items would not be made by the same plan or issuer.");
  }
  appliedCriteria.push("(B) Same group health plan or health insurance issuer (or FEHB carrier) — 45 CFR 149.510(c)(4)(i)(B).");

  // ── Criterion (C): same or similar item or service by service code ──────
  const codeKeys = new Set(items.map(i => (i.serviceCode ?? "").trim().toUpperCase()));
  if (codeKeys.has("")) {
    failures.push("Criterion (C) fail-closed: at least one line item lacks a service code.");
  } else if (codeKeys.size > 1) {
    failures.push(
      "Criterion (C) failed: line items are not billed under the same service code. " +
        "(Comparable codes / same Category I CPT code range are not inferable from codes alone and must be resolved upstream.)"
    );
  }
  appliedCriteria.push("(C) Same or similar item or service by service code — 45 CFR 149.510(c)(4)(i)(C).");

  // ── Criterion (D): furnished within the same 30-business-day period ─────
  if (items.some(i => !(i.dateOfService instanceof Date) || Number.isNaN(i.dateOfService.getTime()))) {
    failures.push("Criterion (D) fail-closed: at least one line item lacks a valid date of service.");
  } else {
    const sorted = [...items].sort(
      (a, b) => a.dateOfService!.getTime() - b.dateOfService!.getTime()
    );
    const first = sorted[0].dateOfService!;
    const last = sorted[sorted.length - 1].dateOfService!;
    const span = businessDaysBetween(first, last, policy);
    if (span > BATCH_SERVICE_WINDOW_BUSINESS_DAYS) {
      failures.push(
        `Criterion (D) failed: first and last dates of service are ${span} business days apart; ` +
          `batched items must be furnished within the same ${BATCH_SERVICE_WINDOW_BUSINESS_DAYS}-business-day period following the first item's date of service (45 CFR 149.510(c)(4)(i)(D)).`
      );
    }
  }
  appliedCriteria.push("(D) Furnished within the same 30-business-day period following the first item's date of service — 45 CFR 149.510(c)(4)(i)(D).");

  return {
    eligible: failures.length === 0,
    failures,
    appliedCriteria,
    capApplied: cap,
    citations: [...BATCHING_CITATIONS],
  };
}
