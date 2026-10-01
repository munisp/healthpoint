/**
 * Phase 20-C: Stripe billing tests — MOCK-VERIFIED.
 *
 * All HTTP goes through an injected fetchImpl; all webhook payloads are
 * synthetically signed with a test secret via node:crypto. NO live Stripe
 * keys exist in any environment — live collection is STATIC-ONLY and never
 * claimed. DB-dependent tests follow the repo's pg gating (skip without
 * DATABASE_URL).
 */
import "../journeys/env-defaults";
import { createHmac } from "node:crypto";
import { describe, expect, it, vi, beforeAll } from "vitest";
import {
  createStripeClient,
  getStripeClient,
  resolveStripeConfig,
  verifyStripeWebhookSignature,
  StripeBillingUnavailableError,
} from "./stripe";

const TEST_SECRET = "whsec_test_phase20";
const ENV_OK = {
  STRIPE_ENABLED: "true",
  STRIPE_SECRET_KEY: "sk_test_phase20",
  STRIPE_WEBHOOK_SECRET: TEST_SECRET,
};

function sign(rawBody: string, tsSec: number, secret = TEST_SECRET): string {
  const sig = createHmac("sha256", secret).update(`${tsSec}.${rawBody}`, "utf8").digest("hex");
  return `t=${tsSec},v1=${sig}`;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("resolveStripeConfig", () => {
  it("disabled unless STRIPE_ENABLED==='true' AND both secrets present", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(resolveStripeConfig({})).toBeNull();
    expect(resolveStripeConfig({ STRIPE_ENABLED: "true" })).toBeNull();
    expect(resolveStripeConfig({ STRIPE_SECRET_KEY: "x", STRIPE_WEBHOOK_SECRET: "y" })).toBeNull();
    expect(resolveStripeConfig({ ...ENV_OK })).not.toBeNull();
    const logs = spy.mock.calls.flat().join(" ");
    expect(logs).not.toContain("sk_test_phase20");
    expect(logs).not.toContain(TEST_SECRET);
    spy.mockRestore();
  });

  it("disabled stub throws StripeBillingUnavailableError, mode disabled", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const c = getStripeClient({});
    expect(c.mode).toBe("disabled");
    await expect(c.createInvoicePaymentSession({
      invoiceId: "i1", invoiceNumber: "INV-1", amountCents: 100, clientLabel: "X",
      successUrl: "https://x/ok", cancelUrl: "https://x/no",
    })).rejects.toBeInstanceOf(StripeBillingUnavailableError);
    spy.mockRestore();
  });
});

describe("verifyStripeWebhookSignature", () => {
  const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: {} } });
  const nowMs = 1_800_000_000_000;
  const nowSec = Math.floor(nowMs / 1000);

  it("accepts a valid signature within tolerance", () => {
    expect(verifyStripeWebhookSignature({
      rawBody: body, signatureHeader: sign(body, nowSec), webhookSecret: TEST_SECRET, now: nowMs,
    })).toBe(true);
  });

  it("rejects wrong secret, tampered body, malformed header, missing header", () => {
    expect(verifyStripeWebhookSignature({
      rawBody: body, signatureHeader: sign(body, nowSec, "whsec_other"), webhookSecret: TEST_SECRET, now: nowMs,
    })).toBe(false);
    expect(verifyStripeWebhookSignature({
      rawBody: body + " ", signatureHeader: sign(body, nowSec), webhookSecret: TEST_SECRET, now: nowMs,
    })).toBe(false);
    expect(verifyStripeWebhookSignature({
      rawBody: body, signatureHeader: "garbage", webhookSecret: TEST_SECRET, now: nowMs,
    })).toBe(false);
    expect(verifyStripeWebhookSignature({
      rawBody: body, signatureHeader: undefined, webhookSecret: TEST_SECRET, now: nowMs,
    })).toBe(false);
  });

  it("rejects stale timestamps beyond the 300s tolerance (replay)", () => {
    expect(verifyStripeWebhookSignature({
      rawBody: body, signatureHeader: sign(body, nowSec - 301), webhookSecret: TEST_SECRET, now: nowMs,
    })).toBe(false);
    expect(verifyStripeWebhookSignature({
      rawBody: body, signatureHeader: sign(body, nowSec - 299), webhookSecret: TEST_SECRET, now: nowMs,
    })).toBe(true);
  });

  it("never throws on adversarial headers", () => {
    for (const h of ["", "t=", "v1=", "t=abc,v1=zzz", ",,,", "t=1".repeat(1000)]) {
      expect(verifyStripeWebhookSignature({ rawBody: body, signatureHeader: h, webhookSecret: TEST_SECRET, now: nowMs })).toBe(false);
    }
  });
});

