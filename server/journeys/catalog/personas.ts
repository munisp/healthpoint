/**
 * J21–J24: missing-stakeholder-persona journeys (v1).
 *
 *  J21 payer:   invite → link → ON response → counter-offer → accept → payment intent
 *  J22 patient: token issue → redacted view → document upload → PPDR intake
 *  J23 IDRE:    propose → decline → re-propose → COI reject → accept →
 *               prohibited-basis rejection → valid determination
 *  J24 orgs:    create → membership → switch context → org-scoped dispute list
 *
 * The reviewer fixture user doubles as the payer contact (J21) and the
 * arbitrator (J23); the patient fixture user calls the PUBLIC patient-portal
 * procedures (publicProcedure ignores the caller identity).
 */
import type { Journey } from "../framework";
import { FIXTURE_USERS } from "../framework";
import { createJourneyDispute, expectTrpcError } from "./helpers";

const REVIEWER_EMAIL = `${FIXTURE_USERS.reviewer}@journeys.local`;

export const j21: Journey = {
  id: "J21",
  title: "Payer: invite → link → ON response → counter-offer → accept → payment intent",
  actor: "payer",
  description:
    "payer.invite creates the account+link; reviewer (payer contact) lists cases, responds to the ON notice, counters, accepts, and records a settlement transfer draft — every proc gated by payer_case_links membership.",
  steps: [
    {
      name: "invite-and-link",
      async run(ctx) {
        const d = await createJourneyDispute(ctx, "j21");
        (ctx as unknown as { _d: string })._d = d.id;
        const invite = await ctx.provider.payer.invite({
          disputeId: d.id,
          payerName: `Journey Payer ${ctx.runId}`,
          contactEmail: REVIEWER_EMAIL,
        });
        ctx.assert(invite.payerAccountId, "payer account created");
        ctx.assertEqual(invite.status, "invited", "link starts as invited");
        // Negative: provider user has no payer account → empty queue.
        const providerQueue = await ctx.provider.payer.listCases();
        ctx.assertEqual(providerQueue.account, null, "provider has no payer account");
        return { evidence: { payerAccountId: invite.payerAccountId } };
      },
    },
    {
      name: "respond-counter-accept-pay",
      async run(ctx) {
        const disputeId = (ctx as unknown as { _d: string })._d;
        const queue = await ctx.reviewer.payer.listCases();
        ctx.assert(queue.cases.some(c => c.disputeId === disputeId), "payer queue contains the dispute");
        await ctx.reviewer.payer.respondToOnNotice({
          disputeId,
          response: "Payer acknowledges open negotiation notice and disputes the billed charges.",
          initialOfferAmount: "1800.00",
        });
        const counter = await ctx.reviewer.payer.submitCounterOffer({
          disputeId,
          amount: "2100.00",
          rationale: "Counter based on in-network rate benchmarking for CPT 99285.",
        });
        ctx.assert(counter.offerId, "counter-offer row written");
        const accepted = await ctx.reviewer.payer.acceptOffer({ disputeId, offerId: counter.offerId });
        ctx.assertEqual(accepted.status, "determination_issued", "acceptance issues determination");
        const intent = await ctx.reviewer.payer.recordPaymentIntent({
          disputeId,
          idempotencyKey: ctx.idem("j21-pay"),
          reason: "Payment intent for determination per PHSA 2799A-1(c)(6)",
        });
        ctx.assertEqual(intent.status, "requested", "transfer draft created in requested status");
        const replay = await ctx.reviewer.payer.recordPaymentIntent({
          disputeId,
          idempotencyKey: ctx.idem("j21-pay"),
          reason: "replay",
        });
        ctx.assert(replay.replay === true, "idempotent replay returns existing draft");
        // Negative: provider user is not payer-linked to this dispute.
        await expectTrpcError(ctx, ctx.provider.payer.submitCounterOffer({
          disputeId, amount: "999.00", rationale: "unauthorized counter attempt by non-payer user",
        }), "FORBIDDEN", "non-payer counter-offer rejected");
        // Verify timeline re-read.
        const rows = await ctx.sql`
          SELECT "eventType" FROM dispute_events WHERE "disputeId" = ${disputeId}
        `;
        const types = rows.map(r => r.eventType as string);
        for (const t of ["payer_invited", "payer_on_response", "payer_counter_offer", "payer_payment_intent"]) {
          ctx.assert(types.includes(t), `timeline contains ${t}`, { types });
        }
        return { evidence: { determinationAmount: accepted.determinationAmount, transferId: intent.transferId } };
      },
    },
  ],
};

