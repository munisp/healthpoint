/**
 * Phase 18 integration (live PG, DATABASE_URL-gated):
 *  - submitterBilling: billing config → invoice generation from REAL
 *    determinations (contingency + flat) → lifecycle draft→sent→paid,
 *    invalid transitions rejected, double-billing excluded.
 *  - submitter.autoBatch / confirmBatches via the tRPC surface.
 *  - practiceAudit share tokens: create/resolve/revoke (public read-only).
 * EXECUTED-VERIFIED when DATABASE_URL is set; skipped otherwise.
 */
import "../journeys/env-defaults";
import { describe, it, expect, beforeAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { rootRouter } from "../app-router";
import { makeCtxForUser } from "../journeys/framework";
import { getDb } from "../db";
import { users as usersTable, disputes } from "../../drizzle/schema";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const RUN = Date.now().toString(36);
const SUB_USER = `p18-sub-${RUN}`;
const CLI_USER = `p18-cli-${RUN}`;

describe.skipIf(!HAS_DB)("Phase18 one-stop submitter (live PG)", () => {
  let subCaller: ReturnType<typeof rootRouter.createCaller>;
  let cliCaller: ReturnType<typeof rootRouter.createCaller>;
  let submitterOrgId = "";
  let clientOrgId = "";
  let linkId = "";

  beforeAll(async () => {
    const db = await getDb();
    expect(db).toBeTruthy();
    for (const [id, name] of [[SUB_USER, "P18 Submitter"], [CLI_USER, "P18 Client"]] as const) {
      await db!.insert(usersTable)
        .values({ id, name, email: `${id}@test.local`, loginMethod: "test", role: "user" })
        .onConflictDoNothing();
    }
    const [sub] = await db!.select().from(usersTable).where(eq(usersTable.id, SUB_USER)).limit(1);
    const [cli] = await db!.select().from(usersTable).where(eq(usersTable.id, CLI_USER)).limit(1);
    subCaller = rootRouter.createCaller(makeCtxForUser(sub));
    cliCaller = rootRouter.createCaller(makeCtxForUser(cli));

    const subOrg = await subCaller.orgs.create({ name: `P18 Sub ${RUN}`, type: "biller" });
    const cliOrg = await cliCaller.orgs.create({ name: `P18 Cli ${RUN}`, type: "provider" });
    submitterOrgId = subOrg.orgId;
    clientOrgId = cliOrg.orgId;
    const invite = await subCaller.submitter.inviteClient({
      submitterOrgId, clientOrgId, label: `P18 ${RUN}`, npis: ["1234567893"], tins: ["461234567"],
    });
    linkId = invite.submitterClientId;
    await cliCaller.submitter.acceptDelegation({ token: invite.inviteToken });
    await subCaller.submitter.issueAttestation({
      submitterClientId: linkId, scope: "both",
      authorityText: `P18 test delegation authority — 45 CFR 149.510(b)(2)(ii)(A)(3) (run ${RUN}).`,
      adminFeeDebtAccepted: true,
    });
  });

  async function createDeterminedDispute(suffix: string, winner: "initiating_party" | "responding_party", amount: string) {
    const d = await subCaller.submitter.createDelegatedDispute({
      submitterClientId: linkId,
      initiatingPartyType: "provider",
      initiatingPartyName: `P18 Provider ${suffix} ${RUN}`,
      initiatingPartyNpi: "1234567893",
      respondingPartyName: `P18 Payer ${RUN}`,
      serviceType: "emergency_medicine",
      serviceDate: new Date(Date.now() - 20 * 86400_000).toISOString(),
      patientState: "TX", facilityState: "TX",
      cptCodes: ["99285"], billedAmount: "5000.00",
      eligibilityAttested: true,
    });
    const db = (await getDb())!;
    await db.update(disputes).set({
      determinationWinner: winner,
      determinationAmount: amount,
      closedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(disputes.id, d.id));
    return d.id;
  }

  it("contingency billing: invoice from won determinations only, honest totals", async () => {
    const won = await createDeterminedDispute("won", "initiating_party", "4000.00");
    await createDeterminedDispute("lost", "responding_party", "900.00");
    await subCaller.submitterBilling.updateBillingConfig({
      submitterClientId: linkId, billingModel: "contingency", contingencyPct: 20,
    });
    const inv = await subCaller.submitterBilling.generateInvoice({
      submitterClientId: linkId,
      periodStart: new Date(Date.now() - 86400_000),
      periodEnd: new Date(Date.now() + 86400_000),
    });
    expect(inv.status).toBe("draft");
    expect(inv.billingModel).toBe("contingency");
    expect(inv.lineCount).toBe(1); // only the won dispute
    expect(inv.totalUsd).toBe(800); // 20% × 4000
    const detail = await subCaller.submitterBilling.getInvoice({ invoiceId: inv.invoiceId });
    expect(detail.lines[0].disputeId).toBe(won);
    expect(Number(detail.lines[0].awardUsd)).toBe(4000);

    // Lifecycle: draft→paid directly is invalid; draft→sent→paid works.
    await expect(subCaller.submitterBilling.updateInvoiceStatus({ invoiceId: inv.invoiceId, status: "paid" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    const sent = await subCaller.submitterBilling.updateInvoiceStatus({ invoiceId: inv.invoiceId, status: "sent" });
    expect(sent.status).toBe("sent");
    const paid = await subCaller.submitterBilling.updateInvoiceStatus({ invoiceId: inv.invoiceId, status: "paid" });
    expect(paid.status).toBe("paid");

    // Second invoice over the same period: the won dispute is already billed.
    const inv2 = await subCaller.submitterBilling.generateInvoice({
      submitterClientId: linkId,
      periodStart: new Date(Date.now() - 86400_000),
      periodEnd: new Date(Date.now() + 86400_000),
    });
    expect(inv2.lineCount).toBe(0);
    expect(inv2.totalUsd).toBe(0);
  });

  it("flat billing: per-determined-dispute fee including losses", async () => {
    await subCaller.submitterBilling.updateBillingConfig({
      submitterClientId: linkId, billingModel: "flat", flatFeeUsd: 150,
    });
    // Void the previously generated invoices so disputes are billable again.
    const existing = await subCaller.submitterBilling.listInvoices({ submitterClientId: linkId });
    for (const i of existing) {
      if (i.status !== "void") {
        if (i.status === "draft") await subCaller.submitterBilling.updateInvoiceStatus({ invoiceId: i.id, status: "void" });
      }
    }
    const inv = await subCaller.submitterBilling.generateInvoice({
      submitterClientId: linkId,
      periodStart: new Date(Date.now() - 86400_000),
      periodEnd: new Date(Date.now() + 86400_000),
    });
    // paid invoice from the previous test keeps its dispute excluded;
    // the lost dispute (now billable) is charged the flat fee.
    expect(inv.billingModel).toBe("flat");
    expect(inv.lineCount).toBe(1);
    expect(inv.totalUsd).toBe(150);
  });

  it("autoBatch preview is mutation-free; confirmBatches creates batched disputes", async () => {
    // Two fresh open disputes (same payer/NPI/code, close dates).
    const mk = async (suffix: string) => (await subCaller.submitter.createDelegatedDispute({
      submitterClientId: linkId,
      initiatingPartyType: "provider",
      initiatingPartyName: `P18 Batch ${suffix} ${RUN}`,
      initiatingPartyNpi: "1234567893",
      respondingPartyName: `Batch Payer ${RUN}`,
      serviceType: "emergency_medicine",
      serviceDate: new Date(Date.now() - 10 * 86400_000).toISOString(),
      patientState: "TX", facilityState: "TX",
      cptCodes: ["99285"], billedAmount: "1000.00",
      eligibilityAttested: true,
    })).id;
    const d1 = await mk("one");
    const d2 = await mk("two");

    const preview = await subCaller.submitter.autoBatch({ submitterClientId: linkId, disputeIds: [d1, d2] });
    expect(preview.previewOnly).toBe(true);
    expect(preview.batches).toHaveLength(1);
    expect(preview.batches[0].items).toHaveLength(2);
    expect(preview.batches[0].economics.adminFeeSavingsUsd).toBe(preview.adminFeeUsd);
    // Preview did not mutate: sources still unbatched.
    const db = (await getDb())!;
    const pre = await db.select({ batchId: disputes.batchId }).from(disputes).where(eq(disputes.id, d1));
    expect(pre[0].batchId).toBeNull();

    const confirmed = await subCaller.submitter.confirmBatches({
      submitterClientId: linkId,
      eligibilityAttested: true,
      batches: [{ disputeIds: [d1, d2] }],
    });
    expect(confirmed.confirmed).toBe(1);
    expect(confirmed.batches[0].lineItemCount).toBe(2);
    const post = await db.select({ batchId: disputes.batchId }).from(disputes).where(eq(disputes.id, d1));
    expect(post[0].batchId).toBe(confirmed.batches[0].batchId);
    // Re-confirm rejected (already batched).
    await expect(subCaller.submitter.confirmBatches({
      submitterClientId: linkId, eligibilityAttested: true, batches: [{ disputeIds: [d1, d2] }],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("audit share token: create → public resolve → revoke blocks", async () => {
    const share = await subCaller.practiceAudit.createAuditShareToken({ orgId: submitterOrgId, label: `P18 share ${RUN}` });
    expect(share.shareToken.length).toBeGreaterThanOrEqual(32);
    const listed = await subCaller.practiceAudit.listAuditShareTokens({ orgId: submitterOrgId });
    expect(listed.some(t => t.id === share.shareTokenId)).toBe(true);
    // Public resolution (unauthenticated caller).
    const pub = rootRouter.createCaller(makeCtxForUser({ id: "anon", name: "Anon", email: null, role: "user" } as never));
    const resolved = await pub.practiceAudit.resolveAuditShareToken({ token: share.shareToken });
    expect(resolved.readOnly).toBe(true);
    expect(resolved.report.totalClaims).toBe(0);
    await expect(pub.practiceAudit.resolveAuditShareToken({ token: "bogus-token" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await subCaller.practiceAudit.revokeAuditShareToken({ shareTokenId: share.shareTokenId });
    await expect(pub.practiceAudit.resolveAuditShareToken({ token: share.shareToken })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("recommendOffer returns a labeled statistical estimate from real determination stats", async () => {
    const anyDispute = await subCaller.submitter.listClientDisputes({ submitterClientId: linkId });
    expect(anyDispute.length).toBeGreaterThan(0);
    const rec = await subCaller.submitter.recommendOffer({ disputeId: anyDispute[0].id });
    expect(rec.label).toBe("statistical_estimate");
    expect(rec.features.platformSampleSize).toBeGreaterThan(0);
    expect(rec.honestyNote).toMatch(/NOT/);
  });
});
