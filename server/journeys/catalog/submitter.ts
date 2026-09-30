/**
 * J25–J26: third-party-submitter (delegated representative) journeys.
 *
 *  J25 submitter onboarding: submitter org → client org → delegation invite
 *      → accept → authority attestation (hash-chained) → verify → revoke.
 *  J26 delegated dispute lifecycle: eligibility-attested delegated dispute
 *      creation → 835 ingest (RARC N830 eligibility flag, claim-id mapping)
 *      → CMS-9897-F batching evaluation (50-cap, Category I CPT relatedness)
 *      → FSM delegation-guard evidence (advance allowed with a valid
 *      attestation; blocked after revocation).
 *
 * Statutory anchors: 45 CFR 149.510(b)(2)(ii)(A)(3) (representative +
 * authority attestation), CMS-9897-F batching (50-cap + three relatedness
 * criteria for ONPs on/after 2026-11-01), RARC N830 eligibility signaling.
 */
import type { Journey } from "../framework";
import { expectTrpcError, JOURNEY_STEP04_GATE_FIELDS } from "./helpers";
import { evaluateBatchEligibility } from "../../idr/batching/batching";

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

export const j25: Journey = {
  id: "J25",
  title: "Submitter onboarding: org → client invite → accept → attestation",
  actor: "biller",
  description:
    "Provider fixture creates a biller (submitter) org; reviewer fixture creates a provider (client) org; submitter invites the client; reviewer accepts the delegation; an authority attestation is issued (hash-chained), verified, and revoked — 45 CFR 149.510(b)(2)(ii)(A)(3).",
  steps: [
    {
      name: "orgs-and-invite",
      async run(ctx) {
        const sub = await ctx.provider.orgs.create({ name: `Journey Submitter ${ctx.ns("j25")}`, type: "biller" });
        const cli = await ctx.reviewer.orgs.create({ name: `Journey Client ${ctx.ns("j25")}`, type: "provider" });
        (ctx as unknown as { _sub: string; _cli: string })._sub = sub.orgId;
        (ctx as unknown as { _cli: string })._cli = cli.orgId;
        const invite = await ctx.provider.submitter.inviteClient({
          submitterOrgId: sub.orgId,
          clientOrgId: cli.orgId,
          label: `J25 delegation ${ctx.runId}`,
          npis: ["1234567893"],
          tins: ["461234567"],
        });
        ctx.assertEqual(invite.status, "pending", "link starts pending");
        ctx.assert(invite.inviteToken.length >= 32, "raw bearer token returned once");
        (ctx as unknown as { _token: string; _sc: string })._token = invite.inviteToken;
        (ctx as unknown as { _sc: string })._sc = invite.submitterClientId;
        // Negative: the submitter cannot accept its own invite (not a client member).
        await expectTrpcError(ctx, ctx.provider.submitter.acceptDelegation({ token: invite.inviteToken }), "FORBIDDEN", "submitter-side accept rejected");
        return { evidence: { submitterOrgId: sub.orgId, clientOrgId: cli.orgId, submitterClientId: invite.submitterClientId } };
      },
    },
    {
      name: "accept-attest-verify-revoke",
      async run(ctx) {
        const { _token: token, _sc: scId } = ctx as unknown as { _token: string; _sc: string };
        const accepted = await ctx.reviewer.submitter.acceptDelegation({ token });
        ctx.assertEqual(accepted.status, "active", "delegation active after accept");
        // Token is single-use.
        await expectTrpcError(ctx, ctx.reviewer.submitter.acceptDelegation({ token }), "UNAUTHORIZED", "token replay rejected");
        // Attestation issued by the client-side authority (reviewer).
        const att = await ctx.reviewer.submitter.issueAttestation({
          submitterClientId: scId,
          scope: "both",
          authorityText: `Journey client delegates Federal IDR submission authority to the submitter org under 45 CFR 149.510(b)(2)(ii)(A)(3) (run ${ctx.runId}).`,
          adminFeeDebtAccepted: true,
        });
        ctx.assert(att.artifactSha256.length === 64, "artifact sha256 persisted");
        ctx.assertEqual(att.prevHash, "0".repeat(64), "first attestation chains to genesis");
        const verify = await ctx.provider.submitter.verifyAttestation({ attestationId: att.attestationId });
        ctx.assert(verify.artifactValid && verify.chainValid && verify.currentlyValid, "attestation verifies", verify as unknown as Record<string, unknown>);
        // Second attestation chains to the first.
        const att2 = await ctx.provider.submitter.issueAttestation({
          submitterClientId: scId,
          scope: "idr",
          authorityText: `Renewed IDR-only delegation (run ${ctx.runId}).`,
          adminFeeDebtAccepted: false,
        });
        ctx.assertEqual(att2.prevHash, att.artifactSha256, "hash chain links second attestation to first");
        const revoked = await ctx.provider.submitter.revokeAttestation({ attestationId: att.attestationId, reason: "superseded by IDR-only attestation (journey)" });
        ctx.assertEqual(revoked.status, "revoked", "revocation recorded");
        const verifyAfter = await ctx.provider.submitter.verifyAttestation({ attestationId: att.attestationId });
        ctx.assert(!verifyAfter.currentlyValid, "revoked attestation no longer currently valid");
        return { evidence: { attestationId: att.attestationId, chained: att2.prevHash === att.artifactSha256 } };
      },
    },
  ],
};

