/**
 * server/scheduled/deadlineAutopilot.ts
 * Phase 18: deadline autopilot — PRE-EXPIRY prevention sweep.
 *
 * Route (mounted in server/_core/index.ts beside the other scheduled
 * endpoints, behind scheduledAuth):
 *   POST /api/scheduled/deadline-autopilot
 * Recommended schedule: daily, e.g. 07:30 UTC (before idr-deadline-check).
 *
 * Distinct from:
 *  - idrDeadlineCheck (T-5/T-1 tiers + overdue escalations + dunning); and
 *  - payment dunning (payment-LATE, after the deadline).
 * This sweep fires at CONFIGURABLE thresholds BEFORE statutory hard
 * deadlines expire:
 *   - openNegotiationDeadline  (30-business-day ON window, § 149.510(b)(1))
 *   - idrInitiationDeadline    (4-business-day IDR initiation window)
 *   - paymentDeadline          (30-calendar-day payment window)
 *
 * Thresholds: env DEADLINE_ALERT_DAYS as comma-separated business-day
 * counts (default "5,2,1"). Payment deadlines (calendar-day statutory basis)
 * are compared in calendar days; the other two in business days per the
 * deadlines engine policy.
 *
 * Idempotent per (dispute, deadlineType, threshold): each emission is
 * persisted as an event_log row with idempotency key
 * `deadline-autopilot:<disputeId>:<deadlineType>:<thresholdDays>` and the
 * key existence check gates the notification — repeated sweeps never
 * re-notify for the same threshold.
 */

import { Request, Response } from "express";
import crypto from "crypto";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { disputes, eventLog, notifications } from "../../drizzle/schema";
import { businessDaysBetween, getDeadlinePolicy } from "../idr/deadlines";

/** Default thresholds (business days before expiry): 5, 2, 1. */
export const DEFAULT_ALERT_DAYS = [5, 2, 1] as const;

export function parseAlertDays(env: NodeJS.ProcessEnv = process.env): number[] {
  const raw = env.DEADLINE_ALERT_DAYS;
  if (!raw || raw.trim() === "") return [...DEFAULT_ALERT_DAYS];
  const parsed = raw
    .split(",")
    .map(s => Number(s.trim()))
    .filter(n => Number.isInteger(n) && n > 0 && n <= 60);
  const unique = [...new Set(parsed)].sort((a, b) => b - a);
  // Fail-closed: an entirely invalid override falls back to the defaults.
  return unique.length ? unique : [...DEFAULT_ALERT_DAYS];
}

const AUTOPILOT_DEADLINES = [
  { type: "open_negotiation", column: disputes.openNegotiationDeadline, dayKind: "business" as const, cfr: "45 CFR 149.510(b)(1)" },
  { type: "idr_initiation", column: disputes.idrInitiationDeadline, dayKind: "business" as const, cfr: "45 CFR 149.510(b)(2)" },
  { type: "payment", column: disputes.paymentDeadline, dayKind: "calendar" as const, cfr: "45 CFR 149.510(c)(4)(vii)" },
];

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** Exported for tests and for the journey (clock injection). */
export async function runDeadlineAutopilot(
  db: Db,
  now: Date,
  thresholds: number[] = parseAlertDays(),
): Promise<{ scanned: number; notificationsSent: number; deduped: number }> {
  const policy = getDeadlinePolicy();
  let scanned = 0;
  let notificationsSent = 0;
  let deduped = 0;

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
    .where(sql`${disputes.status} NOT IN ('closed', 'ineligible')`);

  for (const d of open) {
    for (const dl of AUTOPILOT_DEADLINES) {
      const deadline = dl.type === "open_negotiation"
        ? d.openNegotiationDeadline
        : dl.type === "idr_initiation"
          ? d.idrInitiationDeadline
          : d.paymentDeadline;
      if (!deadline) continue;
      scanned++;
      // Only pre-expiry: deadlines in the future.
      if (deadline.getTime() <= now.getTime()) continue;
      const remaining = dl.dayKind === "business"
        ? businessDaysBetween(now, deadline, policy)
        : Math.ceil((deadline.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

      for (const threshold of thresholds) {
        if (remaining > threshold) continue;
        const key = `deadline-autopilot:${d.id}:${dl.type}:${threshold}`;
        const existing = await db
          .select({ id: eventLog.id })
          .from(eventLog)
          .where(eq(eventLog.idempotencyKey, key))
          .limit(1);
        if (existing[0]) {
          deduped++;
          continue;
        }
        if (d.createdBy) {
          await db.insert(notifications).values({
            id: crypto.randomUUID(),
            disputeId: d.id,
            userId: d.createdBy,
            notificationType: "deadline_autopilot",
            title: `[${d.referenceNumber}] ${dl.type} deadline in ${remaining} ${dl.dayKind} day(s) — autopilot pre-expiry alert`,
            message:
              `Deadline autopilot: the ${dl.type} deadline (${dl.cfr}) for dispute ${d.referenceNumber} ` +
              `expires ${deadline.toISOString().slice(0, 10)} (${remaining} ${dl.dayKind} day(s) remaining, ` +
              `threshold ≤${threshold}). Act before expiry — this is a pre-expiry prevention alert, ` +
              `distinct from overdue/dunning notices.`,
            dueDate: deadline,
            isRead: false,
            createdAt: now,
          });
          notificationsSent++;
        }
        await db.insert(eventLog).values({
          id: crypto.randomUUID(),
          topic: "idr.deadlines",
          eventType: "deadline.autopilot",
          aggregateId: d.id,
          aggregateType: "dispute",
          payload: {
            type: "deadline_autopilot",
            referenceNumber: d.referenceNumber,
            deadlineType: dl.type,
            thresholdDays: threshold,
            daysRemaining: remaining,
            dayKind: dl.dayKind,
            deadline: deadline.toISOString(),
            cfrReference: dl.cfr,
          },
          metadata: { source: "deadline_autopilot", thresholdDays: threshold, timestamp: now.toISOString() },
          idempotencyKey: key,
          status: "pending",
          retryCount: 0,
          nextAttemptAt: now,
          createdAt: now,
        }).onConflictDoNothing();
      }
    }
  }
  return { scanned, notificationsSent, deduped };
}

export async function deadlineAutopilotHandler(req: Request, res: Response) {
  try {
    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Database not available" });
    const now = new Date();
    const thresholds = parseAlertDays();
    const result = await runDeadlineAutopilot(db, now, thresholds);
    return res.json({ ok: true, thresholds, ...result, timestamp: now.toISOString() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[deadline-autopilot] Error:", message);
    return res.status(500).json({ error: message, timestamp: new Date().toISOString() });
  }
}
