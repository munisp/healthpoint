/**
 * server/billing/stripe-webhook.ts — Phase 20-C.
 *
 * Raw Express handler for POST /api/billing/stripe-webhook. Mounted with
 * express.raw BEFORE express.json in server/_core/index.ts so the signature
 * covers the exact bytes received (settlement-callback precedent; coexists
 * with the Phase-19 bulk-upload raw mount in the same block).
 *
 * Flow (fail-closed at every step):
 *  1. Config absent → 503 (no silent 200).
 *  2. verifyStripeWebhookSignature on the raw body → 401 on failure (covers
 *     invalid AND stale/replayed timestamps; 300s tolerance).
 *  3. Insert the event into stripe_webhook_events with processedAt=null;
 *     primary-key conflict on the evt_ id → 200 { status: "duplicate" }
 *     (idempotent double-delivery, never reprocessed).
 *  4. Dispatch:
 *      - checkout.session.completed → mark invoice paid (+paidAt) from
 *        `sent`; overlap with manual `paid` is audited honestly.
 *      - invoice.paid → reserved path (future Stripe-Invoicing transport),
 *        maps via stripeInvoiceId; no match → processed no-op.
 *      - checkout.session.expired → stripeStatus="expired" (invoice stays
 *        `sent`; a new link can be created).
 *      - other types → recorded, marked processed, no-op.
 *  5. Set processedAt, 200. Errors AFTER the idempotency insert → 500 so
 *     Stripe retries (the idempotency key makes retry safe).
 *
 * The signature IS the authentication — no auth cookies on this route.
 * paidAt is set ONLY here (webhook) or by the manual
 * submitterBilling.updateInvoiceStatus path — never inferred locally.
 * MOCK-VERIFIED: live Stripe collection is STATIC-ONLY (no live keys).
 */
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { getDb, createAuditEntry } from "../db";
import { submitterInvoices, stripeWebhookEvents } from "../../drizzle/schema-submitter";
import { resolveStripeConfig, verifyStripeWebhookSignature } from "./stripe";

export const STRIPE_WEBHOOK_SYSTEM_USER = "system:stripe-webhook";

interface StripeEvent {
  id: string;
  type: string;
  data?: { object?: Record<string, unknown> };
}