export const j22: Journey = {
  id: "J22",
  title: "Patient: token issue → redacted view → upload → PPDR intake",
  actor: "patient",
  description:
    "patientPortal.issueViewToken → public viewCase (redacted, single-use) → public uploadDocument → issuePpdrIntakeToken → public ppdrIntake creating an INITIATED gfe-ppdr FSM case.",
  steps: [
    {
      name: "issue-view-upload",
      async run(ctx) {
        const d = await createJourneyDispute(ctx, "j22");
        (ctx as unknown as { _d: string })._d = d.id;
        const issued = await ctx.provider.patientPortal.issueViewToken({
          disputeId: d.id,
          patientName: `Journey Patient ${ctx.runId}`,
          email: "patient@journeys.local",
        });
        ctx.assert(issued.token.length >= 32, "opaque token issued");
        // Public call (no login required) — redacted fields only.
        const view = await ctx.patient.patientPortal.viewCase({ token: issued.token });
        ctx.assertEqual(view.dispute.referenceNumber, d.referenceNumber, "reference visible");
        ctx.assert(view.dispute.billedAmount, "amount visible");
        ctx.assert(!("notes" in view.dispute), "internal notes redacted");
        // Single-use: second view rejected.
        await expectTrpcError(ctx, ctx.patient.patientPortal.viewCase({ token: issued.token }), "UNAUTHORIZED", "single-use token replay rejected");
        // Upload still allowed while the link is unexpired.
        const upload = await ctx.patient.patientPortal.uploadDocument({
          token: issued.token,
          documentType: "patient_statement",
          fileName: "patient-statement.pdf",
          mimeType: "application/pdf",
          description: "Patient-provided billing statement",
        });
        ctx.assert(upload.documentId, "patient document persisted");
        const docs = await ctx.sql`
          SELECT "uploadedBy" FROM dispute_documents WHERE "disputeId" = ${d.id} AND id = ${upload.documentId}
        `;
        ctx.assert(String(docs[0]?.uploadedBy ?? "").startsWith("patient:"), "uploader marked patient");
        return { evidence: { documentId: upload.documentId } };
      },
    },
    {
      name: "ppdr-intake",
      async run(ctx) {
        const issued = await ctx.provider.patientPortal.issuePpdrIntakeToken({
          patientName: `Journey Patient ${ctx.runId}`,
        });
        // Ineligible first: excess < $400 → BAD_REQUEST from the engine.
        await expectTrpcError(ctx, ctx.patient.patientPortal.ppdrIntake({
          token: issued.token,
          gfeTotalUsd: 1000,
          billedTotalUsd: 1200,
          billedAt: new Date(Date.now() - 10 * 86400_000).toISOString(),
          insuranceBilled: false,
        }), "BAD_REQUEST", "sub-threshold PPDR intake rejected");
        const intake = await ctx.patient.patientPortal.ppdrIntake({
          token: issued.token,
          gfeTotalUsd: 1000,
          billedTotalUsd: 2200,
          billedAt: new Date(Date.now() - 10 * 86400_000).toISOString(),
          insuranceBilled: false,
        });
        ctx.assertEqual(intake.state, "INITIATED", "PPDR case initiated");
        ctx.assert(intake.excessUsd >= 400, "excess computed");
        // Negative: garbage token rejected.
        await expectTrpcError(ctx, ctx.patient.patientPortal.ppdrIntake({
          token: "bogus", gfeTotalUsd: 1000, billedTotalUsd: 2000,
          billedAt: new Date().toISOString(), insuranceBilled: false,
        }), "UNAUTHORIZED", "bogus intake token rejected");
        return { evidence: { ppdrDisputeId: intake.ppdrDisputeId, state: intake.state } };
      },
    },
  ],
};

