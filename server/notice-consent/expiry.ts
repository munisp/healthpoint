/**
 * server/notice-consent/expiry.ts — consent expiry rule + scheduled sweep
 * (W4-F3).
 *
 * CHOSEN RULE (documented; no fixed federal expiry exists):
 * A signed notice-and-consent EXPIRES — requiring re-execution of the
 * notice/consent — when EITHER:
 *   1. The service is rescheduled BEYOND the noticed service window: the
 *      currently scheduled service date falls after the service date stated
 *      in the notice. The notice-and-consent document is specific to "the
 *      items and services ... furnished" on the noticed date (45 CFR
 *      149.420(c)(2)(ii)); HHS guidance treats the consent as tied to the
 *      scheduled appointment, so moving the appointment past the noticed
 *      date invalidates it.
 *   2. 90 calendar days have elapsed since the consent was signed
 *      (CONSENT_MAX_VALIDITY_DAYS). Absent a statutory cap we adopt the
 *      conservative 90-day ceiling used for standing scheduling
 *      authorizations; document owners may tighten, never loosen, via
 *      configuration review.
 *
 * evaluateConsentExpiry is the pure predicate; runNoticeConsentExpirySweep is
 * the scheduled flip: it scans persisted notice-consent FSM cases still in
 * NOTICE_DELIVERED / CONSENT_SIGNED and transitions the expired ones to
 * NOTICE_EXPIRED (idempotent — terminal thereafter). Wired into
 * server/scheduled/idrDeadlineCheck.ts alongside the other daily sweeps.
 */

import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { fsmCases } from "../../drizzle/schema-fsm-cases";
import { getFsmCaseStore } from "../fsm-store/store";
import { transition, type NoticeConsentCase } from "./fsm";
import {
  evaluateConsentExpiry,
  type ConsentExpiryInput,
} from "./waiver";

export { evaluateConsentExpiry, CONSENT_MAX_VALIDITY_DAYS } from "./waiver";
export type { ConsentExpiryInput, ConsentExpiryResult } from "./waiver";

/** Extract the expiry input from a persisted notice-consent case (JSONB Dates). */
export function expiryInputFromCase(c: NoticeConsentCase, asOf?: Date): ConsentExpiryInput {
  const t = c.timing;
  return {
    consentSignedAt: t.consentSignedAt ? new Date(t.consentSignedAt) : undefined,
    noticeDeliveredAt: new Date(t.noticeDeliveredAt),
    noticedServiceAt: new Date(c.noticedServiceAt ?? t.serviceAt),
    currentServiceAt: new Date(t.serviceAt), // reschedule updates serviceAt on the case
    asOf,
  };
}

export interface ExpirySweepResult {
  scanned: number;
  expired: number;
  errors: number;
}

/**
 * Scheduled sweep: flip expired notice-consent cases to NOTICE_EXPIRED.
 * Idempotent: terminal cases are never rescanned (state filter), and a
 * second run finds nothing to flip.
 */
export async function runNoticeConsentExpirySweep(now: Date = new Date()): Promise<ExpirySweepResult> {
  const db = await getDb();
  if (!db) return { scanned: 0, expired: 0, errors: 0 };
  const store = getFsmCaseStore();

  const rows = await db
    .select({
      tenantId: fsmCases.tenantId,
      caseId: fsmCases.caseId,
      caseJson: fsmCases.caseJson,
    })
    .from(fsmCases)
    .where(
      and(
        eq(fsmCases.caseType, "notice-consent"),
        inArray(fsmCases.state, ["NOTICE_DELIVERED", "CONSENT_SIGNED"]),
      ),
    );

  let expired = 0;
  let errors = 0;
  for (const row of rows) {
    try {
      const data = row.caseJson as unknown as NoticeConsentCase;
      const verdict = evaluateConsentExpiry(expiryInputFromCase(data, now));
      if (!verdict.expired) continue;
      await store.transitionCase<NoticeConsentCase>(row.tenantId, "notice-consent", row.caseId, {
        apply: (current) => transition(current, "NOTICE_EXPIRED", { now }),
        terminalStates: ["SERVICE_RENDERED", "CONSENT_REVOKED", "NOTICE_EXPIRED", "WAIVED_IMPOSSIBLE"],
        idempotencyKey: `nc-expiry:${row.caseId}:${now.toISOString().slice(0, 10)}`,
        now,
      });
      expired++;
    } catch (err) {
      errors++;
      console.error(
        `[nc-expiry-sweep] failed for ${row.tenantId}/${row.caseId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return { scanned: rows.length, expired, errors };
}