export const j26: Journey = {
  id: "J26",
  title: "Delegated dispute lifecycle: 835 flag → batched create → FSM guard",
  actor: "biller",
  description:
    "Submitter creates an eligibility-attested delegated dispute; an 835 ERA carrying RARC N830 is ingested (dedupe by content hash, claim-id mapped); CMS-9897-F batching evaluates the 50-cap + Category I CPT relatedness; the FSM delegation guard permits STEP_04 with a valid attestation and blocks after revocation.",
  steps: [
    {
      name: "delegated-dispute-create",
      async run(ctx) {
        const sub = await ctx.provider.orgs.create({ name: `Journey Submitter ${ctx.ns("j26")}`, type: "biller" });
        const cli = await ctx.reviewer.orgs.create({ name: `Journey Client ${ctx.ns("j26")}`, type: "provider" });
        const invite = await ctx.provider.submitter.inviteClient({
          submitterOrgId: sub.orgId, clientOrgId: cli.orgId,
          label: `J26 delegation ${ctx.runId}`, npis: ["1234567893"], tins: ["461234567"],
        });
        await ctx.reviewer.submitter.acceptDelegation({ token: invite.inviteToken });
        const att = await ctx.provider.submitter.issueAttestation({
          submitterClientId: invite.submitterClientId,
          scope: "idr",
          authorityText: `J26 IDR delegation authority (run ${ctx.runId}) — 45 CFR 149.510(b)(2)(ii)(A)(3).`,
          adminFeeDebtAccepted: true,
        });
        (ctx as unknown as { _sc: string; _att: string; _org: string })._sc = invite.submitterClientId;
        (ctx as unknown as { _att: string })._att = att.attestationId;
        (ctx as unknown as { _org: string })._org = sub.orgId;
        const dispute = await ctx.provider.submitter.createDelegatedDispute({
          submitterClientId: invite.submitterClientId,
          initiatingPartyType: "provider",
          initiatingPartyName: `Journey Client Provider ${ctx.ns("j26")}`,
          initiatingPartyNpi: "1234567893",
          respondingPartyName: `Journey Payer ${ctx.ns("j26")}`,
          serviceType: "emergency_medicine",
          serviceDate: new Date(Date.now() - 10 * 86400_000).toISOString(),
          patientState: "TX",
          facilityState: "TX",
          cptCodes: ["99285"],
          billedAmount: "4200.00",
          eligibilityAttested: true,
        });
        ctx.assert(dispute.delegationAttestationId === att.attestationId, "dispute bound to attestation");
        (ctx as unknown as { _d: string })._d = dispute.id;
        // Negative: a claims-only-scope attestation cannot create IDR disputes.
        const cli2 = await ctx.reviewer.orgs.create({ name: `Journey Client 2 ${ctx.ns("j26")}`, type: "provider" });
        const invite2 = await ctx.provider.submitter.inviteClient({
          submitterOrgId: sub.orgId, clientOrgId: cli2.orgId, label: `J26 claims-only ${ctx.runId}`, npis: [], tins: [],
        });
        await ctx.reviewer.submitter.acceptDelegation({ token: invite2.inviteToken });
        await ctx.provider.submitter.issueAttestation({
          submitterClientId: invite2.submitterClientId, scope: "claims",
          authorityText: `J26 claims-only delegation (run ${ctx.runId}).`, adminFeeDebtAccepted: false,
        });
        await expectTrpcError(ctx, ctx.provider.submitter.createDelegatedDispute({
          submitterClientId: invite2.submitterClientId,
          initiatingPartyType: "provider",
          initiatingPartyName: `Journey Client 2 Provider ${ctx.ns("j26")}`,
          serviceType: "emergency_medicine",
          serviceDate: new Date(Date.now() - 10 * 86400_000).toISOString(),
          patientState: "TX", facilityState: "TX",
          cptCodes: ["99285"], billedAmount: "1000.00",
          eligibilityAttested: true,
        }), "BAD_REQUEST", "claims-only attestation cannot create IDR disputes");
        return { evidence: { disputeId: dispute.id, referenceNumber: dispute.referenceNumber } };
      },
    },
    {
      name: "835-ingest-eligibility-flag",
      async run(ctx) {
        const { _org: orgId, _d: disputeId } = ctx as unknown as { _org: string; _d: string };
        const detail = await ctx.provider.disputes.getById({ id: disputeId });
        const content = sample835(detail.referenceNumber);
        const ing = await ctx.provider.submitter.ingest835({ orgId, fileName: `j26-${ctx.runId}.835`, content });
        ctx.assertEqual(ing.lineCount, 1, "one service line parsed");
        ctx.assertEqual(ing.mapped, 1, "line mapped to dispute by claim id");
        const lines = await ctx.provider.submitter.listRemittanceLines({ fileId: ing.fileId });
        ctx.assert(lines[0].idrEligibleFlag === true, "RARC N830 sets idrEligibleFlag");
        ctx.assert(lines[0].rarcCodes?.includes("N830"), "RARC extracted");
        ctx.assert(lines[0].carcCodes?.includes("45"), "CARC extracted");
        // Content-hash dedupe: identical file is a duplicate, no new lines.
        const dup = await ctx.provider.submitter.ingest835({ orgId, fileName: `j26-${ctx.runId}-dup.835`, content });
        ctx.assert(dup.duplicate === true, "content-hash dedupe hit");
        return { evidence: { fileId: ing.fileId, idrEligibleFlag: lines[0].idrEligibleFlag, duplicate: dup.duplicate } };
      },
    },
    {
      name: "batching-and-fsm-guard",
      async run(ctx) {
        const { _sc: scId, _att: attId, _d: disputeId } = ctx as unknown as { _sc: string; _att: attId; _d: string };
        // CMS-9897-F regime: ONP 2026-11-15 → cap 50, anesthesia CPT range relatedness.
        const res = evaluateBatchEligibility(
          [
            { lineItemId: "a", serviceCode: "01996", providerNpi: "1234567893", payerId: "AETNA", qualifiedIdrItem: true, dateOfService: new Date("2026-11-02") },
            { lineItemId: "b", serviceCode: "01402", providerNpi: "1234567893", payerId: "AETNA", qualifiedIdrItem: true, dateOfService: new Date("2026-11-03") },
          ],
          { openNegotiationNoticeDate: new Date("2026-11-15") }
        );
        ctx.assert(res.eligible === true, "anesthesia CPT range relatedness batch eligible", { failures: res.failures });
        ctx.assertEqual(res.capApplied, 50, "50-cap applies on/after 2026-11-01");
        const legacy = evaluateBatchEligibility(
          [
            { lineItemId: "a", serviceCode: "01996", providerNpi: "1234567893", payerId: "AETNA", qualifiedIdrItem: true, dateOfService: new Date("2026-10-02") },
            { lineItemId: "b", serviceCode: "01402", providerNpi: "1234567893", payerId: "AETNA", qualifiedIdrItem: true, dateOfService: new Date("2026-10-03") },
          ],
          { openNegotiationNoticeDate: new Date("2026-10-15") }
        );
        ctx.assert(legacy.eligible === false, "legacy regime requires identical service codes");
        ctx.assertEqual(legacy.capApplied, 25, "25-cap before 2026-11-01");
        // FSM guard evidence: valid attestation allows STEP_04.
        await ctx.provider.disputes.submitOffer({ disputeId, offerType: "qpa", amount: "2600.00", rationale: "QPA (journey)" });
        await ctx.provider.disputes.advance({ disputeId, newStep: "STEP_02_OPEN_NEGOTIATION_PERIOD", newStatus: "open_negotiation", description: "ON started (journey)" });
        await ctx.provider.disputes.advance({ disputeId, newStep: "STEP_03_OPEN_NEGOTIATION_FAILED", newStatus: "idr_initiated", description: "ON failed (journey)" });
        await ctx.provider.disputes.advance({ disputeId, newStep: "STEP_04_IDR_INITIATED", newStatus: "idr_initiated", description: "IDR initiated with valid delegation attestation (journey)", ...JOURNEY_STEP04_GATE_FIELDS });
        // FSM guard evidence (negative): create a second delegated dispute
        // while the attestation is still valid, walk it to STEP_03, then
        // revoke the attestation and assert STEP_04 is blocked by the
        // delegation guard (45 CFR 149.510(b)(2)(ii)(A)(3) fail-closed).
        const dispute2 = await ctx.provider.submitter.createDelegatedDispute({
          submitterClientId: scId,
          initiatingPartyType: "provider",
          initiatingPartyName: `Journey Client Provider B ${ctx.ns("j26")}`,
          initiatingPartyNpi: "1234567893",
          respondingPartyName: `Journey Payer ${ctx.ns("j26")}`,
          serviceType: "emergency_medicine",
          serviceDate: new Date(Date.now() - 5 * 86400_000).toISOString(),
          patientState: "TX", facilityState: "TX",
          cptCodes: ["99284"], billedAmount: "900.00",
          eligibilityAttested: true,
        });
        await ctx.provider.submitter.revokeAttestation({ attestationId: attId, reason: "guard evidence (journey)" });
        await ctx.provider.disputes.submitOffer({ disputeId: dispute2.id, offerType: "qpa", amount: "600.00", rationale: "QPA (journey)" });
        await ctx.provider.disputes.advance({ disputeId: dispute2.id, newStep: "STEP_02_OPEN_NEGOTIATION_PERIOD", newStatus: "open_negotiation", description: "ON started (journey)" });
        await ctx.provider.disputes.advance({ disputeId: dispute2.id, newStep: "STEP_03_OPEN_NEGOTIATION_FAILED", newStatus: "idr_initiated", description: "ON failed (journey)" });
        const blockedMsg = await expectTrpcError(ctx, ctx.provider.disputes.advance({
          disputeId: dispute2.id, newStep: "STEP_04_IDR_INITIATED", newStatus: "idr_initiated",
          description: "attempt after attestation revocation",
        }), "BAD_REQUEST", "delegation guard blocks STEP_04 after revocation");
        ctx.assert(/attestation/i.test(blockedMsg), "guard message cites the attestation requirement", { blockedMsg });
        return { evidence: { capApplied: res.capApplied, guardBlocked: true } };
      },
    },
  ],
};
