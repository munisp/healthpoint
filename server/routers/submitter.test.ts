/**
 * Phase 16 integration: submitter router attestation lifecycle + FSM
 * delegation guard + breakeven against live Postgres. Skips when
 * DATABASE_URL is unset.
 */
import "../journeys/env-defaults";
import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { rootRouter } from "../app-router";
import { makeCtxForUser } from "../journeys/framework";
import { getDb } from "../db";
import { users as usersTable } from "../../drizzle/schema";
import { checkDelegationAttestation } from "../idr/initiation-guards";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const RUN = Date.now().toString(36);
const SUB_USER = `p16-sub-${RUN}`;
const CLI_USER = `p16-cli-${RUN}`;

describe.skipIf(!HAS_DB)("Phase16 submitter (live PG)", () => {
  let subCaller: ReturnType<typeof rootRouter.createCaller>;
  let cliCaller: ReturnType<typeof rootRouter.createCaller>;
  let submitterOrgId = "";
  let clientOrgId = "";
  let linkId = "";
  let attestationId = "";

  beforeAll(async () => {
    const db = await getDb();
    expect(db).toBeTruthy();
    for (const [id, name] of [[SUB_USER, "P16 Submitter"], [CLI_USER, "P16 Client"]] as const) {
      await db!.insert(usersTable)
        .values({ id, name, email: `${id}@test.local`, loginMethod: "test", role: "user" })
        .onConflictDoNothing();
    }
    const [sub] = await db!.select().from(usersTable).where(eq(usersTable.id, SUB_USER)).limit(1);
    const [cli] = await db!.select().from(usersTable).where(eq(usersTable.id, CLI_USER)).limit(1);
    subCaller = rootRouter.createCaller(makeCtxForUser(sub));
    cliCaller = rootRouter.createCaller(makeCtxForUser(cli));
  });

  it("runs the full delegation + attestation lifecycle", async () => {
    const sub = await subCaller.orgs.create({ name: `P16 Sub ${RUN}`, type: "biller" });
    const cli = await cliCaller.orgs.create({ name: `P16 Cli ${RUN}`, type: "provider" });
    submitterOrgId = sub.orgId;
    clientOrgId = cli.orgId;

    const invite = await subCaller.submitter.inviteClient({
      submitterOrgId, clientOrgId, label: `P16 ${RUN}`, npis: ["1234567893"], tins: ["461234567"],
    });
    expect(invite.status).toBe("pending");
    linkId = invite.submitterClientId;

    // Wrong user cannot accept.
    await expect(subCaller.submitter.acceptDelegation({ token: invite.inviteToken })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const accepted = await cliCaller.submitter.acceptDelegation({ token: invite.inviteToken });
    expect(accepted.status).toBe("active");
    // Single-use.
    await expect(cliCaller.submitter.acceptDelegation({ token: invite.inviteToken })).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    const att = await cliCaller.submitter.issueAttestation({
      submitterClientId: linkId, scope: "both",
      authorityText: `P16 authority attestation ${RUN} under 45 CFR 149.510(b)(2)(ii)(A)(3).`,
      adminFeeDebtAccepted: true,
    });
    attestationId = att.attestationId;
    expect(att.prevHash).toBe("0".repeat(64));
    const verify = await subCaller.submitter.verifyAttestation({ attestationId });
    expect(verify.artifactValid).toBe(true);
    expect(verify.chainValid).toBe(true);
    expect(verify.currentlyValid).toBe(true);
  });

  it("creates a delegated dispute and blocks IDR initiation after revocation", async () => {
    const dispute = await subCaller.submitter.createDelegatedDispute({
      submitterClientId: linkId,
      initiatingPartyType: "provider",
      initiatingPartyName: `P16 Client Provider ${RUN}`,
      initiatingPartyNpi: "1234567893",
      respondingPartyName: `P16 Payer ${RUN}`,
      serviceType: "emergency_medicine",
      serviceDate: new Date(Date.now() - 7 * 86400_000).toISOString(),
      patientState: "TX", facilityState: "TX",
      cptCodes: ["99285"], billedAmount: "3200.00",
      eligibilityAttested: true,
    });
    expect(dispute.delegationAttestationId).toBe(attestationId);

    // Guard passes with a valid attestation.
    const db = await getDb();
    const ok = await checkDelegationAttestation(db, {
      id: dispute.id, referenceNumber: dispute.referenceNumber,
      submitterClientId: linkId, delegationAttestationId: attestationId,
    });
    expect(ok.blocked).toBe(false);

    // Guard blocks when the bound attestation is missing/wrong-link.
    const wrong = await checkDelegationAttestation(db, {
      id: dispute.id, referenceNumber: dispute.referenceNumber,
      submitterClientId: linkId, delegationAttestationId: "nonexistent",
    });
    expect(wrong.blocked).toBe(true);

    // Revoke → guard blocks.
    await subCaller.submitter.revokeAttestation({ attestationId, reason: "test revocation" });
    const blocked = await checkDelegationAttestation(db, {
      id: dispute.id, referenceNumber: dispute.referenceNumber,
      submitterClientId: linkId, delegationAttestationId: attestationId,
    });
    expect(blocked.blocked).toBe(true);
    expect(blocked.detail).toMatch(/revoked/i);

    // Non-delegated disputes are unaffected.
    const plain = await checkDelegationAttestation(db, { id: "whatever", referenceNumber: null });
    expect(plain.blocked).toBe(false);
  });

  it("computes breakeven with DB-first fee constants and platform win rate", async () => {
    const r = await subCaller.submitter.breakevenAnalysis({ expectedAwardUsd: 4000, batched: false });
    expect(r.adminFeeUsd).toBe(15); // $15 tier, disputes initiated on/after 2026-06-11
    expect(r.idreFeeRangeUsd).toEqual({ min: 200, max: 840 });
    const b = await subCaller.submitter.breakevenAnalysis({ expectedAwardUsd: 4000, batched: true, lineItemCount: 10 });
    expect(b.idreFeeRangeUsd).toEqual({ min: 268, max: 1173 });
    // Deterministic under an explicit win-rate override: EV = p*4000 - 15 - (1-p)*200.
    const det = await subCaller.submitter.breakevenAnalysis({ expectedAwardUsd: 4000, winRateOverride: 0.8 });
    expect(det.expectedNetUsd).toBeCloseTo(0.8 * 4000 - 15 - 0.2 * 200, 2);
    expect(det.breakevenAwardUsd).toBeCloseTo((15 + 0.2 * 200) / 0.8, 2);
    // Historical fee: pre-2024-01-22 asOf → $50 tier (params/DB agree).
    const hist = await subCaller.submitter.breakevenAnalysis({ expectedAwardUsd: 4000, asOf: new Date("2023-06-01"), winRateOverride: 0.8 });
    expect(hist.adminFeeUsd).toBe(50);
  });

  it("ingests an 835 with dedupe and claim-id mapping", async () => {
    // Reuse linkId? Attestation revoked — create a fresh link+attestation and dispute.
    const cli2 = await cliCaller.orgs.create({ name: `P16 Cli2 ${RUN}`, type: "provider" });
    const invite = await subCaller.submitter.inviteClient({
      submitterOrgId, clientOrgId: cli2.orgId, label: `P16-835 ${RUN}`, npis: [], tins: [],
    });
    await cliCaller.submitter.acceptDelegation({ token: invite.inviteToken });
    const att = await subCaller.submitter.issueAttestation({
      submitterClientId: invite.submitterClientId, scope: "idr",
      authorityText: `P16 835 mapping attestation ${RUN}.`, adminFeeDebtAccepted: false,
    });
    const dispute = await subCaller.submitter.createDelegatedDispute({
      submitterClientId: invite.submitterClientId,
      initiatingPartyType: "provider",
      initiatingPartyName: `P16 835 Provider ${RUN}`,
      initiatingPartyNpi: "1234567893", // Phase 17-CE intake gate requires rendering/billing NPI
      respondingPartyName: `P16 Payer ${RUN}`,
      serviceType: "emergency_medicine",
      serviceDate: new Date(Date.now() - 3 * 86400_000).toISOString(),
      patientState: "TX", facilityState: "TX",
      cptCodes: ["99285"], billedAmount: "4200.00",
      eligibilityAttested: true,
    });
    void att;
    const content = [
      "ISA*00*          *00*          *ZZ*AETNA          *ZZ*MERIDIANRCM    *260901*1200*^*00501*000000905*1*T*:~",
      "ST*835*0001~",
      "N1*PR*AETNA HEALTH~",
      "NM1*82*2*LAKESHORE EMERGENCY PHYSICIANS*****XX*1234567893~",
      `CLP*${dispute.referenceNumber}*2*4200.00*900.00**MB*PAYERCTRL001*11*1~`,
      "SVC*HC:99285*4200.00*900.00**1~",
      "CAS*CO*45*3300.00~",
      "LQ*HE*N830~",
      "SE*7*0001~",
    ].join("\n");
    const ing = await subCaller.submitter.ingest835({ orgId: submitterOrgId, fileName: `p16-${RUN}.835`, content });
    expect(ing.status).toBe("parsed");
    expect(ing.lineCount).toBe(1);
    expect(ing.mapped).toBe(1);
    const lines = await subCaller.submitter.listRemittanceLines({ fileId: ing.fileId });
    expect(lines[0].idrEligibleFlag).toBe(true);
    expect(lines[0].mappedDisputeId).toBe(dispute.id);
    const dup = await subCaller.submitter.ingest835({ orgId: submitterOrgId, fileName: "dup.835", content });
    expect(dup.duplicate).toBe(true);
  });
});
