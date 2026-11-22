/**
 * server/idr/step-deadlines.ts
 *
 * Phase 21 (S4): shared deadline selection logic, extracted WITHOUT behavior
 * change from two call sites:
 *
 *  1. STEP_DEADLINE_DAYS / STEP_LABELS / ACTIVE_DISPUTE_STATUSES — moved
 *     verbatim from server/routers.ts `sla.liveProgress` (was inline at the
 *     4216–4241 region). liveProgress imports them now.
 *  2. listUpcomingDeadlines() — the dispute selection + per-deadline
 *     remaining-days computation previously inline in
 *     server/scheduled/deadlineAutopilot.ts `runDeadlineAutopilot`. The
 *     autopilot imports this helper now; called with NO org filter it returns
 *     exactly the same rows in the same order with the same `remaining`
 *     values (business vs calendar day kinds preserved).
 *
 * Pure read helpers; no writes, no notifications, no idempotency keys.
 */

import { and, inArray, sql } from "drizzle-orm";
import { disputes } from "../../drizzle/schema";
import { orgMemberships } from "../../drizzle/schema-personas";
import { businessDaysBetween, getDeadlinePolicy } from "./deadlines";

/** Step → statutory deadline in business days (NSA 45 CFR §149.510). */
export const STEP_DEADLINE_DAYS: Record<string, number> = {
  STEP_01_OPEN_NEGOTIATION_INITIATED: 30,
  STEP_02_OPEN_NEGOTIATION_PERIOD: 30,
  STEP_03_OPEN_NEGOTIATION_FAILED: 4,
  STEP_04_IDR_INITIATED: 3,
  STEP_05_IDR_NOTICE_SENT: 3,
  STEP_06_IDR_ENTITY_SELECTION: 3,
  STEP_07_IDR_ENTITY_SELECTED: 1,
  STEP_08_ELIGIBILITY_REVIEW: 10,
  STEP_09_OFFER_SUBMISSION: 10,
  STEP_10_QPA_DISCLOSURE: 5,
  STEP_11_ADDITIONAL_INFORMATION: 10,
  STEP_12_ARBITRATION_REVIEW: 30,
  STEP_13_DETERMINATION_ISSUED: 30,
  STEP_14_PAYMENT_DETERMINATION: 30,
  STEP_15_PAYMENT_MADE: 30,
  STEP_16_ADMINISTRATIVE_FEE_PAID: 5,
  STEP_17_DISPUTE_CLOSED: 1,
  STEP_18_APPEAL_FILED: 30,
  STEP_19_APPEAL_RESOLVED: 30,
};

export const STEP_LABELS: Record<string, string> = {
  STEP_01_OPEN_NEGOTIATION_INITIATED: "Open Negotiation",
  STEP_02_OPEN_NEGOTIATION_PERIOD: "Negotiation Period",
  STEP_03_OPEN_NEGOTIATION_FAILED: "Negotiation Failed",
  STEP_04_IDR_INITIATED: "IDR Initiated",
  STEP_05_IDR_NOTICE_SENT: "IDR Notice Sent",
  STEP_06_IDR_ENTITY_SELECTION: "Entity Selection",
  STEP_07_IDR_ENTITY_SELECTED: "Entity Selected",
  STEP_08_ELIGIBILITY_REVIEW: "Eligibility Review",
  STEP_09_OFFER_SUBMISSION: "Offer Submission",
  STEP_10_QPA_DISCLOSURE: "QPA Disclosure",
  STEP_11_ADDITIONAL_INFORMATION: "Additional Info",
  STEP_12_ARBITRATION_REVIEW: "Arbitration Review",
  STEP_13_DETERMINATION_ISSUED: "Determination Issued",
  STEP_14_PAYMENT_DETERMINATION: "Payment Determination",
  STEP_15_PAYMENT_MADE: "Payment Made",
  STEP_16_ADMINISTRATIVE_FEE_PAID: "Admin Fee Paid",
  STEP_17_DISPUTE_CLOSED: "Dispute Closed",
  STEP_18_APPEAL_FILED: "Appeal Filed",
  STEP_19_APPEAL_RESOLVED: "Appeal Resolved",
};