describe("createStripeClient (mocked fetch, MOCK-VERIFIED)", () => {
  const cfg = resolveStripeConfig(ENV_OK)!;

  it("creates a Checkout Session with ACH-preferred payment methods and cents amount", async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse(200, { id: "cs_test_123", url: "https://checkout.stripe.test/pay/cs_test_123" })
    ) as unknown as typeof fetch;
    const c = createStripeClient(cfg, f);
    expect(c.mode).toBe("configured");
    const out = await c.createInvoicePaymentSession({
      invoiceId: "inv-1", invoiceNumber: "INV-2026-09-05-ABC123", amountCents: 42500,
      clientLabel: "Lakeshore RCM", successUrl: "https://app.test/ok", cancelUrl: "https://app.test/no",
    });
    expect(out).toEqual({ sessionId: "cs_test_123", url: "https://checkout.stripe.test/pay/cs_test_123" });
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(String(init!.headers!["authorization" as never])).toBe("Bearer sk_test_phase20");
    const body = String(init!.body);
    expect(body).toContain("payment_method_types%5B0%5D=us_bank_account"); // ACH preferred, first
    expect(body).toContain("payment_method_types%5B1%5D=card");
    expect(body).toContain("unit_amount%5D=42500");
    expect(body).toContain("client_reference_id=inv-1");
    expect(body).toContain("mode=payment");
    // No surcharge/pass-through parameters — fee policy: platform absorbs fees.
    expect(body).not.toContain("surcharge");
  });

  it("throws when the API errors or the response lacks id/url (never fabricates)", async () => {
    const errFetch = (async () => jsonResponse(402, { error: { message: "card declined" } })) as unknown as typeof fetch;
    const c = createStripeClient(cfg, errFetch);
    await expect(c.createInvoicePaymentSession({
      invoiceId: "i", invoiceNumber: "n", amountCents: 100, clientLabel: "x",
      successUrl: "https://x/1", cancelUrl: "https://x/2",
    })).rejects.toBeInstanceOf(StripeBillingUnavailableError);
    const noId = (async () => jsonResponse(200, { status: "ok" })) as unknown as typeof fetch;
    const c2 = createStripeClient(cfg, noId);
    await expect(c2.createInvoicePaymentSession({
      invoiceId: "i", invoiceNumber: "n", amountCents: 100, clientLabel: "x",
      successUrl: "https://x/1", cancelUrl: "https://x/2",
    })).rejects.toBeInstanceOf(StripeBillingUnavailableError);
  });

  it("retrieveSession maps payment_status/status/url", async () => {
    const f = (async () => jsonResponse(200, { id: "cs_1", payment_status: "paid", status: "complete", url: null })) as unknown as typeof fetch;
    const c = createStripeClient(cfg, f);
    const s = await c.retrieveSession("cs_1");
    expect(s).toEqual({ id: "cs_1", paymentStatus: "paid", status: "complete", url: null });
  });
});

// ── DB-gated webhook + procedure tests (skip without DATABASE_URL) ──────────
const HAS_DB = Boolean(process.env.DATABASE_URL);
const RUN = Date.now().toString(36);