/** Core processing, exported for direct (in-process) tests. */
export async function processStripeWebhookEvent(event: StripeEvent): Promise<{ status: string }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Idempotency insert: PK conflict on evt_ id → duplicate, no reprocessing.
  const inserted = await db
    .insert(stripeWebhookEvents)
    .values({ id: event.id, type: event.type, payload: event as unknown as Record<string, unknown> })
    .onConflictDoNothing()
    .returning({ id: stripeWebhookEvents.id });
  if (inserted.length === 0) {
    return { status: "duplicate" };
  }

  const obj = event.data?.object ?? {};
  let note = "no-op";

  if (event.type === "checkout.session.completed") {
    const sessionId = typeof obj.id === "string" ? obj.id : null;
    const paymentStatus = typeof obj.payment_status === "string" ? obj.payment_status : null;
    const refInvoiceId =
      (typeof obj.client_reference_id === "string" && obj.client_reference_id) ||
      (typeof (obj.metadata as Record<string, unknown> | undefined)?.invoiceId === "string"
        ? String((obj.metadata as Record<string, unknown>).invoiceId)
        : null);
    const inv = sessionId
      ? (await db.select().from(submitterInvoices).where(eq(submitterInvoices.stripeSessionId, sessionId)).limit(1))[0]
        ?? (refInvoiceId
          ? (await db.select().from(submitterInvoices).where(eq(submitterInvoices.id, refInvoiceId)).limit(1))[0]
          : undefined)
      : refInvoiceId
        ? (await db.select().from(submitterInvoices).where(eq(submitterInvoices.id, refInvoiceId)).limit(1))[0]
        : undefined;
    if (!inv) {
      note = `checkout.session.completed matched no invoice (session=${sessionId ?? "none"})`;
    } else if (paymentStatus !== "paid") {
      note = `checkout.session.completed with payment_status=${paymentStatus} — invoice left ${inv.status}`;
    } else if (inv.status === "sent") {
      await db.update(submitterInvoices).set({
        status: "paid",
        stripeStatus: "paid",
        stripeSessionId: sessionId ?? inv.stripeSessionId,
        paidAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(submitterInvoices.id, inv.id));
      await createAuditEntry({
        userId: STRIPE_WEBHOOK_SYSTEM_USER,
        action: "submitterBilling.stripeWebhook.paid",
        entityType: "submitter_invoice",
        entityId: inv.id,
        oldValue: JSON.stringify({ status: "sent", stripeStatus: inv.stripeStatus }),
        newValue: JSON.stringify({ status: "paid", stripeStatus: "paid", stripeSessionId: sessionId, eventId: event.id }),
        ipAddress: null,
        userAgent: null,
      });
      note = `invoice ${inv.id} paid via Stripe Checkout`;
    } else if (inv.status === "paid") {
      // Manual collection already marked it paid — record the overlap
      // honestly; do NOT overwrite paidAt.
      await db.update(submitterInvoices).set({
        stripeStatus: "paid",
        stripeSessionId: sessionId ?? inv.stripeSessionId,
        updatedAt: new Date(),
      }).where(eq(submitterInvoices.id, inv.id));
      await createAuditEntry({
        userId: STRIPE_WEBHOOK_SYSTEM_USER,
        action: "submitterBilling.stripeWebhook.paidOverlap",
        entityType: "submitter_invoice",
        entityId: inv.id,
        oldValue: JSON.stringify({ status: "paid", stripeStatus: inv.stripeStatus }),
        newValue: JSON.stringify({ note: "Stripe payment completed after manual 'paid' — paidAt preserved", stripeSessionId: sessionId, eventId: event.id }),
        ipAddress: null,
        userAgent: null,
      });
      note = `invoice ${inv.id} already paid manually — overlap audited, paidAt preserved`;
    } else {
      note = `invoice ${inv.id} is ${inv.status} — no transition`;
    }
  } else if (event.type === "invoice.paid") {
    // Reserved path for a future Stripe-Invoicing transport (§6.1).
    const stripeInvoiceId = typeof obj.id === "string" ? obj.id : null;
    const inv = stripeInvoiceId
      ? (await db.select().from(submitterInvoices).where(eq(submitterInvoices.stripeInvoiceId, stripeInvoiceId)).limit(1))[0]
      : undefined;
    if (inv && inv.status === "sent") {
      await db.update(submitterInvoices).set({
        status: "paid", stripeStatus: "paid", paidAt: new Date(), updatedAt: new Date(),
      }).where(eq(submitterInvoices.id, inv.id));
      await createAuditEntry({
        userId: STRIPE_WEBHOOK_SYSTEM_USER,
        action: "submitterBilling.stripeWebhook.paid",
        entityType: "submitter_invoice",
        entityId: inv.id,
        oldValue: JSON.stringify({ status: "sent" }),
        newValue: JSON.stringify({ status: "paid", via: "invoice.paid", stripeInvoiceId, eventId: event.id }),
        ipAddress: null,
        userAgent: null,
      });
      note = `invoice ${inv.id} paid via Stripe invoice.paid`;
    } else {
      note = "invoice.paid matched no platform invoice — recorded no-op";
    }
  } else if (event.type === "checkout.session.expired") {
    const sessionId = typeof obj.id === "string" ? obj.id : null;
    const inv = sessionId
      ? (await db.select().from(submitterInvoices).where(eq(submitterInvoices.stripeSessionId, sessionId)).limit(1))[0]
      : undefined;
    if (inv && inv.status === "sent") {
      await db.update(submitterInvoices).set({ stripeStatus: "expired", updatedAt: new Date() })
        .where(eq(submitterInvoices.id, inv.id));
      note = `invoice ${inv.id} checkout session expired — remains sent; a new link can be created`;
    } else {
      note = "checkout.session.expired matched no sent invoice — no-op";
    }
  }

  await db.update(stripeWebhookEvents).set({ processedAt: new Date() })
    .where(eq(stripeWebhookEvents.id, event.id));
  return { status: "processed", note } as { status: string };
}

/** Raw Express handler (signature verification + HTTP semantics). */
export async function stripeWebhookHandler(req: Request, res: Response): Promise<void> {
  const config = resolveStripeConfig();
  if (!config) {
    res.status(503).json({ error: "Stripe billing DISABLED — STRIPE_* env not configured" });
    return;
  }
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : typeof req.body === "string" ? req.body : "";
  const ok = verifyStripeWebhookSignature({
    rawBody,
    signatureHeader: req.headers["stripe-signature"] as string | undefined,
    webhookSecret: config.webhookSecret,
  });
  if (!ok) {
    res.status(401).json({ error: "Invalid Stripe webhook signature" });
    return;
  }
  let event: StripeEvent;
  try {
    const parsed = JSON.parse(rawBody) as Partial<StripeEvent>;
    if (typeof parsed.id !== "string" || typeof parsed.type !== "string") throw new Error("missing id/type");
    event = parsed as StripeEvent;
  } catch {
    res.status(400).json({ error: "Malformed Stripe event payload" });
    return;
  }
  try {
    const result = await processStripeWebhookEvent(event);
    res.status(200).json(result);
  } catch (err) {
    // After the idempotency insert a failure → 500 so Stripe retries; the
    // PK idempotency key makes the retry safe.
    console.error("[stripe-billing] webhook processing failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Stripe webhook processing failed" });
  }
}