/** Active statuses (liveProgress selection, moved verbatim). */
export const ACTIVE_DISPUTE_STATUSES = [
  "open_negotiation", "idr_initiated", "idr_entity_selection",
  "eligibility_review", "offer_submission", "under_arbitration",
  "determination_issued", "payment_pending",
] as const;

export type AutopilotDeadlineType = "open_negotiation" | "idr_initiation" | "payment";

export const AUTOPILOT_DEADLINES = [
  { type: "open_negotiation", column: disputes.openNegotiationDeadline, dayKind: "business" as const, cfr: "45 CFR 149.510(b)(1)" },
  { type: "idr_initiation", column: disputes.idrInitiationDeadline, dayKind: "business" as const, cfr: "45 CFR 149.510(b)(2)" },
  { type: "payment", column: disputes.paymentDeadline, dayKind: "calendar" as const, cfr: "45 CFR 149.510(c)(4)(vii)" },
] as const;

export interface UpcomingDeadline {
  disputeId: string;
  referenceNumber: string | null;
  createdBy: string | null;
  type: AutopilotDeadlineType;
  deadline: Date;
  /** Business days for the two IDR windows; calendar days for payment. */
  remaining: number;
  dayKind: "business" | "calendar";
  cfr: string;
}

/**
 * List all non-terminal disputes with their three statutory hard deadlines.
 * Rows with a null deadline column are skipped (mirrors the autopilot's
 * `if (!deadline) continue`). When `orgIds` is omitted the scan is
 * platform-wide — EXACTLY the deadline-autopilot selection. When orgIds are
 * given, disputes are restricted to those created by members of the orgs
 * (org dispute scoping is membership-derived — schema-personas.ts:15).
 */
export async function listUpcomingDeadlines(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  now: Date,
  orgIds?: string[],
): Promise<UpcomingDeadline[]> {
  const policy = getDeadlinePolicy();
  const conds = [sql`${disputes.status} NOT IN ('closed', 'ineligible')`];
  if (orgIds && orgIds.length > 0) {
    const members = await db
      .select({ userId: orgMemberships.userId })
      .from(orgMemberships)
      .where(inArray(orgMemberships.orgId, orgIds));
    const memberIds = [...new Set(members.map((m: { userId: string }) => m.userId))] as string[];
    if (memberIds.length === 0) return [];
    conds.push(inArray(disputes.createdBy, memberIds));
  }
  const open = await db
    .select({
      id: disputes.id,
      referenceNumber: disputes.referenceNumber,
      createdBy: disputes.createdBy,
      openNegotiationDeadline: disputes.openNegotiationDeadline,
      idrInitiationDeadline: disputes.idrInitiationDeadline,
      paymentDeadline: disputes.paymentDeadline,
    })
    .from(disputes)
    .where(conds.length === 1 ? conds[0] : and(...conds));

  const out: UpcomingDeadline[] = [];
  for (const d of open) {
    for (const dl of AUTOPILOT_DEADLINES) {
      const deadline = dl.type === "open_negotiation"
        ? d.openNegotiationDeadline
        : dl.type === "idr_initiation"
          ? d.idrInitiationDeadline
          : d.paymentDeadline;
      if (!deadline) continue;
      const remaining = dl.dayKind === "business"
        ? businessDaysBetween(now, deadline, policy)
        : Math.ceil((deadline.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      out.push({
        disputeId: d.id,
        referenceNumber: d.referenceNumber,
        createdBy: d.createdBy,
        type: dl.type,
        deadline,
        remaining,
        dayKind: dl.dayKind,
        cfr: dl.cfr,
      });
    }
  }
  return out;
}
