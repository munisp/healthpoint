/**
 * J28: completeness enforcement lifecycle (Phase 17-CE).
 *
 *  Fail-closed gates computed FROM the CMS required-fields dictionary
 *  (server/eligibility/required-fields.ts):
 *   1. disputes.create with a missing rendering NPI is BLOCKED
 *      (PRECONDITION_FAILED) with structured missingFields (key + CFR
 *      citation + source paths) — never created half-populated.
 *   2. A complete intake succeeds; the getById completeness projection shows
 *      the ON context complete and the IDR context missing gate-only fields.
 *   3. STEP_02/STEP_03 advance (ON gate passes); STEP_04 without planType /
 *      noticeConsentStatus / conflictCheck is BLOCKED with exact fields.
 *   4. STEP_04 with the gate fields succeeds; a completeness_gate event is
 *      persisted and the projection reaches 100%.
 *   5. Intake repair loop: an 837-staged claim surfaces in
 *      practiceAudit.listIncompleteClaims with its checklist;
 *      bulkCompleteClaims applies manual values, re-scores, and the verdict
 *      transitions NEEDS_REVIEW → QUALIFIES.
 *
 * Fixture dates are relative to run time so the §149.510(b)(2)(i) initiation
 * window is always in-window.
 */
import type { Journey } from "../framework";
import { createJourneyDispute, advanceToNegotiationFailed, expectTrpcError, JOURNEY_STEP04_GATE_FIELDS } from "./helpers";

function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
}
function compact(d: string): string {
  return d.replace(/-/g, "");
}

function fixture837(dos: string): string {
  return [
    "ISA*00*          *00*          *ZZ*SUBMITTER      *ZZ*CLEARINGHOUSE  *260905*1200*^*00501*000000905*1*T*:~",
    "GS*HC*SUBMITTER*CLEARINGHOUSE*20260905*1200*1*X*005010X222A1~",
    "ST*837*0001*005010X222A1~",
    "NM1*41*2*JOURNEY BILLING*****XX*1234567893~",
    "NM1*85*2*JOURNEY MEDICAL GROUP*****XX*1234567893~",
    "N3*100 MAIN ST~",
    "N4*ALBUQUERQUE*NM*87101~",
    "REF*EI*461234567~",
    "NM1*QC*1*DOE*JANE~",
    "N3*22 PATIENT LN~",
    "N4*ALBUQUERQUE*NM*87102~",
    "NM1*PR*2*AETNA HEALTH*****PI*60054~",
    "CLM*J28-837-001*1800***23:B:1*Y*A*Y*Y~",
    "HI*ABK:R07.9~",
    "LX*1~",
    "SV1*HC:99283*1800*UN*1*23**1~",
    `DTP*472*D8*${compact(dos)}~`,
    "SE*20*0001~",
    "GE*1*1~",
    "IEA*1*000000905~",
  ].join("\n");
}

