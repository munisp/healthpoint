/**
 * server/idr/initiation-guards.ts
 * Statutory guards enforced at dispute creation and at the transition into
 * STEP_04_IDR_INITIATED:
 *
 *  - S2/S3 late-initiation screen (45 CFR § 149.510(b)(2)(i)): IDR must be
 *    initiated within 4 business days after the end of the 30-business-day
 *    open negotiation period. The ON period anchors on the date of the
 *    initial payment / notice of denial (disputes.initialPaymentDate), via
 *    the canonical deadlines engine (computeIDRDeadlines).
 *  - S4 cooling-off screen (45 CFR 149.510(c)(4)(vii)(B)): after a payment
 *    determination, the initiating party may not initiate a subsequent IDR
 *    against the same other party for the same or similar item/service during
 *    the 90-calendar-day suspension period (30 business days for batched
 *    disputes under CMS-9897-F — see cooling-off.ts).
 *
 * Both guards return structured results; the router layer decides whether to
 * reject (HTTP 400) or record an admin-override compliance note.
 */

import { and, eq, isNotNull, or, inArray } from "drizzle-orm";
import { disputes, disputeEvents } from "../../drizzle/schema";
import { computeIDRDeadlines, addBusinessDays, isBusinessDay } from "./deadlines";
import { computeCoolingOff, type DisputeType } from "./cooling-off/cooling-off";

// ── S2/S3: late IDR initiation ───────────────────────────────────────────────

export interface LateInitiationCheck {
  /** True when initiation is happening after the statutory 4-BD window. */
  late: boolean;
  /** End of the 30-BD open negotiation period (anchor: initialPaymentDate). */
  openNegotiationEnd: Date | null;
  /** Last business day on which IDR may be initiated. */
  idrInitiationDeadline: Date | null;
  /** Business days past the deadline (0 when on time). */
  businessDaysPastDeadline: number;
  detail: string;
}

export function checkIdrInitiationWindow(input: {
  initialPaymentDate: Date | null;
  fallbackAnchor?: Date | null;
  now?: Date;
}): LateInitiationCheck {
  const now = input.now ?? new Date();
  const anchor = input.initialPaymentDate ?? input.fallbackAnchor ?? null;
  if (!anchor) {
    // Fail-open with explanation: without any anchor the window cannot be
    // computed (pre-existing rows always have createdAt as fallback).
    return {
      late: false,
      openNegotiationEnd: null,
      idrInitiationDeadline: null,
      businessDaysPastDeadline: 0,
      detail:
        "No initialPaymentDate/creation anchor available; the 4-business-day " +
        "IDR initiation window (45 CFR § 149.510(b)(2)(i)) could not be evaluated.",
    };
  }
  const computed = computeIDRDeadlines({
    openNegotiationInitiatedAt: anchor,
    idrInitiatedAt: null,
    idreSelectedAt: null,
  });
  const deadline = computed.idrInitiationDeadline;
  let past = 0;
  if (deadline && now > deadline) {
    // Count business days after the deadline up to and including today.
    const cursor = new Date(deadline.getTime());
    while (cursor < now) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      if (isBusinessDay(cursor)) past++;
      if (past > 10000) break; // safety
    }
  }
  const late = past > 0;
  return {
    late,
    openNegotiationEnd: computed.openNegotiationEnd,
    idrInitiationDeadline: deadline,
    businessDaysPastDeadline: past,
    detail: late
      ? `IDR initiation is ${past} business day(s) past the 4-business-day window ` +
        `(45 CFR § 149.510(b)(2)(i)). The open negotiation period ended ` +
        `${computed.openNegotiationEnd?.toISOString().slice(0, 10)} and the initiation ` +
        `deadline was ${deadline?.toISOString().slice(0, 10)}.`
      : `Within the 4-business-day IDR initiation window (45 CFR § 149.510(b)(2)(i)); ` +
        `deadline ${deadline?.toISOString().slice(0, 10)}.`,
  };
}

// ── S4: cooling-off ──────────────────────────────────────────────────────────

export interface CoolingOffCheck {
  /** True when a prior determination puts this initiation in the suspension period. */
  blocked: boolean;
  /** End of the cooling-off period for the blocking prior dispute. */
  coolingOffEnd: Date | null;
  /** End of the 30-business-day post-cooling-off initiation window. */
  postCoolingOffWindowEnd: Date | null;
  /** The prior dispute that triggers the block (when blocked). */
  priorDisputeId: string | null;
  priorReferenceNumber: string | null;
  detail: string;
}

interface DbLike {
  select: (...args: never[]) => unknown;
}

/**
 * Evaluate the cooling-off screen for a NEW dispute keyed by
 * (respondingPartyName/payer + serviceType/CPT + initiatingParty) against
 * prior disputes that reached a payment determination.
 */
