/**
 * J29: submitter one-stop lifecycle (Phase 18).
 *
 *  ingest 835 → auto-batch preview → offer strategy → confirm batched
 *  dispute → deadline autopilot fires (injected clock) → invoice generated
 *  from the determination → audit share link created/resolved/revoked.
 *
 * Every step exercises the REAL tRPC procedures; the deadline autopilot runs
 * its exported sweep function with an injected clock (same function the
 * scheduled endpoint calls). Fixture determinations are stamped via ctx.sql
 * (journey fixture setup only — business mutations go through procedures).
 */
import { eq } from "drizzle-orm";
import type { Journey } from "../framework";
import { getDb } from "../../db";
import { disputes } from "../../../drizzle/schema";
import { runDeadlineAutopilot } from "../../scheduled/deadlineAutopilot";

function sample835(claimId: string): string {
  return [
    "ISA*00*          *00*          *ZZ*PAYER          *ZZ*SUBMITTER      *260901*1200*^*00501*000000905*1*T*:~",
    "GS*HP*PAYER*SUBMITTER*20260901*1200*1*X*005010X221A1~",
    "ST*835*0001~",
    "BPR*I*900.00*C*ACH***************01*999999999*DA*123456*1999999999**01*111111111*DA*987654*20260901~",
    "N1*PR*AETNA HEALTH~",
    "N1*PE*JOURNEY PROVIDER*XX*1234567893~",
    "NM1*82*2*JOURNEY PROVIDER*****XX*1234567893~",
    `CLP*${claimId}*2*4200.00*900.00**MB*PAYERCTRL001*11*1~`,
    "CAS*CO*45*3300.00~",
    "LQ*HE*N830~",
    "SVC*HC:99285*4200.00*900.00**1~",
    "CAS*CO*45*3300.00~",
    "LQ*HE*N830~",
    "SE*12*0001~",
    "GE*1*1~",
    "IEA*1*000000905~",
  ].join("\n");
}

type Bag = Record<string, string>;
const bag = (ctx: unknown): Bag => ctx as Bag;

