/**
 * server/billing/stripe.ts — Phase 20-C: Stripe Billing collection for
 * platform invoices (submitter_invoices from Phase 18-BE).
 *
 * Product choice: Stripe Checkout Sessions (mode="payment") with BOTH
 * `card` and `us_bank_account` (ACH debit) payment method types. Stripe
 * Invoicing is deliberately NOT used — the platform's own
 * submitter_invoices lifecycle (draft→sent→paid/void) remains the single
 * source of truth for "the invoice".
 *
 * FEE POLICY (user-locked): the platform ABSORBS Stripe processing fees.
 * ACH is the preferred rail (listed first). There is deliberately NO
 * surcharge / fee pass-through flag anywhere — never add one.
 *
 * Honesty labels (verbatim from design §6.8):
 *  6. "Live Stripe collection is STATIC-ONLY in this phase: no Stripe keys
 *     exist in any test/dev environment, so no live payment link was ever
 *     created or paid against the real Stripe API; all Stripe behavior is
 *     verified against mocked HTTP responses and synthetically signed
 *     webhook payloads (MOCK-VERIFIED, labeled as such)."
 *  7. "Stripe billing logic is MOCK-VERIFIED ... Without
 *     STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET/STRIPE_ENABLED the module
 *     reports DISABLED, invoices remain externally collected via the
 *     existing manual 'paid' flow, and no payment state is ever fabricated."
 *  8. "PCI scope: card and bank-account data never touch the platform —
 *     payers interact only with Stripe-hosted Checkout pages; the platform
 *     stores Stripe object ids (cs_…/evt_…) and verified payment statuses
 *     only, keeping the platform outside PCI cardholder-data scope (SAQ A
 *     posture)."
 *
 * Implementation constraint: raw REST over injectable fetch + node:crypto
 * HMAC-SHA256 webhook verification. The stripe npm SDK is deliberately NOT
 * added (tiny surface: Checkout Session create/retrieve + webhook verify;
 * zero new runtime dependencies on a repo with an audit:dependencies gate;
 * injectable-fetch precedent set by the 20-B gateway connector).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type StripeBillingMode = "disabled" | "configured";

export interface StripeConfig {
  /** STRIPE_SECRET_KEY — env-only, never logged/serialized. */
  secretKey: string;
  /** STRIPE_WEBHOOK_SECRET — env-only, never logged/serialized. */
  webhookSecret: string;
}

/** Disabled / transport failures. */
export class StripeBillingUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeBillingUnavailableError";
  }
}

/**
 * Returns null (with a logged reason naming ONLY the missing env var names)
 * unless ALL of STRIPE_ENABLED==="true", STRIPE_SECRET_KEY,
 * STRIPE_WEBHOOK_SECRET are present. FAIL-CLOSED: without env the module is
 * DISABLED, payment links cannot be created, and invoices remain externally
 * collected (manual "paid" via submitterBilling.updateInvoiceStatus,
 * unchanged). NEVER fabricates a payment state: no synthetic session ids,
 * no inferred "paid" without a verified webhook event.
 */
export function resolveStripeConfig(
  env: Record<string, string | undefined> = process.env,
): StripeConfig | null {
  const missing: string[] = [];
  if (env.STRIPE_ENABLED !== "true") missing.push("STRIPE_ENABLED (must be 'true')");
  if (!env.STRIPE_SECRET_KEY?.trim()) missing.push("STRIPE_SECRET_KEY");
  if (!env.STRIPE_WEBHOOK_SECRET?.trim()) missing.push("STRIPE_WEBHOOK_SECRET");
  if (missing.length > 0) {
    console.log(
      `[stripe-billing] DISABLED — missing env: ${missing.join(", ")}; ` +
      "invoices remain externally collected (manual 'paid' flow unchanged)"
    );
    return null;
  }
  return {
    secretKey: env.STRIPE_SECRET_KEY!.trim(),
    webhookSecret: env.STRIPE_WEBHOOK_SECRET!,
  };
}

