/**
 * J31: payment-instrument capture + check reconciliation + mocked Stripe
 * invoice payment (Phase 20).
 *
 *  ingest an 835 carrying BPR CHK + TRN -> post the matching paper check ->
 *  proposal appears (exactTraceMatch, human-reviewed only — assert NO
 *  auto-match occurred) -> human confirms -> deposit -> list; replay of the
 *  check posting -> 409. Then a MOCKED Stripe leg: generate a submitter
 *  invoice (Phase 18-BE) -> mark sent -> createInvoicePaymentLink against an
 *  injected mock fetch (MOCK-VERIFIED — no live Stripe keys exist anywhere;
 *  live collection is STATIC-ONLY) -> deliver a synthetically signed
 *  checkout.session.completed to the real webhook handler -> paid + paidAt
 *  -> duplicate delivery is a 200 no-op. Finally assert DISABLED-mode
 *  honesty: with STRIPE_* absent, createInvoicePaymentLink surfaces
 *  PRECONDITION_FAILED and the manual 'paid' path remains.
 */
import { createHmac } from "node:crypto";
import type { Journey } from "../framework";

const WH_SECRET = "whsec_j31_test";

function make835(claimId: string, amount: string, trace: string, payer: string): string {
  return [
    "ISA*00*          *00*          *ZZ*A*ZZ*B*260901*1200*^*00501*000000905*1*T*:~",
    "ST*835*0001*005010X221A1~",
    `BPR*I*${amount}*C*CHK*CCP*01*999999999*DA*123456*1999999999**01*111111111*DA*987654*20260905~`,
    `TRN*1*${trace}*1999999999~`,
    `N1*PR*${payer}~`,
    `CLP*${claimId}*2*${amount}*${amount}**MB*PCN-${claimId}*11*1~`,
    `SVC*HC:99285*${amount}*${amount}**1~`,
    "SE*8*0001~",
  ].join("\n");
}

interface J31State {
  orgId: string;
  checkPostingId: string;
  fileId: string;
  lineIds: string[];
  invoiceId: string;
  sessionId: string;
}

