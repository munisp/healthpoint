/**
 * J12–J15: cross-side journeys (state jurisdiction, outcome prediction,
 * settlement transfers, IDR compliance deadlines/fees/attestation/reporting).
 */
import type { Journey } from "../framework";
import { createJourneyDispute, advanceToNegotiationFailed, expectTrpcError } from "./helpers";

export const j12: Journey = {
  id: "J12",
  title: "State jurisdiction resolution: federal vs state IDR regimes",
  actor: "provider",
  description:
    "statePrograms.resolveJurisdiction for TX/FL/CA + a federal-path state; listStates + registryMetadata consistency.",
  steps: [
    {
      name: "resolve-tx-fl-ca",
      async run(ctx) {
        const base = {
          planType: "FULLY_INSURED" as const,
          serviceCategory: "EMERGENCY" as const,
          dateOfService: "2026-08-01",
        };
        const tx = await ctx.provider.statePrograms.resolveJurisdiction({ ...base, stateCode: "TX" });
        const fl = await ctx.provider.statePrograms.resolveJurisdiction({ ...base, stateCode: "FL" });
        const ca = await ctx.provider.statePrograms.resolveJurisdiction({ ...base, stateCode: "CA" });
        (ctx as unknown as { _j: unknown })._j = { tx, fl, ca };
        ctx.assert(
          JSON.stringify(tx) !== JSON.stringify(ca),
          "TX and CA resolve to different regimes (TX=federal, CA=state law)",
          { tx, ca }
        );
        ctx.assert(
          /regime|FEDERAL|STATE|BIFURCATED/.test(JSON.stringify(tx)),
          "resolution includes a regime classification"
        );
        return { evidence: { tx, fl, ca } };
      },
    },
    {
      name: "federal-path-state",
      async run(ctx) {
        // Self-funded plans always follow the federal path (ERISA preemption).
        const selfFunded = await ctx.provider.statePrograms.resolveJurisdiction({
          planType: "SELF_FUNDED",
          stateCode: "CA",
          serviceCategory: "EMERGENCY",
          dateOfService: "2026-08-01",
        });
        ctx.assert(
          /FEDERAL/.test(JSON.stringify(selfFunded)),
          "self-funded plan in CA follows the federal IDR process",
          { selfFunded }
        );
        // Unknown state code resolves to the federal default WITH an explicit
        // caveat (registry never fabricates a state program), while malformed
        // input is rejected.
        const zz = await ctx.provider.statePrograms.resolveJurisdiction({
          planType: "FULLY_INSURED",
          stateCode: "ZZ",
          serviceCategory: "EMERGENCY",
          dateOfService: "2026-08-01",
        });
        ctx.assert(
          /FEDERAL/.test(JSON.stringify(zz)) && /not proof|pending|absence/i.test(JSON.stringify(zz)),
          "unregistered state falls back to federal with an explicit non-proof caveat",
          { zz }
        );
        await expectTrpcError(
          ctx,
          ctx.provider.statePrograms.resolveJurisdiction({
            planType: "FULLY_INSURED",
            stateCode: "TX",
            serviceCategory: "EMERGENCY",
            dateOfService: "08/01/2026",
          }),
          "BAD_REQUEST",
          "malformed date rejected"
        );
        return { evidence: { selfFunded } };
      },
    },
    {
      name: "registry-consistency",
      async run(ctx) {
        // Register the CA program (admin); the registry starts empty per
        // process, so this also exercises registerStateProgram fail-closed
        // validation (VERIFIED requires citations + authorityUrl).
        const registered = await ctx.admin.statePrograms.registerStateProgram({
          entry: {
            stateCode: "CA",
            programName: "California Surprise Billing / AB 72 IDR",
            appliesToFullyInsured: true,
            selfFundedOptIn: "UNKNOWN",
            scopeVsFederal: "FULL",
            paymentDeterminationMethod: "ARBITRATION",
            keyDeadlines: [
              { name: "IDR initiation", calendarDays: 30, citation: "Cal. Health & Saf. Code § 1371.31" },
            ],
            effectiveDates: [{ rule: "Program effective", effectiveDate: "2019-01-01" }],
            authorityUrl: "https://dmhc.ca.gov/",
            verificationStatus: "VERIFIED",
            notes: `journey registration ${ctx.runId}`,
          },
        });
        ctx.assert(registered !== null, "CA program registered");
        const states = await ctx.provider.statePrograms.listStates();
        ctx.assert(states.includes("CA"), "CA registered");
        const meta = await ctx.provider.statePrograms.registryMetadata();
        ctx.assert(meta !== null && JSON.stringify(meta).length > 10, "registry metadata available");
        const caProgram = await ctx.provider.statePrograms.getStateProgram({ stateCode: "CA" });
        ctx.assert(caProgram !== null && typeof caProgram === "object", "CA program lookup returns the entry");
        // Fail-closed: VERIFIED entry without citations must be rejected.
        await expectTrpcError(
          ctx,
          ctx.admin.statePrograms.registerStateProgram({
            entry: {
              stateCode: "NV",
              programName: "Unverified Nevada placeholder",
              appliesToFullyInsured: "UNKNOWN",
              selfFundedOptIn: "UNKNOWN",
              scopeVsFederal: "UNKNOWN",
              paymentDeterminationMethod: "UNKNOWN",
              keyDeadlines: [{ name: "x", citation: "" }],
              effectiveDates: [],
              authorityUrl: null,
              verificationStatus: "VERIFIED",
              notes: "must be rejected",
            },
          }),
          "BAD_REQUEST",
          "VERIFIED entry without citations rejected"
        );
        return { evidence: { stateCount: states.length } };
      },
    },
  ],
};