export const j28: Journey = {
  id: "J28",
  title: "Completeness gates: blocked intake → gate evidence at STEP_01/STEP_04 → repair loop",
  actor: "provider",
  description:
    "Fail-closed CMS required-data enforcement: incomplete dispute intake is blocked with structured missingFields (citations + source paths); a complete dispute advances through the open-negotiation gate; IDR initiation is blocked until planType/noticeConsentStatus/conflictCheck are supplied, then passes and persists a completeness_gate event; the practiceAudit repair loop completes an incomplete staged claim and re-scores it to QUALIFIES.",
  steps: [
    {
      name: "create-blocked-with-structured-missing-fields",
      async run(ctx) {
        const msg = await expectTrpcError(ctx, ctx.provider.disputes.create({
          initiatingPartyType: "provider",
          initiatingPartyName: `J28 Provider ${ctx.ns("j28")}`,
          // initiatingPartyNpi deliberately omitted — dictionary renderingNpi
          respondingPartyType: "payer",
          respondingPartyName: `J28 Payer ${ctx.ns("j28")}`,
          serviceType: "emergency_medicine",
          serviceDate: new Date(Date.now() - 10 * 86400_000).toISOString(),
          patientState: "NM",
          facilityState: "NM",
          cptCodes: ["99285"],
          billedAmount: "4200.00",
        }), "PRECONDITION_FAILED", "intake gate blocks missing rendering NPI");
        ctx.assert(/renderingNpi/.test(msg), "rejection names the missing dictionary key", { msg });
        ctx.assert(/45 CFR/.test(msg), "rejection is anchored in the CFR fail-closed rule");
        return { evidence: { blockedMessage: msg.slice(0, 200) } };
      },
    },
    {
      name: "create-complete-and-projection",
      async run(ctx) {
        const d = await createJourneyDispute(ctx, "j28", { patientState: "NM", facilityState: "NM" });
        (ctx as unknown as { _d: string })._d = d.id;
        const detail = await ctx.provider.disputes.getById({ id: d.id });
        const comp = (detail as unknown as { completeness: { overallCompletenessPct: number; contexts: Array<{ context: string; completenessPct: number; missingFields: Array<{ key: string }> }> } }).completeness;
        ctx.assert(comp, "completeness projection attached to getById");
        const on = comp.contexts.find(c => c.context === "open_negotiation_initiation");
        const idr = comp.contexts.find(c => c.context === "idr_initiation");
        ctx.assertEqual(on?.completenessPct, 100, "ON-initiation context complete after gated intake");
        ctx.assert(idr && idr.completenessPct < 100, "IDR context honestly incomplete before gate fields supplied");
        const missingKeys = idr!.missingFields.map(m => m.key);
        ctx.assert(missingKeys.includes("planType"), "projection flags planType missing");
        ctx.assert(missingKeys.includes("conflictCheck"), "projection flags conflictCheck missing");
        return { evidence: { disputeId: d.id, idrMissing: missingKeys } };
      },
    },
    {
      name: "advance-through-open-negotiation-gate",
      async run(ctx) {
        const { _d: disputeId } = ctx as unknown as { _d: string };
        // submitOffer(qpa) + STEP_02 + STEP_03 — the STEP_02 transition passes
        // through the fail-closed open_negotiation_initiation gate.
        await advanceToNegotiationFailed(ctx, disputeId);
        const detail = await ctx.provider.disputes.getById({ id: disputeId });
        ctx.assertEqual(detail.currentStep, "STEP_03_OPEN_NEGOTIATION_FAILED", "advanced through the ON gate");
        return { evidence: { currentStep: detail.currentStep } };
      },
    },
    {
      name: "step04-blocked-until-gate-fields-supplied",
      async run(ctx) {
        const { _d: disputeId } = ctx as unknown as { _d: string };
        const msg = await expectTrpcError(ctx, ctx.provider.disputes.advance({
          disputeId,
          newStep: "STEP_04_IDR_INITIATED",
          newStatus: "idr_initiated",
          description: "IDR initiated without completeness gate fields (journey negative)",
        }), "PRECONDITION_FAILED", "IDR-initiation gate blocks incomplete dispute");
        for (const key of ["planType", "noticeConsentStatus", "conflictCheck"]) {
          ctx.assert(msg.includes(key), `STEP_04 rejection names ${key}`, { msg });
        }
        return { evidence: { blockedMessage: msg.slice(0, 240) } };
      },
    },
    {
      name: "step04-passes-with-gate-evidence",
      async run(ctx) {
        const { _d: disputeId } = ctx as unknown as { _d: string };
        await ctx.provider.disputes.advance({
          disputeId,
          newStep: "STEP_04_IDR_INITIATED",
          newStatus: "idr_initiated",
          description: "IDR initiated with complete CMS-required data (journey)",
          ...JOURNEY_STEP04_GATE_FIELDS,
        });
        const detail = await ctx.provider.disputes.getById({ id: disputeId });
        ctx.assertEqual(detail.currentStep, "STEP_04_IDR_INITIATED", "STEP_04 reached after gate pass");
        const events = (detail as unknown as { events: Array<{ eventType: string; metadata?: unknown }> }).events;
        const gateEvent = events.find(e => e.eventType === "completeness_gate");
        ctx.assert(gateEvent, "completeness_gate event persisted as evidence of record");
        const comp = (detail as unknown as { completeness: { overallCompletenessPct: number } }).completeness;
        ctx.assertEqual(comp.overallCompletenessPct, 100, "projection reaches 100% from gate evidence");
        // List projection carries the same summary (batched evidence read).
        const list = await ctx.provider.disputes.list({ limit: 50 });
        const row = list.items.find(i => i.id === disputeId) as unknown as { completeness?: { overallCompletenessPct: number } } | undefined;
        ctx.assert(row?.completeness, "completeness projection attached to list rows");
        ctx.assertEqual(row!.completeness!.overallCompletenessPct, 100, "list projection reflects gate evidence");
        return { evidence: { gateEvent: (gateEvent!.metadata as Record<string, unknown>)?.context } };
      },
    },
    {
      name: "intake-repair-loop-rescore",
      async run(ctx) {
        const org = await ctx.provider.orgs.create({ name: `J28 Repair ${ctx.ns("j28r")}`, type: "provider" });
        const ing = await ctx.provider.practiceAudit.ingest837({ orgId: org.orgId, fileName: "j28.837", content: fixture837(isoDaysAgo(15)) });
        ctx.assertEqual(ing.inserted, 1, "837 claim staged");
        await ctx.provider.practiceAudit.scoreClaims({ orgId: org.orgId });
        const inc = await ctx.provider.practiceAudit.listIncompleteClaims({ orgId: org.orgId });
        ctx.assertEqual(inc.incompleteCount, 1, "incomplete claim surfaces in the repair queue");
        const entry = inc.claims[0];
        ctx.assertEqual(entry.verdict, "NEEDS_REVIEW", "staged 837 claim is NEEDS_REVIEW");
        ctx.assert(entry.missingFields.includes("planType"), "checklist flags planType");
        ctx.assert(Array.isArray(entry.checklist) && entry.checklist.length > 0, "per-claim checklist exposed");
        const fix = await ctx.provider.practiceAudit.bulkCompleteClaims({
          orgId: org.orgId,
          updates: [{
            claimDbId: entry.claimDbId,
            fields: {
              planType: "SELF_FUNDED",
              serviceCategory: "EMERGENCY",
              networkStatus: "out_of_network",
              noticeConsentStatus: "none",
              facilityState: "NM",
              patientState: "NM",
              initialPaymentDate: isoDaysAgo(5),
            },
          }],
        });
        ctx.assertEqual(fix.updated, 1, "one claim bulk-completed");
        ctx.assertEqual(fix.results[0].previousVerdict, "NEEDS_REVIEW", "prior verdict recorded");
        ctx.assertEqual(fix.results[0].verdict, "QUALIFIES", "verdict transitions after completion + re-score");
        ctx.assertEqual(fix.results[0].missingFields.length, 0, "no missing fields after completion");
        const after = await ctx.provider.practiceAudit.listIncompleteClaims({ orgId: org.orgId });
        ctx.assertEqual(after.incompleteCount, 0, "repair queue drains after completion");
        return { evidence: { transition: fix.results[0].transition } };
      },
    },
  ],
};