export const j31: Journey = {
  id: "J31",
  title: "Check payment reconciliation (proposals only) + mocked Stripe invoice payment",
  actor: "biller",
  description:
    "835 BPR CHK/TRN capture, manual check posting with human-confirmed reconciliation (no auto-match), deposit lifecycle, replay 409; then a MOCK-VERIFIED Stripe Checkout leg (injected fetch + synthetically signed webhook) and DISABLED-mode fail-closed proof.",
  steps: [
    {
      name: "ingest-835-with-check-header",
      async run(ctx) {
        const org = await ctx.provider.orgs.create({ name: `J31 Biller ${ctx.ns("j31")}`, type: "biller" });
        const st: J31State = { orgId: org.orgId } as J31State;
        (ctx as unknown as { _st: J31State })._st = st;
        const res = await ctx.provider.submitter.ingest835({
          orgId: st.orgId,
          fileName: `j31-${ctx.runId}.835`,
          content: make835(`CLM-J31-${ctx.runId}`, "900.00", `J31CHK-${ctx.runId}`, "AETNA HEALTH"),
        });
        ctx.assertEqual(res.duplicate, false, "835 ingested");
        ctx.assertEqual((res.payment as { method: string } | null)?.method, "check", "BPR04 CHK captured");
        ctx.assertEqual((res.payment as { traceNumber: string } | null)?.traceNumber, `J31CHK-${ctx.runId}`, "TRN02 captured");
        st.fileId = res.fileId;
        const lines = await ctx.provider.submitter.listRemittanceLines({ fileId: st.fileId });
        ctx.assertEqual(lines.length, 1, "one remittance line");
        ctx.assertEqual(lines[0].paymentTraceNumber, `J31CHK-${ctx.runId}`, "trace propagated to line");
        st.lineIds = lines.map(l => l.id);
        return { evidence: { fileId: st.fileId } };
      },
    },
    {
      name: "post-check-proposal-replay-409",
      async run(ctx) {
        const st = (ctx as unknown as { _st: J31State })._st;
        const posted = await ctx.provider.submitter.postCheckPayment({
          orgId: st.orgId, checkNumber: `J31CHK-${ctx.runId}`, amountUsd: "900.00",
          payerName: "Aetna Health, LLC", receivedDate: "2026-09-05",
        });
        st.checkPostingId = posted.checkPostingId;
        ctx.assertEqual(posted.status, "posted", "check posted");
        ctx.assert(posted.matchProposals.length > 0, "proposal computed");
        ctx.assertEqual(posted.matchProposals[0].exactTraceMatch, true, "exactTraceMatch is the top signal");
        // NO auto-match: the posting remains 'posted' until a human confirms.
        const listed = await ctx.provider.submitter.listCheckPostings({ orgId: st.orgId });
        const mine = listed.find(c => c.id === st.checkPostingId)!;
        ctx.assertEqual(mine.status, "posted", "no auto-match persisted (proposals only)");
        let conflict = false;
        try {
          await ctx.provider.submitter.postCheckPayment({
            orgId: st.orgId, checkNumber: `J31CHK-${ctx.runId}`, amountUsd: "900.00",
            payerName: "Aetna Health, LLC", receivedDate: "2026-09-05",
          });
        } catch { conflict = true; }
        ctx.assert(conflict, "replay rejected (409 CONFLICT)");
        return { evidence: { proposals: posted.matchProposals.length } };
      },
    },
    {
      name: "human-confirm-match-and-deposit",
      async run(ctx) {
        const st = (ctx as unknown as { _st: J31State })._st;
        const matched = await ctx.provider.submitter.matchCheckToRemittances({
          checkPostingId: st.checkPostingId, remittanceLineIds: st.lineIds,
        });
        ctx.assertEqual(matched.status, "matched", "human-confirmed match");
        ctx.assertEqual(matched.discrepancyCents, 0, "no discrepancy");
        const dep = await ctx.provider.submitter.markCheckDeposited({
          checkPostingId: st.checkPostingId, depositDate: "2026-09-08",
        });
        ctx.assertEqual(dep.status, "deposited", "deposit recorded");
        const listed = await ctx.provider.submitter.listCheckPostings({ orgId: st.orgId, status: "deposited" });
        const mine = listed.find(c => c.id === st.checkPostingId)!;
        ctx.assertEqual(mine.depositDate, "2026-09-08", "deposit date persisted");
        ctx.assertEqual(mine.matchedPaymentTraceNumber, `J31CHK-${ctx.runId}`, "paper linked to ERA trace");
        // Audit trail present.
        const audit = await ctx.sql`SELECT count(*)::int AS c FROM audit_log WHERE "entityId" = ${st.checkPostingId} AND action LIKE 'submitter.%'`;
        ctx.assert(Number(audit[0].c) >= 3, "audit entries for post/match/deposit");
        return { evidence: { matchedAmountCents: matched.matchedAmountCents } };
      },
    },
    {
      name: "stripe-mocked-payment-leg",
      async run(ctx) {
        const st = (ctx as unknown as { _st: J31State })._st;
        process.env.STRIPE_ENABLED = "true";
        process.env.STRIPE_SECRET_KEY = "sk_test_j31";
        process.env.STRIPE_WEBHOOK_SECRET = WH_SECRET;
        try {
          const invite = await ctx.provider.submitter.inviteClient({ submitterOrgId: st.orgId, label: `J31 Client ${ctx.runId}` });
          await ctx.provider.submitterBilling.updateBillingConfig({ submitterClientId: invite.submitterClientId, billingModel: "flat", flatFeeUsd: 250 });
          const inv = await ctx.provider.submitterBilling.generateInvoice({
            submitterClientId: invite.submitterClientId,
            periodStart: new Date("2026-08-01"), periodEnd: new Date("2026-09-01"),
          });
          st.invoiceId = inv.invoiceId;
          // No determined disputes → total 0; set a payable total for the leg.
          await ctx.sql`UPDATE submitter_invoices SET "totalUsd" = '250.00' WHERE id = ${st.invoiceId}`;
          await ctx.provider.submitterBilling.updateInvoiceStatus({ invoiceId: st.invoiceId, status: "sent" });
          // Injected mock fetch (MOCK-VERIFIED): Checkout Session create.
          const realFetch = globalThis.fetch;
          const sessionId = `cs_j31_${ctx.runId}`;
          globalThis.fetch = (async () => new Response(
            JSON.stringify({ id: sessionId, url: `https://checkout.stripe.test/pay/${sessionId}` }),
            { status: 200, headers: { "content-type": "application/json" } },
          )) as typeof fetch;
          let link;
          try {
            link = await ctx.provider.submitterBilling.createInvoicePaymentLink({ invoiceId: st.invoiceId });
          } finally {
            globalThis.fetch = realFetch;
          }
          ctx.assertEqual(link.sessionId, sessionId, "session id persisted from mock");
          ctx.assert(link.url!.includes(sessionId), "hosted URL returned");
          ctx.assertEqual(link.stripeStatus, "unpaid", "unpaid until webhook verifies");
          // Deliver synthetically signed checkout.session.completed through
          // the REAL raw webhook handler.
          const { stripeWebhookHandler } = await import("../../billing/stripe-webhook");
          const body = JSON.stringify({
            id: `evt_j31_${ctx.runId}`, type: "checkout.session.completed",
            data: { object: { id: sessionId, payment_status: "paid", client_reference_id: st.invoiceId } },
          });
          const ts = Math.floor(Date.now() / 1000);
          const sig = createHmac("sha256", WH_SECRET).update(`${ts}.${body}`, "utf8").digest("hex");
          const mkRes = () => {
            const r = { statusCode: 0, body: null as unknown, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
            return r;
          };
          const r1 = mkRes();
          await stripeWebhookHandler(
            { headers: { "stripe-signature": `t=${ts},v1=${sig}` }, body: Buffer.from(body) } as never, r1 as never);
          ctx.assertEqual(r1.statusCode, 200, "webhook accepted");
          const status = await ctx.provider.submitterBilling.getInvoicePaymentStatus({ invoiceId: st.invoiceId });
          ctx.assertEqual(status.stripeStatus, "paid", "paid via verified webhook");
          ctx.assert(status.paidAt !== null, "paidAt set by webhook only");
          // Duplicate delivery → 200 duplicate no-op, single paid audit.
          const r2 = mkRes();
          await stripeWebhookHandler(
            { headers: { "stripe-signature": `t=${ts},v1=${sig}` }, body: Buffer.from(body) } as never, r2 as never);
          ctx.assertEqual((r2.body as { status: string }).status, "duplicate", "idempotent duplicate");
          const audit = await ctx.sql`SELECT count(*)::int AS c FROM audit_log WHERE action = 'submitterBilling.stripeWebhook.paid' AND "entityId" = ${st.invoiceId}`;
          ctx.assertEqual(Number(audit[0].c), 1, "exactly one paid audit entry");
          // Bad signature → 401.
          const r3 = mkRes();
          await stripeWebhookHandler({ headers: { "stripe-signature": "t=1,v1=bad" }, body: Buffer.from(body) } as never, r3 as never);
          ctx.assertEqual(r3.statusCode, 401, "bad signature rejected");
          return { evidence: { invoiceId: st.invoiceId, sessionId } };
        } finally {
          delete process.env.STRIPE_ENABLED;
          delete process.env.STRIPE_SECRET_KEY;
          delete process.env.STRIPE_WEBHOOK_SECRET;
        }
      },
    },
    {
      name: "stripe-disabled-fail-closed",
      async run(ctx) {
        const st = (ctx as unknown as { _st: J31State })._st;
        // Env absent → DISABLED; payment links surface PRECONDITION_FAILED
        // and the manual 'paid' flow remains the collection path.
        const inv = await ctx.provider.submitterBilling.generateInvoice({
          submitterClientId: (await ctx.provider.submitter.listClients({ submitterOrgId: st.orgId }))[0].id,
          periodStart: new Date("2026-09-01"), periodEnd: new Date("2026-09-15"),
        });
        await ctx.sql`UPDATE submitter_invoices SET "totalUsd" = '100.00' WHERE id = ${inv.invoiceId}`;
        await ctx.provider.submitterBilling.updateInvoiceStatus({ invoiceId: inv.invoiceId, status: "sent" });
        let precondition = false;
        try {
          await ctx.provider.submitterBilling.createInvoicePaymentLink({ invoiceId: inv.invoiceId });
        } catch (err) {
          precondition = (err as { code?: string }).code === "PRECONDITION_FAILED";
        }
        ctx.assert(precondition, "disabled Stripe surfaces PRECONDITION_FAILED (no fake URL)");
        const manual = await ctx.provider.submitterBilling.updateInvoiceStatus({ invoiceId: inv.invoiceId, status: "paid" });
        ctx.assertEqual(manual.status, "paid", "manual collection path unchanged");
        const status = await ctx.provider.submitterBilling.getInvoicePaymentStatus({ invoiceId: inv.invoiceId });
        ctx.assertEqual(status.stripeEnabled, false, "reports stripeEnabled=false");
        ctx.assertEqual(status.manualCollection, true, "reports manualCollection=true");
        return { evidence: { manualCollection: true } };
      },
    },
  ],
};