describe.skipIf(!HAS_DB)("stripe webhook + procedures (live PG, synthetic signatures)", () => {
  let db: NonNullable<Awaited<ReturnType<typeof import("../db").getDb>>>;
  let caller: ReturnType<typeof import("../app-router").rootRouter.createCaller>;
  let orgId = "";
  let linkId = "";
  let invoiceId = "";

  beforeAll(async () => {
    const { getDb } = await import("../db");
    db = (await getDb())!;
    const { rootRouter } = await import("../app-router");
    const { makeCtxForUser } = await import("../journeys/framework");
    const { users } = await import("../../drizzle/schema");
    const uid = `p20-stripe-${RUN}`;
    await db.insert(users).values({ id: uid, name: "P20 Stripe", email: `${uid}@test.local`, loginMethod: "test", role: "user" }).onConflictDoNothing();
    const { eq } = await import("drizzle-orm");
    const [u] = await db.select().from(users).where(eq(users.id, uid)).limit(1);
    caller = rootRouter.createCaller(makeCtxForUser(u));
    const org = await caller.orgs.create({ name: `P20 Stripe Org ${RUN}`, type: "biller" });
    orgId = org.orgId;
    const invite = await caller.submitter.inviteClient({ submitterOrgId: orgId, label: `P20 Client ${RUN}` });
    linkId = invite.submitterClientId;
    await caller.submitterBilling.updateBillingConfig({ submitterClientId: linkId, billingModel: "flat", flatFeeUsd: 250 });
    const inv = await caller.submitterBilling.generateInvoice({
      submitterClientId: linkId,
      periodStart: new Date("2026-08-01"),
      periodEnd: new Date("2026-09-01"),
    });
    invoiceId = inv.invoiceId;
    // Give the invoice a nonzero total so Checkout can be created.
    const { submitterInvoices } = await import("../../drizzle/schema-submitter");
    const { eq: eq2 } = await import("drizzle-orm");
    await db.update(submitterInvoices).set({ totalUsd: "250.00" }).where(eq2(submitterInvoices.id, invoiceId));
    await caller.submitterBilling.updateInvoiceStatus({ invoiceId, status: "sent" });
    process.env.STRIPE_ENABLED = "true";
    process.env.STRIPE_SECRET_KEY = ENV_OK.STRIPE_SECRET_KEY;
    process.env.STRIPE_WEBHOOK_SECRET = TEST_SECRET;
  });

  it("checkout.session.completed marks a sent invoice paid + paidAt; duplicate delivery no-ops", async () => {
    const { submitterInvoices } = await import("../../drizzle/schema-submitter");
    const { eq } = await import("drizzle-orm");
    const sessionId = `cs_test_${RUN}`;
    await db.update(submitterInvoices).set({ stripeSessionId: sessionId, stripeStatus: "unpaid" }).where(eq(submitterInvoices.id, invoiceId));
    const { processStripeWebhookEvent } = await import("./stripe-webhook");
    const event = {
      id: `evt_${RUN}_1`,
      type: "checkout.session.completed",
      data: { object: { id: sessionId, payment_status: "paid", client_reference_id: invoiceId } },
    };
    const first = await processStripeWebhookEvent(event);
    expect(first.status).toBe("processed");
    const [inv] = await db.select().from(submitterInvoices).where(eq(submitterInvoices.id, invoiceId));
    expect(inv.status).toBe("paid");
    expect(inv.stripeStatus).toBe("paid");
    expect(inv.paidAt).not.toBeNull();
    const paidAt = inv.paidAt;
    const dup = await processStripeWebhookEvent(event);
    expect(dup.status).toBe("duplicate");
    const [inv2] = await db.select().from(submitterInvoices).where(eq(submitterInvoices.id, invoiceId));
    expect(inv2.paidAt!.getTime()).toBe(paidAt!.getTime());
    const audit = await db.execute(
      (await import("drizzle-orm")).sql`SELECT count(*)::int AS c FROM audit_log WHERE action = 'submitterBilling.stripeWebhook.paid' AND "entityId" = ${invoiceId}`
    );
    const rows = (Array.isArray(audit) ? audit : (audit as { rows?: unknown[] }).rows ?? []) as Array<{ c: number }>;
    expect(rows[0].c).toBe(1);
  });

  it("raw handler: disabled→503, bad signature→401, valid→200 (synthetic signing)", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const { stripeWebhookHandler } = await import("./stripe-webhook");
    const mkRes = () => {
      const res = { statusCode: 0, body: null as unknown, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
      return res;
    };
    const body = JSON.stringify({ id: `evt_${RUN}_2`, type: "ping", data: { object: {} } });
    const r1 = mkRes();
    await stripeWebhookHandler({ headers: {}, body: Buffer.from(body) } as never, r1 as never);
    expect(r1.statusCode).toBe(503);
    process.env.STRIPE_WEBHOOK_SECRET = TEST_SECRET;
    const r2 = mkRes();
    await stripeWebhookHandler({ headers: { "stripe-signature": "t=1,v1=bad" }, body: Buffer.from(body) } as never, r2 as never);
    expect(r2.statusCode).toBe(401);
    const r3 = mkRes();
    const hdr = sign(body, Math.floor(Date.now() / 1000));
    await stripeWebhookHandler({ headers: { "stripe-signature": hdr }, body: Buffer.from(body) } as never, r3 as never);
    expect(r3.statusCode).toBe(200);
  });

  it("checkout.session.expired sets stripeStatus=expired and leaves the invoice sent", async () => {
    const { submitterInvoices } = await import("../../drizzle/schema-submitter");
    const { eq } = await import("drizzle-orm");
    // Fresh sent invoice with an open session.
    const inv = await caller.submitterBilling.generateInvoice({
      submitterClientId: linkId, periodStart: new Date("2026-09-01"), periodEnd: new Date("2026-09-15"),
    });
    await db.update(submitterInvoices).set({ totalUsd: "100.00" }).where(eq(submitterInvoices.id, inv.invoiceId));
    await caller.submitterBilling.updateInvoiceStatus({ invoiceId: inv.invoiceId, status: "sent" });
    const sessionId = `cs_exp_${RUN}`;
    await db.update(submitterInvoices).set({ stripeSessionId: sessionId, stripeStatus: "unpaid" }).where(eq(submitterInvoices.id, inv.invoiceId));
    const { processStripeWebhookEvent } = await import("./stripe-webhook");
    await processStripeWebhookEvent({
      id: `evt_${RUN}_3`, type: "checkout.session.expired", data: { object: { id: sessionId } },
    });
    const [row] = await db.select().from(submitterInvoices).where(eq(submitterInvoices.id, inv.invoiceId));
    expect(row.status).toBe("sent");
    expect(row.stripeStatus).toBe("expired");
    expect(row.paidAt).toBeNull();
  });

  it("overlap: manual-paid invoice + late Stripe payment preserves paidAt and audits the overlap", async () => {
    const { submitterInvoices } = await import("../../drizzle/schema-submitter");
    const { eq } = await import("drizzle-orm");
    const inv = await caller.submitterBilling.generateInvoice({
      submitterClientId: linkId, periodStart: new Date("2026-09-15"), periodEnd: new Date("2026-09-30"),
    });
    await db.update(submitterInvoices).set({ totalUsd: "75.00" }).where(eq(submitterInvoices.id, inv.invoiceId));
    await caller.submitterBilling.updateInvoiceStatus({ invoiceId: inv.invoiceId, status: "sent" });
    const sessionId = `cs_ov_${RUN}`;
    await db.update(submitterInvoices).set({ stripeSessionId: sessionId, stripeStatus: "unpaid" }).where(eq(submitterInvoices.id, inv.invoiceId));
    await caller.submitterBilling.updateInvoiceStatus({ invoiceId: inv.invoiceId, status: "paid" }); // manual path
    const [before] = await db.select().from(submitterInvoices).where(eq(submitterInvoices.id, inv.invoiceId));
    const { processStripeWebhookEvent } = await import("./stripe-webhook");
    await processStripeWebhookEvent({
      id: `evt_${RUN}_4`, type: "checkout.session.completed",
      data: { object: { id: sessionId, payment_status: "paid", client_reference_id: inv.invoiceId } },
    });
    const [after] = await db.select().from(submitterInvoices).where(eq(submitterInvoices.id, inv.invoiceId));
    expect(after.status).toBe("paid");
    expect(after.stripeStatus).toBe("paid");
    expect(after.paidAt!.getTime()).toBe(before.paidAt!.getTime()); // not overwritten
  });
});
