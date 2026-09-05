/**
 * server/idr/deadline-tracking.ts
 * Pure planning layer for the statutory-deadline scheduler
 * (server/scheduled/idrDeadlineCheck.ts).
 *
 * Given a dispute's current deadline-bearing fields, this module computes:
 *   1. which idr_deadline_events rows should exist (upsert plan), and
 *   2. which T-5 / T-1 / overdue escalation alerts should fire now.
 *
 * The scheduler applies the plan with idempotent writes (unique index on
 * (disputeId, deadlineType); per-tier sentAt columns as dedupe keys).
 */

import {
  businessDaysBetween,
  deadlineAlertTier,
  type DeadlineAlertTier,
  type IDRDeadlinePolicy,
} from "./deadlines";
import type { IDRDeadlineType } from "../../drizzle/schema-idr-compliance";

export interface DisputeDeadlineSource {
  id: string;
  referenceNumber: string;
  status: string;
  currentStep: string;
  createdBy: string | null;
  openNegotiationDeadline: Date | null;
  idrInitiationDeadline: Date | null;
  entitySelectionDeadline: Date | null;
  offerSubmissionDeadline: Date | null;
  determinationDeadline: Date | null;
  paymentDeadline: Date | null;
  closedAt: Date | null;
}

/** Existing idr_deadline_events row (subset). */
export interface DeadlineEventRow {
  id: string;
  disputeId: string;
  deadlineType: string;
  computedDeadline: Date;
  status: string;
  tMinus5SentAt: Date | null;
  tMinus1SentAt: Date | null;
  overdueSentAt: Date | null;
}

export interface DeadlineEventUpsert {
  disputeId: string;
  deadlineType: IDRDeadlineType;
  basisDate: Date | null;
  computedDeadline: Date;
  dayCount: number;
  dayKind: "business" | "calendar";
  cfrReference: string;
}

export interface DeadlineAlert {
  disputeId: string;
  referenceNumber: string;
  notifyUserId: string | null;
  deadlineType: IDRDeadlineType;
  tier: DeadlineAlertTier;
  computedDeadline: Date;
  businessDaysRemaining: number;
  cfrReference: string;
  /** Deterministic dedupe key for notifications/outbox: one alert per tier. */
  alertKey: string;
}

export interface DeadlinePlan {
  upserts: DeadlineEventUpsert[];
  alerts: DeadlineAlert[];
  skipped: Array<{ disputeId: string; reason: string }>;
}

/** Mapping from dispute deadline columns to statutory metadata. */
const DEADLINE_SOURCES: Array<{
  column: keyof Pick<
    DisputeDeadlineSource,
    | "openNegotiationDeadline"
    | "idrInitiationDeadline"
    | "entitySelectionDeadline"
    | "offerSubmissionDeadline"
    | "determinationDeadline"
    | "paymentDeadline"
  >;
  deadlineType: IDRDeadlineType;
  cfrReference: string;
  dayKind: "business" | "calendar";
}> = [
  { column: "openNegotiationDeadline", deadlineType: "open_negotiation_end", cfrReference: "45 CFR § 149.510(b)(1)", dayKind: "business" },
  { column: "idrInitiationDeadline", deadlineType: "idr_initiation_window_end", cfrReference: "45 CFR § 149.510(b)(2)(i)", dayKind: "business" },
  { column: "entitySelectionDeadline", deadlineType: "idre_selection", cfrReference: "45 CFR § 149.510(c)(1)", dayKind: "business" },
  { column: "offerSubmissionDeadline", deadlineType: "offer_submission", cfrReference: "45 CFR § 149.510(c)(3)(i)", dayKind: "business" },
  { column: "determinationDeadline", deadlineType: "determination_due", cfrReference: "45 CFR § 149.510(c)(4)(ii)", dayKind: "business" },
  { column: "paymentDeadline", deadlineType: "payment_due", cfrReference: "PHSA § 2799A-1(c)(6)", dayKind: "calendar" },
];

/** Dispute statuses whose statutory clocks have stopped. */
const TERMINAL_STATUSES = new Set(["closed", "ineligible"]);

export function deadlineAlertKey(disputeId: string, deadlineType: IDRDeadlineType, tier: DeadlineAlertTier): string {
  return `deadline:${disputeId}:${deadlineType}:${tier}`;
}

/**
 * Plan deadline-event upserts and alert emissions for a set of disputes.
 *
 * `existing` must contain the current idr_deadline_events rows for those
 * disputes (used for alert dedupe via the per-tier sentAt columns).
 */
export function planDeadlineTracking(
  disputes: DisputeDeadlineSource[],
  existing: DeadlineEventRow[],
  now: Date = new Date(),
  policy?: IDRDeadlinePolicy
): DeadlinePlan {
  const existingByKey = new Map<string, DeadlineEventRow>();
  for (const row of existing) existingByKey.set(`${row.disputeId}:${row.deadlineType}`, row);

  const plan: DeadlinePlan = { upserts: [], alerts: [], skipped: [] };

  for (const dispute of disputes) {
    if (TERMINAL_STATUSES.has(dispute.status)) {
      plan.skipped.push({ disputeId: dispute.id, reason: `terminal status ${dispute.status}` });
      continue;
    }

    for (const src of DEADLINE_SOURCES) {
      const deadline = dispute[src.column];
      if (!deadline) continue;

      plan.upserts.push({
        disputeId: dispute.id,
        deadlineType: src.deadlineType,
        basisDate: null, // basis anchoring is recorded when the router computes deadlines
        computedDeadline: deadline,
        dayCount: 0, // scheduler preserves the stored deadline; counts come from the computing path
        dayKind: src.dayKind,
        cfrReference: src.cfrReference,
      });

      const row = existingByKey.get(`${dispute.id}:${src.deadlineType}`);
      if (row && (row.status === "met" || row.status === "waived")) continue;

      const tier = deadlineAlertTier(deadline, now, policy);
      if (!tier) continue;

      // Dedupe: skip tiers already emitted (per-tier sentAt column present).
      const alreadySent =
        row == null
          ? false
          : tier === "t_minus_5"
            ? row.tMinus5SentAt !== null
            : tier === "t_minus_1"
              ? row.tMinus1SentAt !== null
              : row.overdueSentAt !== null;
      if (alreadySent) continue;

      plan.alerts.push({
        disputeId: dispute.id,
        referenceNumber: dispute.referenceNumber,
        notifyUserId: dispute.createdBy,
        deadlineType: src.deadlineType,
        tier,
        computedDeadline: deadline,
        businessDaysRemaining: tier === "overdue" ? -1 : businessDaysBetween(now, deadline, policy),
        cfrReference: src.cfrReference,
        alertKey: deadlineAlertKey(dispute.id, src.deadlineType, tier),
      });
    }
  }

  return plan;
}