export const j23: Journey = {
  id: "J23",
  title: "IDRE: propose → decline → re-propose → COI reject → accept → determination",
  actor: "idre-admin",
  description:
    "idre.proposeAssignment → reviewer declines (notification) → re-propose → COI-incomplete accept rejected → COI accept → prohibited-basis rationale rejected → qpaConsidered=false rejected → valid determination written.",
  steps: [
    {
      name: "assign-decline-reassign",
      async run(ctx) {
        const d = await createJourneyDispute(ctx, "j23");
        (ctx as unknown as { _d: string })._d = d.id;
        await ctx.admin.arbitrators.seedDemoEntities({ demo: true });
        const entities = await ctx.provider.arbitrators.list({});
        ctx.assert(entities.length >= 1, "demo IDR entities seeded");
        (ctx as unknown as { _e: string })._e = entities[0].id;
        const a1 = await ctx.provider.idre.proposeAssignment({
          disputeId: d.id,
          idrEntityId: entities[0].id,
          arbitratorUserId: FIXTURE_USERS.reviewer,
        });
        const queue = await ctx.reviewer.idre.listQueue();
        ctx.assert(queue.some(q => q.assignmentId === a1.assignmentId), "assignment in arbitrator queue");
        await ctx.reviewer.idre.declineAssignment({ assignmentId: a1.assignmentId, reason: "Caseload capacity reached" });
        const providerNotifs = await ctx.provider.notifications.list({ unreadOnly: true });
        ctx.assert(
          providerNotifs.some(n => n.notificationType === "idre_assignment_declined" && n.disputeId === d.id),
          "decline notified the initiator"
        );
        const a2 = await ctx.provider.idre.proposeAssignment({
          disputeId: d.id,
          idrEntityId: entities[0].id,
          arbitratorUserId: FIXTURE_USERS.reviewer,
        });
        (ctx as unknown as { _a: string })._a = a2.assignmentId;
        return { evidence: { declined: a1.assignmentId, reAssigned: a2.assignmentId } };
      },
    },
    {
      name: "coi-gate-and-determination",
      async run(ctx) {
        const assignmentId = (ctx as unknown as { _a: string })._a;
        // COI gate: any false flag rejects.
        await expectTrpcError(ctx, ctx.reviewer.idre.acceptAssignment({
          assignmentId,
          coiAttestation: { noFinancialInterest: false, noPriorEngagement: true, noPartyAffiliation: true, attestedBy: "Reviewer" },
        }), "BAD_REQUEST", "incomplete COI attestation rejected");
        // Determination before acceptance rejected.
        await expectTrpcError(ctx, ctx.reviewer.idre.writeDetermination({
          assignmentId, amountCents: 260000, qpaConsidered: true,
          rationale: "This rationale is long enough to pass the length gate but the assignment is not yet accepted by the arbitrator.",
        }), "BAD_REQUEST", "determination before accept rejected");
        await ctx.reviewer.idre.acceptAssignment({
          assignmentId,
          coiAttestation: { noFinancialInterest: true, noPriorEngagement: true, noPartyAffiliation: true, attestedBy: `Reviewer ${ctx.runId}` },
        });
        // Prohibited basis: Medicare as stated basis rejected.
        await expectTrpcError(ctx, ctx.reviewer.idre.writeDetermination({
          assignmentId, amountCents: 260000, qpaConsidered: true,
          rationale: "Determination based on a percentage of the Medicare rate for this service, which the undersigned arbitrator deems most appropriate for this case.",
        }), "BAD_REQUEST", "Medicare-based rationale rejected");
        // qpaConsidered=false rejected.
        await expectTrpcError(ctx, ctx.reviewer.idre.writeDetermination({
          assignmentId, amountCents: 260000, qpaConsidered: false,
          rationale: "The qualifying payment amount was reviewed but the arbitrator declines to confirm it was considered as the presumed-reasonable basis for this determination.",
        }), "BAD_REQUEST", "qpaConsidered=false rejected");
        const det = await ctx.reviewer.idre.writeDetermination({
          assignmentId, amountCents: 260000, qpaConsidered: true,
          winner: "initiating_party",
          rationale: "After reviewing the qualifying payment amount and the credible circumstances submitted by both parties, the initiating party's offer most closely reflects the market-based rate for this service in this geography.",
        });
        ctx.assertEqual(det.status, "determination_issued", "determination issued");
        ctx.assertEqual(det.determinationAmount, "2600.00", "determination amount persisted");
        const rows = await ctx.sql`
          SELECT "determinationWinner", "idrEntityId" FROM disputes WHERE id = ${det.disputeId}
        `;
        ctx.assertEqual(rows[0]?.determinationWinner, "initiating_party", "winner persisted");
        return { evidence: { determinationAmount: det.determinationAmount } };
      },
    },
  ],
};

export const j24: Journey = {
  id: "J24",
  title: "Orgs: create → membership → switch context → org-scoped dispute list",
  actor: "provider",
  description:
    "orgs.create (creator=owner) → addMember → switchContext → orgs.listDisputes returns member-created disputes; non-member access rejected.",
  steps: [
    {
      name: "org-lifecycle",
      async run(ctx) {
        const created = await ctx.provider.orgs.create({
          name: `Journey Org ${ctx.runId}`,
          type: "provider",
        });
        const mine = await ctx.provider.orgs.listMine();
        ctx.assert(mine.some(o => o.orgId === created.orgId && o.role === "owner"), "creator is owner");
        await ctx.provider.orgs.addMember({ orgId: created.orgId, userId: FIXTURE_USERS.reviewer, role: "staff" });
        const members = await ctx.provider.orgs.listMembers({ orgId: created.orgId });
        ctx.assertEqual(members.length, 2, "membership persisted");
        const ctxSwitch = await ctx.provider.orgs.switchContext({ orgId: created.orgId });
        ctx.assertEqual(ctxSwitch.role, "owner", "context switch returns role");
        const d = await createJourneyDispute(ctx, "j24");
        const orgDisputes = await ctx.provider.orgs.listDisputes({ orgId: created.orgId });
        ctx.assert(orgDisputes.some(x => x.id === d.id), "org dispute list contains member-created dispute");
        // Negative: patient user is not a member.
        await expectTrpcError(ctx, ctx.patient.orgs.listDisputes({ orgId: created.orgId }), "FORBIDDEN", "non-member org access rejected");
        return { evidence: { orgId: created.orgId, members: members.length } };
      },
    },
  ],
};