export const j29: Journey = {
  id: "J29",
  title: "Submitter one-stop: 835 → auto-batch → offer strategy → autopilot → invoice → share",
  actor: "biller",
  description:
    "Full Phase 18 one-stop-submitter loop over real procedures: delegated disputes created; an 835 ERA ingested and claim-mapped; autoBatch proposes a CMS-9897-F batch (preview-only); recommendOffer returns a labeled statistical estimate; confirmBatches materializes the batched dispute; the deadline autopilot (injected clock) emits a pre-expiry alert exactly once; a contingency invoice is generated from the determination and driven draft→sent→paid; an audit share link is created, publicly resolved, and revoked.",
  steps: [
    {
      name: "setup-and-ingest-835",
      async run(ctx) {
        const sub = await ctx.provider.orgs.create({ name: `Journey OneStop Sub ${ctx.ns("j29")}`, type: "biller" });
        const cli = await ctx.reviewer.orgs.create({ name: `Journey OneStop Cli ${ctx.ns("j29")}`, type: "provider" });
        const invite = await ctx.provider.submitter.inviteClient({
          submitterOrgId: sub.orgId, clientOrgId: cli.orgId,
          label: `J29 delegation ${ctx.runId}`, npis: ["1234567893"], tins: ["461234567"],
        });
        await ctx.reviewer.submitter.acceptDelegation({ token: invite.inviteToken });
        const att = await ctx.provider.submitter.issueAttestation({
          submitterClientId: invite.submitterClientId, scope: "both",
          authorityText: `J29 one-stop delegation authority (run ${ctx.runId}) — 45 CFR 149.510(b)(2)(ii)(A)(3).`,
          adminFeeDebtAccepted: true,
        });
        const b = bag(ctx);
        b._org = sub.orgId;
        b._sc = invite.submitterClientId;
        b._att = att.attestationId;
        const mk = async (suffix: string) => (await ctx.provider.submitter.createDelegatedDispute({
          submitterClientId: invite.submitterClientId,
          initiatingPartyType: "provider",
          initiatingPartyName: `J29 Provider ${suffix} ${ctx.ns("j29")}`,
          initiatingPartyNpi: "1234567893",
          respondingPartyName: `J29 Payer ${ctx.ns("j29")}`,
          serviceType: "emergency_medicine",
          serviceDate: new Date(Date.now() - 10 * 86400_000).toISOString(),
          patientState: "TX", facilityState: "TX",
          cptCodes: ["99285"], billedAmount: "4200.00",
          eligibilityAttested: true,
        }));
        const d1 = await mk("A");
        const d2 = await mk("B");
        b._d1 = d1.id;
        b._d2 = d2.id;
        // 835 ingest mapped to the first dispute by claim id.
        const ing = await ctx.provider.submitter.ingest835({
          orgId: sub.orgId, fileName: `j29-${ctx.runId}.835`, content: sample835(d1.referenceNumber),
        });
        ctx.assertEqual(ing.mapped, 1, "835 line mapped to dispute");
        ctx.assertEqual(ing.duplicate, false, "first ingest is not a duplicate");
        return { evidence: { disputeA: d1.referenceNumber, fileId: ing.fileId } };
      },
    },
    {
      name: "auto-batch-and-offer-strategy",
      async run(ctx) {
        const b = bag(ctx);
        const preview = await ctx.provider.submitter.autoBatch({
          submitterClientId: b._sc, disputeIds: [b._d1, b._d2],
        });
        ctx.assert(preview.previewOnly === true, "autoBatch is preview-only");
        ctx.assertEqual(preview.batches.length, 1, "one proposed batch");
        ctx.assert(preview.batches[0].economics.adminFeeSavingsUsd > 0, "projected admin-fee savings positive");
        ctx.assertEqual(preview.batches[0].economics.label, "projection_not_guarantee", "savings honestly labeled");
        const rec = await ctx.provider.submitter.recommendOffer({ disputeId: b._d1 });
        ctx.assertEqual(rec.label, "statistical_estimate", "offer strategy labeled statistical_estimate");
        ctx.assert(Array.isArray(rec.rationale) && rec.rationale.length > 0, "feature rationale present");
        const confirmed = await ctx.provider.submitter.confirmBatches({
          submitterClientId: b._sc,
          eligibilityAttested: true,
          batches: [{ disputeIds: [b._d1, b._d2] }],
        });
        ctx.assertEqual(confirmed.confirmed, 1, "one batched dispute materialized");
        ctx.assertEqual(confirmed.batches[0].lineItemCount, 2, "batch has both line items");
        b._batched = confirmed.batches[0].disputeId;
        return { evidence: { batchId: confirmed.batches[0].batchId, batchedDispute: confirmed.batches[0].referenceNumber } };
      },
    },
    {
      name: "deadline-autopilot-injected-clock",
      async run(ctx) {
        const b = bag(ctx);
        const db = (await getDb())!;
        // Pull the batched dispute's ON deadline to ~3 days out and sweep
        // with the injected clock; assert exactly-once per threshold.
        const soon = new Date(Date.now() + 3 * 86400_000);
        await db.update(disputes).set({ openNegotiationDeadline: soon }).where(eq(disputes.id, b._batched));
        const now = new Date();
        const first = await runDeadlineAutopilot(db, now, [5, 2, 1]);
        ctx.assert(first.notificationsSent >= 1, "autopilot emitted a pre-expiry alert", { first });
        const second = await runDeadlineAutopilot(db, now, [5, 2, 1]);
        ctx.assertEqual(second.notificationsSent, 0, "rerun is idempotent (no re-notify)");
        ctx.assert(second.deduped >= 1, "rerun deduped against event_log keys");
        return { evidence: { emitted: first.notificationsSent, deduped: second.deduped } };
      },
    },
    {
      name: "invoice-and-share-link",
      async run(ctx) {
        const b = bag(ctx);
        const db = (await getDb())!;
        // Fixture determination (won, $6,000) for the batched dispute.
        await db.update(disputes).set({
          determinationWinner: "initiating_party",
          determinationAmount: "6000.00",
          closedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(disputes.id, b._batched));
        await ctx.provider.submitterBilling.updateBillingConfig({
          submitterClientId: b._sc, billingModel: "contingency", contingencyPct: 25,
        });
        const inv = await ctx.provider.submitterBilling.generateInvoice({
          submitterClientId: b._sc,
          periodStart: new Date(Date.now() - 86400_000),
          periodEnd: new Date(Date.now() + 86400_000),
        });
        ctx.assertEqual(inv.totalUsd, 1500, "invoice = 25% × $6,000 award");
        ctx.assertEqual(inv.status, "draft", "invoice starts draft");
        await ctx.provider.submitterBilling.updateInvoiceStatus({ invoiceId: inv.invoiceId, status: "sent" });
        const paid = await ctx.provider.submitterBilling.updateInvoiceStatus({ invoiceId: inv.invoiceId, status: "paid" });
        ctx.assertEqual(paid.status, "paid", "lifecycle draft→sent→paid (no payment processing)");
        // Audit-as-leadgen share link on the submitter org's practice audit.
        const share = await ctx.provider.practiceAudit.createAuditShareToken({ orgId: b._org, label: `J29 share ${ctx.runId}` });
        const resolved = await ctx.reviewer.practiceAudit.resolveAuditShareToken({ token: share.shareToken });
        ctx.assert(resolved.readOnly === true, "share link resolves read-only");
        await ctx.provider.practiceAudit.revokeAuditShareToken({ shareTokenId: share.shareTokenId });
        return { evidence: { invoiceNumber: inv.invoiceNumber, totalUsd: inv.totalUsd, shareResolved: true } };
      },
    },
  ],
};
