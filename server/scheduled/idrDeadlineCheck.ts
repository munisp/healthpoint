/**
 * server/scheduled/idrDeadlineCheck.ts
 * Statutory IDR deadline tracker and escalation emitter.
 *
 * Route (see server/routers/REGISTER-idr-compliance.md — one-line registration
 * in server/_core/index.ts next to the other scheduled endpoints):
 *   POST /api/scheduled/idr-deadline-check   (behind scheduledAuth)
 * Recommended schedule: daily, e.g. 08:30 UTC, alongside deadline-check.
 *
 * What it does (all idempotent):
 *   1. Upserts idr_deadline_events rows for every open dispute's statutory
 *      deadlines (45 CFR § 149.510 timeline) via planDeadlineTracking().
 *   2. Emits T-5 / T-1 business-day warnings and overdue escalations exactly
 *      once per (dispute, deadline, tier): per-tier sentAt columns gate the
 *      write, and the outbox event carries a deterministic idempotency key.
 *   3. Every alert produces: an in-app notification, an audit_log entry, and
 *      a pending event_log outbox row (delivered by the outbox worker).
 */

import { Request, Response } from "express";
import crypto from "crypto";
import { and, eq, sql, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { disputes, notifications } from "../../drizzle/schema";
import { idrDeadlineEvents } from "../../drizzle/schema-idr-compliance";
import { planDeadlineTracking, type DeadlineAlert } from "../idr/deadline-tracking";
import { getDeadlinePolicy } from "../idr/deadlines";
import { emitComplianceEvent } from "../idr/compliance-events";

const TIER_COLUMN = {
  t_minus_5: "tMinus5SentAt",
  t_minus_1: "tMinus1SentAt",
  overdue: "overdueSentAt",
} as const;

const TIER_LABEL: Record<DeadlineAlert["tier"], string> = {
  t_minus_5: "due in ≤5 business days",
  t_minus_1: "due in ≤1 business day",
  overdue: "OVERDUE",
};

export async function idrDeadlineCheckHandler(req: Request, res: Response) {
  try {
    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Database not available" });

    const now = new Date();
    const policy = getDeadlinePolicy();

    // All disputes whose statutory clocks may still be running.
    const openDisputes = await db
      .select()
      .from(disputes)
      .where(sql`${disputes.status} NOT IN ('closed', 'ineligible')`);

    const existing = openDisputes.length
      ? await db
          .select()
          .from(idrDeadlineEvents)
          .where(inArray(idrDeadlineEvents.disputeId, openDisputes.map(dd => dd.id)))
      : [];

    const plan = planDeadlineTracking(
      openDisputes.map(dd => ({
        id: dd.id,
        referenceNumber: dd.referenceNumber,
        status: dd.status,
        currentStep: dd.currentStep,
        createdBy: dd.createdBy,
        openNegotiationDeadline: dd.openNegotiationDeadline,
        idrInitiationDeadline: dd.idrInitiationDeadline,
        entitySelectionDeadline: dd.entitySelectionDeadline,
        offerSubmissionDeadline: dd.offerSubmissionDeadline,
        determinationDeadline: dd.determinationDeadline,
        paymentDeadline: dd.paymentDeadline,
        closedAt: dd.closedAt,
      })),
      existing.map(e => ({
        id: e.id,
        disputeId: e.disputeId,
        deadlineType: e.deadlineType,
        computedDeadline: e.computedDeadline,
        status: e.status,
        tMinus5SentAt: e.tMinus5SentAt,
        tMinus1SentAt: e.tMinus1SentAt,
        overdueSentAt: e.overdueSentAt,
      })),
      now,
      policy
    );

    // 1. Upsert deadline event rows (unique on disputeId + deadlineType).
    let upserted = 0;
    for (const u of plan.upserts) {
      await db
        .insert(idrDeadlineEvents)
        .values({
          id: crypto.randomUUID(),
          disputeId: u.disputeId,
          deadlineType: u.deadlineType,
          basisDate: u.basisDate,
          computedDeadline: u.computedDeadline,
          dayCount: u.dayCount,
          dayKind: u.dayKind,
          cfrReference: u.cfrReference,
          status: "open",
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [idrDeadlineEvents.disputeId, idrDeadlineEvents.deadlineType],
          set: { computedDeadline: u.computedDeadline, updatedAt: now },
        });
      upserted++;
    }

    // 2. Emit alerts; claim the tier atomically before writing side effects.
    let alertsEmitted = 0;
    let alertsDeduped = 0;
    for (const alert of plan.alerts) {
      const tierCol = TIER_COLUMN[alert.tier];
      const claimed = await db
        .update(idrDeadlineEvents)
        .set({ [tierCol]: now, updatedAt: now })
        .where(
          and(
            eq(idrDeadlineEvents.disputeId, alert.disputeId),
            eq(idrDeadlineEvents.deadlineType, alert.deadlineType),
            sql`${idrDeadlineEvents[tierCol]} IS NULL`
          )
        )
        .returning({ id: idrDeadlineEvents.id });
      if (!claimed.length) {
        alertsDeduped++; // another instance claimed it first
        continue;
      }

      const label = `${alert.deadlineType} deadline ${TIER_LABEL[alert.tier]}`;
      await db.insert(notifications).values({
        id: crypto.randomUUID(),
        disputeId: alert.disputeId,
        userId: alert.notifyUserId,
        notificationType: alert.tier === "overdue" ? "overdue" : "deadline_warning",
        title: `[${alert.referenceNumber}] ${label}`,
        message:
          `Statutory deadline "${alert.deadlineType}" (${alert.cfrReference}) for dispute ` +
          `${alert.referenceNumber} is ${TIER_LABEL[alert.tier]}: due ` +
          `${alert.computedDeadline.toISOString().slice(0, 10)}. ` +
          (alert.tier === "overdue" ? "Immediate action required." : "Review and act promptly."),
        dueDate: alert.computedDeadline,
        isRead: false,
        createdAt: now,
      });

      await emitComplianceEvent({
        eventType: alert.tier === "overdue" ? "deadline.overdue" : "deadline.warning",
        aggregateId: alert.disputeId,
        aggregateType: "dispute",
        topic: "idr.notifications",
        payload: {
          referenceNumber: alert.referenceNumber,
          deadlineType: alert.deadlineType,
          tier: alert.tier,
          computedDeadline: alert.computedDeadline.toISOString(),
          businessDaysRemaining: alert.businessDaysRemaining,
          cfrReference: alert.cfrReference,
        },
        idempotencyKey: alert.alertKey,
      });
      alertsEmitted++;
    }

    return res.json({
      ok: true,
      disputesScanned: openDisputes.length,
      deadlineRowsUpserted: upserted,
      alertsEmitted,
      alertsDeduped,
      skipped: plan.skipped.length,
      timestamp: now.toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[idr-deadline-check] Error:", message);
    return res.status(500).json({ error: message, timestamp: new Date().toISOString() });
  }
}
