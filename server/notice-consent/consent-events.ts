/**
 * server/notice-consent/consent-events.ts — downstream effects of consent
 * lifecycle bus events (W4-F3).
 *
 * CONSENT_REVOKED (45 CFR 149.420(f)): once a patient revokes consent before
 * the service is furnished, the notice-and-consent exception is void and
 * balance billing is PROHIBITED for the affected items/services. This module
 * registers a listener on the in-process event bus:
 *
 *   consent.revoked → flag any linked dispute/claim as balance-billing-
 *   prohibited:
 *     1. a durable event_log outbox row (eventType
 *        "consent.balance_billing_prohibited", aggregateType "dispute"), and
 *     2. an in-app notification to the case owner.
 *
 * LINKAGE SEAM (documented): notice-consent FSM cases and IDR/PPDR disputes
 * are not yet formally related in the schema. The listener matches a linked
 * dispute by, in priority order:
 *   a. payload.linkedDisputeId explicitly supplied by the revoking actor; or
 *   b. payload.metadata.disputeId on the revocation event; or
 *   c. a dispute whose id equals the notice-consent caseId (namespaced
 *      fixtures / integrated intake).
 * When no dispute matches, the prohibition flag is still written against the
 * caseId (aggregateType "notice-consent-case") so the audit trail is complete
 * and a later linkage job can re-point it. This seam MUST be replaced by a
 * foreign-key linkage table when the integrated intake ships.
 */

import crypto from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { eventBus, type IDREvent } from "../events/bus";
import { getDb } from "../db";
import { disputes, eventLog, notifications } from "../../drizzle/schema";

export interface ConsentRevokedPayload {
  tenantId: string;
  caseId: string;
  revokedAt: string;
  ownerUserId?: string;
  /** Loose linkage seam — see module header. */
  linkedDisputeId?: string;
  metadata?: { disputeId?: string };
}

/** Resolve the linked dispute id per the documented seam; null when none. */
export async function resolveLinkedDisputeId(
  payload: ConsentRevokedPayload,
): Promise<string | null> {
  const candidates = [
    payload.linkedDisputeId,
    payload.metadata?.disputeId,
    payload.caseId,
  ].filter((v): v is string => typeof v === "string" && v.length > 0);
  if (candidates.length === 0) return null;
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ id: disputes.id })
    .from(disputes)
    .where(inArray(disputes.id, candidates))
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Flag a dispute (or, failing linkage, the case itself) as
 * balance-billing-prohibited: durable outbox row + owner notification.
 * Idempotent per (caseId, disputeId) via a deterministic idempotency key.
 */
export async function flagBalanceBillingProhibited(
  payload: ConsentRevokedPayload,
): Promise<{ flagged: boolean; disputeId: string | null }> {
  const db = await getDb();
  if (!db) return { flagged: false, disputeId: null };
  const disputeId = await resolveLinkedDisputeId(payload);
  const aggregateId = disputeId ?? payload.caseId;
  const idemKey = `consent-bb-prohibited:${payload.caseId}:${aggregateId}`;

  const inserted = await db
    .insert(eventLog)
    .values({
      id: crypto.randomUUID(),
      topic: "idr.consent",
      eventType: "consent.balance_billing_prohibited",
      aggregateId,
      aggregateType: disputeId ? "dispute" : "notice-consent-case",
      payload: {
        type: "consent.balance_billing_prohibited",
        caseId: payload.caseId,
        tenantId: payload.tenantId,
        disputeId,
        revokedAt: payload.revokedAt,
        rule: "45 CFR 149.420(f): consent revoked before service; notice-and-consent exception void",
        linkageSeam: disputeId ? "matched" : "unmatched-case-only",
      },
      metadata: { source: "consent_revoked_listener", timestamp: new Date().toISOString() },
      idempotencyKey: idemKey,
      status: "pending",
      retryCount: 0,
      nextAttemptAt: new Date(),
      createdAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: eventLog.id });

  if (inserted.length === 0) return { flagged: false, disputeId }; // already flagged

  let ownerUserId = payload.ownerUserId;
  if (!ownerUserId && disputeId) {
    const rows = await db
      .select({ createdBy: disputes.createdBy })
      .from(disputes)
      .where(eq(disputes.id, disputeId))
      .limit(1);
    ownerUserId = rows[0]?.createdBy ?? undefined;
  }
  if (ownerUserId) {
    // notifications.disputeId is NOT NULL; when no dispute is linked we key
    // the row by the notice-consent caseId (loose-linkage seam, see header).
    await db.insert(notifications).values({
      id: crypto.randomUUID(),
      disputeId: disputeId ?? payload.caseId,
      userId: ownerUserId,
      notificationType: "consent_revoked",
      title: `Balance billing prohibited — consent revoked (case ${payload.caseId})`,
      message:
        "The patient revoked the notice-and-consent waiver before the service " +
        "was furnished (45 CFR 149.420(f)). The exception is void: do NOT " +
        "balance bill for the affected items/services" +
        (disputeId ? ` (linked dispute ${disputeId}).` : "."),
      isRead: false,
      createdAt: new Date(),
    });
  }
  return { flagged: true, disputeId };
}

let registered = false;

/** Register the consent.revoked listener exactly once (module import side-effect). */
export function registerConsentRevokedListener(): void {
  if (registered) return;
  registered = true;
  eventBus.on("consent.revoked", (event: IDREvent) => {
    const payload = event.payload as unknown as ConsentRevokedPayload;
    setTimeout(() => {
      flagBalanceBillingProhibited(payload).catch((err) => {
        console.error("[consent.revoked] flag failed:", err);
      });
    }, 50); // fire-and-forget; never block the transition path
  });
}