export async function checkCoolingOffForNewDispute(
  db: DbLike,
  input: {
    initiatingPartyName: string;
    respondingPartyName?: string | null;
    serviceType: string;
    cptCodes?: string[];
    disputeType?: DisputeType;
    /** Exclude this dispute id (re-check on advance of the same dispute). */
    excludeDisputeId?: string;
    now?: Date;
  }
): Promise<CoolingOffCheck> {
  const now = input.now ?? new Date();
  const clear: CoolingOffCheck = {
    blocked: false,
    coolingOffEnd: null,
    postCoolingOffWindowEnd: null,
    priorDisputeId: null,
    priorReferenceNumber: null,
    detail:
      "No prior determined dispute found for the same (initiating party, responding party, " +
      "service) key; the 90-calendar-day cooling-off suspension (45 CFR 149.510(c)(4)(vii)(B)) " +
      "does not apply.",
  };

  if (!input.respondingPartyName) return clear;

  // Prior determined disputes between the same parties.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;
  const priors: Array<Record<string, unknown>> = await anyDb
    .select()
    .from(disputes)
    .where(
      and(
        eq(disputes.initiatingPartyName, input.initiatingPartyName),
        eq(disputes.respondingPartyName, input.respondingPartyName),
        or(
          isNotNull(disputes.determinationAmount),
          inArray(disputes.status, ["determination_issued", "payment_pending", "closed", "appealed"])
        )
      )
    );

  const cptSet = new Set((input.cptCodes ?? []).map(c => c.toUpperCase()));
  let best: CoolingOffCheck | null = null;

  for (const prior of priors) {
    if (input.excludeDisputeId && prior.id === input.excludeDisputeId) continue;
    // Same or similar item/service: same serviceType OR overlapping CPT code.
    const sameServiceType = prior.serviceType === input.serviceType;
    const priorCpts: string[] = Array.isArray(prior.cptCodes) ? (prior.cptCodes as string[]) : [];
    const cptOverlap = priorCpts.some(c => cptSet.has(String(c).toUpperCase()));
    if (!sameServiceType && !cptOverlap) continue;

    // Anchor on the prior payment DETERMINATION date: prefer the
    // STEP_13_DETERMINATION_ISSUED timeline event, fall back to updatedAt.
    const events: Array<Record<string, unknown>> = await anyDb
      .select()
      .from(disputeEvents)
      .where(eq(disputeEvents.disputeId, prior.id as string));
    const detEvent = events
      .filter(e => e.step === "STEP_13_DETERMINATION_ISSUED")
      .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime())[0];
    const determinationDate = detEvent
      ? new Date(detEvent.createdAt as string)
      : prior.updatedAt
        ? new Date(prior.updatedAt as string)
        : null;
    if (!determinationDate || Number.isNaN(determinationDate.getTime())) continue;

    const result = computeCoolingOff({
      paymentDeterminationDate: determinationDate,
      disputeType: input.disputeType ?? "SINGLE",
      openNegotiationInitiatedOn: now,
    });
    if (!result.coolingOffEnd) continue; // fail-closed result without dates — skip, do not guess

    const windowEnd = addBusinessDays(result.coolingOffEnd, 30);
    if (now < result.coolingOffEnd) {
      const candidate: CoolingOffCheck = {
        blocked: true,
        coolingOffEnd: result.coolingOffEnd,
        postCoolingOffWindowEnd: windowEnd,
        priorDisputeId: prior.id as string,
        priorReferenceNumber: (prior.referenceNumber as string) ?? null,
        detail:
          `Cooling-off violation (45 CFR 149.510(c)(4)(vii)(B)): a payment determination on ` +
          `prior dispute ${(prior.referenceNumber as string) ?? prior.id} was issued ` +
          `${determinationDate.toISOString().slice(0, 10)}; the 90-calendar-day suspension ` +
          `period for the same parties and same/similar item or service runs until ` +
          `${result.coolingOffEnd.toISOString().slice(0, 10)}. The subsequent Notice of IDR ` +
          `Initiation may be submitted within the 30-business-day window ending ` +
          `${windowEnd.toISOString().slice(0, 10)}.`,
      };
      // Keep the most restrictive (latest cooling-off end).
      if (!best || (candidate.coolingOffEnd! > best.coolingOffEnd!)) best = candidate;
    } else if (!best) {
      best = {
        blocked: false,
        coolingOffEnd: result.coolingOffEnd,
        postCoolingOffWindowEnd: windowEnd,
        priorDisputeId: prior.id as string,
        priorReferenceNumber: (prior.referenceNumber as string) ?? null,
        detail:
          `Prior determined dispute ${(prior.referenceNumber as string) ?? prior.id} exists but ` +
          `its cooling-off period ended ${result.coolingOffEnd.toISOString().slice(0, 10)}; ` +
          `initiation is permitted (30-business-day post-cooling-off window ends ` +
          `${windowEnd.toISOString().slice(0, 10)}).`,
      };
    }
  }
  return best ?? clear;
}

// ── S5: IDRE conflict-of-interest attestation ────────────────────────────────

export interface ConflictCheckInput {
  attestedBy: string;
  checks: {
    noFinancialInterest: boolean;
    noPriorEngagement: boolean;
    noPartyAffiliation: boolean;
  };
}

/**
 * Validate the structured conflict-of-interest screen required before a
 * certified IDR entity may be selected (45 CFR § 149.510(c)(1)(iv) — the
 * entity must not have a conflict of interest). Returns an error message
 * when the screen fails, null when it passes.
 */
export function validateConflictCheck(input: ConflictCheckInput | undefined | null): string | null {
  if (!input || typeof input !== "object") {
    return (
      "conflictCheck is required for IDR entity selection: the selected entity must be screened " +
      "for conflicts of interest (45 CFR § 149.510(c)(1)(iv))."
    );
  }
  if (!input.attestedBy || typeof input.attestedBy !== "string") {
    return "conflictCheck.attestedBy is required (the user attesting to the conflict screen).";
  }
  const c = input.checks;
  if (!c || typeof c !== "object") {
    return "conflictCheck.checks is required (noFinancialInterest, noPriorEngagement, noPartyAffiliation).";
  }
  const failed: string[] = [];
  if (c.noFinancialInterest !== true) failed.push("noFinancialInterest");
  if (c.noPriorEngagement !== true) failed.push("noPriorEngagement");
  if (c.noPartyAffiliation !== true) failed.push("noPartyAffiliation");
  if (failed.length) {
    return (
      `IDR entity conflict-of-interest screen failed: ${failed.join(", ")} must all be true ` +
      `(45 CFR § 149.510(c)(1)(iv)); a certified IDR entity with a conflict of interest may not ` +
      `be selected.`
    );
  }
  return null;
}