export interface StripeClient {
  readonly mode: StripeBillingMode;
  /** Creates a Checkout Session (card + us_bank_account ACH) for a platform
   *  invoice; amount in integer cents. Returns the hosted URL. */
  createInvoicePaymentSession(input: {
    invoiceId: string;
    invoiceNumber: string;
    amountCents: number;
    clientLabel: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ sessionId: string; url: string }>;
  /** Retrieves a Checkout Session (for getInvoicePaymentStatus refresh). */
  retrieveSession(sessionId: string): Promise<{ id: string; paymentStatus: string; status: string; url: string | null }>;
}

const STRIPE_API = "https://api.stripe.com";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Real client: POST /v1/checkout/sessions (application/x-www-form-urlencoded,
 * Bearer secretKey). fetchImpl injectable for MOCK-VERIFIED tests (20-B
 * gateway connector precedent). Optional STRIPE_API_VERSION pinning via the
 * Stripe-Version header when env.STRIPE_API_VERSION is set (not required for
 * the two endpoints used — account default otherwise).
 */
export function createStripeClient(
  config: StripeConfig,
  fetchImpl: FetchLike = fetch,
  opts: { apiVersion?: string } = {},
): StripeClient {
  async function api(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await fetchImpl(`${STRIPE_API}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${config.secretKey}`,
          ...(opts.apiVersion ? { "stripe-version": opts.apiVersion } : {}),
          ...(init.headers ?? {}),
        },
      });
    } catch (err) {
      throw new StripeBillingUnavailableError(
        `Stripe API unreachable: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const msg = (body as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`;
      throw new StripeBillingUnavailableError(`Stripe API error: ${msg}`);
    }
    return body;
  }

  return {
    mode: "configured",

    async createInvoicePaymentSession(input) {
      if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
        throw new StripeBillingUnavailableError("Invoice amount must be a positive integer number of cents");
      }
      // ACH-preferred ordering; platform absorbs processing fees — no
      // surcharge/pass-through parameters are ever sent.
      const params = new URLSearchParams({
        mode: "payment",
        "payment_method_types[0]": "us_bank_account",
        "payment_method_types[1]": "card",
        client_reference_id: input.invoiceId,
        "metadata[invoiceId]": input.invoiceId,
        "metadata[invoiceNumber]": input.invoiceNumber,
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][unit_amount]": String(input.amountCents),
        "line_items[0][price_data][product_data][name]":
          `Invoice ${input.invoiceNumber} — ${input.clientLabel}`,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      });
      const body = await api("/v1/checkout/sessions", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      const sessionId = typeof body.id === "string" ? body.id : null;
      const url = typeof body.url === "string" ? body.url : null;
      if (!sessionId || !url) {
        // Never fabricate a session id or URL.
        throw new StripeBillingUnavailableError("Stripe Checkout response carried no session id/url");
      }
      return { sessionId, url };
    },

    async retrieveSession(sessionId) {
      const body = await api(`/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, { method: "GET" });
      return {
        id: String(body.id ?? sessionId),
        paymentStatus: String(body.payment_status ?? "unpaid"),
        status: String(body.status ?? "open"),
        url: typeof body.url === "string" ? body.url : null,
      };
    },
  };
}

/**
 * Fail-closed stub when unconfigured: every method throws
 * StripeBillingUnavailableError. mode = "disabled". NEVER returns a fake URL.
 */
export function getStripeClient(
  env: Record<string, string | undefined> = process.env,
): StripeClient {
  const config = resolveStripeConfig(env);
  if (!config) {
    const disabled = () =>
      Promise.reject(
        new StripeBillingUnavailableError(
          "Stripe billing is DISABLED — STRIPE_* env not configured; " +
          "invoices remain externally collected (manual 'paid' flow)"
        )
      );
    return {
      mode: "disabled",
      createInvoicePaymentSession: disabled,
      retrieveSession: disabled as StripeClient["retrieveSession"],
    };
  }
  return createStripeClient(config, fetch, { apiVersion: env.STRIPE_API_VERSION?.trim() || undefined });
}

/**
 * Verify a Stripe webhook signature WITHOUT the SDK. The Stripe-Signature
 * header is "t=<unixTs>,v1=<hexHmac>[,v1=…]"; the signed payload is
 * `${t}.${rawBody}`; HMAC-SHA256 with the webhook secret; timingSafeEqual
 * comparison; the timestamp must be within toleranceSeconds (default 300s)
 * of now to reject replays. Returns true only on exact match within
 * tolerance; never throws.
 */
export function verifyStripeWebhookSignature(opts: {
  rawBody: string;
  signatureHeader: string | undefined;
  webhookSecret: string;
  toleranceSeconds?: number;
  /** Injected for tests (ms since epoch). */
  now?: number;
}): boolean {
  try {
    const header = opts.signatureHeader;
    if (!header) return false;
    let ts: string | null = null;
    const sigs: string[] = [];
    for (const part of header.split(",")) {
      const idx = part.indexOf("=");
      if (idx <= 0) continue;
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      if (k === "t") ts = v;
      else if (k === "v1") sigs.push(v);
    }
    if (!ts || sigs.length === 0) return false;
    const tsNum = Number(ts);
    if (!Number.isFinite(tsNum)) return false;
    const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);
    const tolerance = opts.toleranceSeconds ?? 300;
    if (Math.abs(nowSec - tsNum) > tolerance) return false; // replay/stale
    const expected = createHmac("sha256", opts.webhookSecret)
      .update(`${ts}.${opts.rawBody}`, "utf8")
      .digest("hex");
    const expectedBuf = Buffer.from(expected, "utf8");
    return sigs.some(sig => {
      const sigBuf = Buffer.from(sig, "utf8");
      return sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf);
    });
  } catch {
    return false;
  }
}