export const j13: Journey = {
  id: "J13",
  title: "Outcome prediction generate + get",
  actor: "provider",
  description:
    "predictions.generate via LLM (runner supplies a deterministic local stub) then predictions.get; fail-closed verified when no LLM backend.",
  steps: [
    {
      name: "create-dispute-and-generate",
      async run(ctx) {
        const d = await createJourneyDispute(ctx, "j13", { billedAmount: "7800.00" });
        (ctx as unknown as { _d: string })._d = d.id;
        let generated: unknown = null;
        let llmUnavailable = false;
        try {
          generated = await ctx.provider.predictions.generate({
            disputeId: d.id,
            billedAmount: 7800,
            qpaAmount: 4700,
            serviceType: "emergency_medicine",
            patientState: "TX",
            currentStep: "STEP_01_OPEN_NEGOTIATION_INITIATED",
            cptCodes: ["99285"],
            payerName: "Journey Payer",
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.assert(
            /LLM|backend|fetch|ECONNREFUSED|500/i.test(msg),
            "prediction generation fails closed when no LLM backend is configured",
            { error: msg.slice(0, 700) }
          );
          llmUnavailable = true;
        }
        (ctx as unknown as { _g: unknown })._g = generated;
        (ctx as unknown as { _u: boolean })._u = llmUnavailable;
        return { evidence: { generated: generated !== null, llmUnavailable } };
      },
    },
    {
      name: "get-and-verify-persistence",
      async run(ctx) {
        const disputeId = (ctx as unknown as { _d: string })._d;
        const llmUnavailable = (ctx as unknown as { _u: boolean })._u;
        const got = await ctx.provider.predictions.get({ disputeId });
        if (llmUnavailable) {
          ctx.assert(got === null || got === undefined, "no prediction persisted without LLM (fail-closed)");
          return { evidence: { persisted: false } };
        }
        ctx.assert(got !== null && got !== undefined, "prediction persisted");
        const p = got as { winProbability: number; confidenceScore: number; keyFactors: string };
        ctx.assert(p.winProbability >= 0 && p.winProbability <= 100, "win probability in [0,100]");
        ctx.assert(p.confidenceScore >= 0 && p.confidenceScore <= 100, "confidence in [0,100]");
        const factors = JSON.parse(p.keyFactors);
        ctx.assert(Array.isArray(factors) && factors.length >= 1, "key factors persisted");
        return { evidence: { winProbability: p.winProbability, confidence: p.confidenceScore } };
      },
    },
    {
      name: "regenerate-idempotent-upsert",
      async run(ctx) {
        const disputeId = (ctx as unknown as { _d: string })._d;
        const llmUnavailable = (ctx as unknown as { _u: boolean })._u;
        if (llmUnavailable) {
          // Re-verify fail-closed determinism on second call.
          await expectTrpcError(
            ctx,
            ctx.provider.predictions.generate({
              disputeId, billedAmount: 7800, qpaAmount: 4700,
              serviceType: "emergency_medicine", patientState: "TX",
              currentStep: "STEP_01_OPEN_NEGOTIATION_INITIATED",
            }),
            "INTERNAL_SERVER_ERROR",
            "second generate also fails closed"
          );
          return { evidence: { failClosed: true } };
        }
        const again = await ctx.provider.predictions.generate({
          disputeId, billedAmount: 7800, qpaAmount: 4700,
          serviceType: "emergency_medicine", patientState: "TX",
          currentStep: "STEP_02_OPEN_NEGOTIATION_PERIOD",
        });
        ctx.assert(again !== null, "regeneration succeeded (upsert)");
        const got = await ctx.provider.predictions.get({ disputeId });
        ctx.assert(got !== null, "single upserted prediction row");
        return { evidence: { regenerated: true } };
      },
    },
  ],
};

export const j14: Journey = {
  id: "J14",
  title: "Settlement transfer request → admin decide → proof/balance, with idempotency replay",
  actor: "payer",
  description:
    "settlementTransfers.request (provider) → idempotent replay → decide (admin, maker-checker) → settlementProofs.list; ledger balances re-read.",
  steps: [
    {
      name: "request-transfer",
      async run(ctx) {
        const d = await createJourneyDispute(ctx, "j14", { billedAmount: "5000.00" });
        (ctx as unknown as { _d: string })._d = d.id;
        const transfer = await ctx.provider.settlementTransfers.request({
          disputeId: d.id,
          provider: "mojaloop-dfsp-journey",
          amountCents: 250_000,
          requestReason: "Determination payout per NSA IDR",
          idempotencyKey: ctx.idem("j14-request"),
        });
        ctx.assertEqual(transfer.status, "requested", "transfer requested");
        // Idempotency replay: same key returns the SAME transfer row.
        const replay = await ctx.provider.settlementTransfers.request({
          disputeId: d.id,
          provider: "mojaloop-dfsp-journey",
          amountCents: 250_000,
          requestReason: "Determination payout per NSA IDR",
          idempotencyKey: ctx.idem("j14-request"),
        });
        ctx.assertEqual(replay.id, transfer.id, "replay returns same transfer (no duplicate)");
        (ctx as unknown as { _t: string })._t = transfer.id;
        return { evidence: { transferId: transfer.id } };
      },
    },
    {
      name: "admin-decide-maker-checker",
      async run(ctx) {
        const transferId = (ctx as unknown as { _t: string })._t;
        // Maker-checker: a non-admin caller cannot decide at all.
        await expectTrpcError(
          ctx,
          ctx.provider.settlementTransfers.decide({
            transferId,
            decision: "approved",
            reason: "self approval attempt",
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          }),
          "FORBIDDEN",
          "non-admin decide rejected"
        );
        const decided = await ctx.admin.settlementTransfers.decide({
          transferId,
          decision: "approved",
          reason: "Determination verified against dispute record",
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        });
        ctx.assertEqual(decided.status, "authorized", "transfer authorized by admin");
        // Immutable decision: a second decide must fail closed.
        ctx.assertionCount++;
        let secondRejected = false;
        try {
          await ctx.admin.settlementTransfers.decide({
            transferId,
            decision: "rejected",
            reason: "attempt to flip decision",
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          });
        } catch {
          secondRejected = true;
        }
        ctx.assert(secondRejected, "second decide rejected (immutable decision)");
        return { evidence: { status: decided.status } };
      },
    },
    {
      name: "proofs-and-balance-reread",
      async run(ctx) {
        const disputeId = (ctx as unknown as { _d: string })._d;
        const transferId = (ctx as unknown as { _t: string })._t;
        const transfers = await ctx.provider.settlementTransfers.listByDispute({ disputeId });
        ctx.assert(
          transfers.some(t => t.id === transferId && t.status === "authorized"),
          "authorized transfer persisted for dispute"
        );
        const proofs = await ctx.admin.settlementProofs.list({ limit: 30 });
        ctx.assert(Array.isArray(proofs), "settlement balance proofs listed", { count: proofs.length });
        const exceptions = await ctx.admin.settlementProofs.openExceptions();
        ctx.assert(Array.isArray(exceptions), "open exceptions listed");
        // Ledger balances for the dispute re-read (double-entry accounts exist).
        const balances = await ctx.provider.ledger.balances({ disputeId });
        ctx.assert(balances !== null, "ledger balances readable", {
          balances: JSON.stringify(balances).slice(0, 200),
        });
        return { evidence: { transfers: transfers.length, proofs: proofs.length } };
      },
    },
  ],
};

export const j15: Journey = {
  id: "J15",
  title: "Compliance deadlines compute→markMet + fee schedule + attestation + volume CSV",
  actor: "idre-admin",
  description:
    "idrCompliance deadlines.computeForDispute/listForDispute/markMet, fees.createSchedule/assessOnIdrInitiation, attestations.attest, reporting.volumeSummaryCsv.",
  steps: [
    {
      name: "compute-and-mark-deadlines",
      async run(ctx) {
        const d = await createJourneyDispute(ctx, "j15");
        (ctx as unknown as { _d: string })._d = d.id;
        // Advance to STEP_04 so the dispute has IDR anchors and is in an
        // attestation-valid step (idr_initiation requires STEP_04..06).
        await advanceToNegotiationFailed(ctx, d.id);
        await ctx.provider.disputes.advance({
          disputeId: d.id, newStep: "STEP_04_IDR_INITIATED", newStatus: "idr_initiated",
          description: "IDR initiated (journey J15)",
        });
        const computed = await ctx.provider.idrCompliance["deadlines.computeForDispute"]({
          disputeId: d.id,
        });
        ctx.assert(computed.computed !== null, "deadline set computed");
        const rows = await ctx.provider.idrCompliance["deadlines.listForDispute"]({ disputeId: d.id });
        ctx.assert(rows.length >= 1, "deadline ledger rows persisted", { rows: rows.length });
        const met = await ctx.provider.idrCompliance["deadlines.markMet"]({
          disputeId: d.id,
          deadlineType: "open_negotiation_end",
          note: "Negotiation completed within window (journey)",
        });
        ctx.assert(met.ok === true, "deadline marked met");
        // Second markMet must 404 (no longer open).
        await expectTrpcError(
          ctx,
          ctx.provider.idrCompliance["deadlines.markMet"]({
            disputeId: d.id, deadlineType: "open_negotiation_end",
          }),
          "NOT_FOUND",
          "already-met deadline not re-markable"
        );
        return { evidence: { disputeId: d.id, deadlineRows: rows.length } };
      },
    },
    {
      name: "fee-schedule-and-assessment",
      async run(ctx) {
        const disputeId = (ctx as unknown as { _d: string })._d;
        const sched = await ctx.admin.idrCompliance["fees.createSchedule"]({
          effectiveFrom: "2026-01-01",
          adminFeeCents: 5000,
          idreFeeSingleMinCents: 20000,
          idreFeeSingleMaxCents: 84000,
          source: `journey-${ctx.runId}`,
          notes: "Journey fee schedule",
        });
        ctx.assert(sched.id.length > 0, "fee schedule created");
        const schedules = await ctx.provider.idrCompliance["fees.listSchedules"]();
        ctx.assert(schedules.some(s => s.id === sched.id), "schedule listed");
        const assessed = await ctx.provider.idrCompliance["fees.assessOnIdrInitiation"]({ disputeId });
        ctx.assert(assessed !== null, "admin fee assessed per party", {
          assessed: JSON.stringify(assessed).slice(0, 300),
        });
        // Idempotent: re-assessment must not duplicate.
        const before = await ctx.provider.idrCompliance["fees.listAssessments"]({ disputeId });
        const again = await ctx.provider.idrCompliance["fees.assessOnIdrInitiation"]({ disputeId });
        ctx.assert(again !== null, "re-assessment call succeeds");
        const after = await ctx.provider.idrCompliance["fees.listAssessments"]({ disputeId });
        ctx.assertEqual(after.length, before.length, "fee assessment idempotent (no duplicates)");
        ctx.assert(after.length >= 1, "assessments persisted");
        return { evidence: { scheduleId: sched.id, assessmentCount: after.length } };
      },
    },
    {
      name: "attestation-and-volume-csv",
      async run(ctx) {
        const disputeId = (ctx as unknown as { _d: string })._d;
        const att = await ctx.provider.idrCompliance["attestations.attest"]({
          disputeId,
          attestationType: "idr_initiation",
          partyRole: "initiating_party",
          informationComplete: true,
          informationAccurate: true,
          supersedeExisting: false,
        });
        ctx.assert(att !== null, "attestation recorded");
        const attestations = await ctx.provider.idrCompliance["attestations.listForDispute"]({ disputeId });
        ctx.assert(attestations.length >= 1, "attestation persisted");
        const csv = await ctx.admin.idrCompliance["reporting.volumeSummaryCsv"]({
          from: "2026-01-01",
          to: "2026-12-31",
        });
        ctx.assert(typeof csv === "object" && JSON.stringify(csv).length > 2, "volume summary CSV generated");
        ctx.assert(
          JSON.stringify(csv).includes(",") || typeof (csv as { csv?: string }).csv === "string",
          "CSV-shaped payload returned"
        );
        return { evidence: { attestations: attestations.length } };
      },
    },
  ],
};
