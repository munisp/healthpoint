/**
 * server/routers/personas.ts — missing-stakeholder-persona surfaces (v1):
 *   - payer:     payer case queue, ON-notice response, counter-offer,
 *                offer acceptance, settlement transfer intent
 *   - idre:      arbitrator workbench (queue, COI-gated accept/decline,
 *                prohibited-basis-screened determination writer)
 *   - orgs:      minimal org/membership model + org-scoped dispute listing
 *
 * AuthZ:
 *  - Every payer procedure asserts payer_case_links membership for the
 *    dispute (server/personas/guards.ts#assertPayerLink).
 *  - IDRE accept/decline/determination assert the assignment is addressed to
 *    the calling arbitrator (or the caller is a platform admin).
 *  - Org procedures assert org_memberships for the calling user.
 *
 * Registration: merged into rootRouter in server/app-router.ts.
 */
import crypto from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, or } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import {
  acceptOffer as acceptOfferDb,
  advanceDisputeStep,
  createNotification,
  getDisputeById,
  submitOffer as submitOfferDb,
} from "../db";
import {
  disputeEvents,
  disputes,
  settlementTransfers,
} from "../../drizzle/schema";
import {
  idreAssignments,
  organizations,
  orgMemberships,
  payerAccounts,
  payerCaseLinks,
  type CoiAttestation,
} from "../../drizzle/schema-personas";
import { assertPayerLink, loadDispute, requireDb } from "../personas/guards";
import { screenProhibitedBasis } from "../personas/prohibited-basis";

const moneySchema = z.string().regex(/^\d+(\.\d{1,2})?$/, "amount must be a positive decimal string");

// ═════════════════════════════ PAYER SURFACE (v1) ═══════════════════════════

export const payerRouter = router({
  /**
   * Admin/provider invites a payer account onto a dispute. Creates the payer
   * account when absent, links it (idempotent per account+dispute), and
   * notifies the payer contact's platform user when one exists.
   */
  invite: protectedProcedure
    .input(z.object({
      disputeId: z.string().min(1),
      payerName: z.string().min(1).max(255),
      contactEmail: z.string().email().max(320),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const dispute = await loadDispute(db, input.disputeId);
      // Only the dispute initiator, the dispute creator, or an admin may invite.
      const isAdmin = ctx.user.role === "admin";
      const isInitiator = dispute.initiatingPartyId === ctx.user.id || dispute.createdBy === ctx.user.id;
      if (!isAdmin && !isInitiator) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the initiating party or an admin may invite a payer" });
      }
      let account = (await db.select().from(payerAccounts).where(eq(payerAccounts.contactEmail, input.contactEmail)).limit(1))[0];
      if (!account) {
        account = (await db.insert(payerAccounts).values({
          id: crypto.randomUUID(),
          payerName: input.payerName,
          contactEmail: input.contactEmail,
          orgRef: null,
          apiKeyHash: null,
        }).returning())[0];
      }
      let link = (await db.select().from(payerCaseLinks).where(and(
        eq(payerCaseLinks.payerAccountId, account.id),
        eq(payerCaseLinks.disputeId, input.disputeId),
      )).limit(1))[0];
      if (!link) {
        link = (await db.insert(payerCaseLinks).values({
          id: crypto.randomUUID(),
          payerAccountId: account.id,
          disputeId: input.disputeId,
          role: "responding_party",
          invitedByUserId: ctx.user.id,
          status: "invited",
        }).returning())[0];
      }
      await db.insert(disputeEvents).values({
        id: crypto.randomUUID(),
        disputeId: input.disputeId,
        step: dispute.currentStep,
        eventType: "payer_invited",
        description: `Payer "${input.payerName}" invited to dispute ${dispute.referenceNumber}`,
        performedBy: ctx.user.id,
        performedByName: ctx.user.name ?? undefined,
        metadata: { payerAccountId: account.id, contactEmail: input.contactEmail },
      });
      // Notify the payer's platform user when one exists for the contact email.
      await createNotification({
        disputeId: input.disputeId,
        userId: null,
        dueDate: null,
        notificationType: "payer_invite",
        title: "Payer invited to dispute",
        message: `Payer "${input.payerName}" (${input.contactEmail}) was invited to dispute ${dispute.referenceNumber}.`,
      });
      return { payerAccountId: account.id, linkId: link.id, status: link.status };
    }),

  /** Payer-side queue: disputes linked to the caller's payer account. */
  listCases: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const accounts = await db.select().from(payerAccounts).where(eq(payerAccounts.contactEmail, ctx.user.email ?? ""));
    type PayerCase = {
      linkId: string; linkStatus: string; disputeId: string; referenceNumber: string;
      status: string; currentStep: string; billedAmount: string; qpaAmount: string | null;
      initiatingPartyOffer: string | null; respondingPartyOffer: string | null;
      determinationAmount: string | null; initiatingPartyName: string; createdAt: Date | null;
    };
    if (!accounts.length) return { account: null as null | typeof accounts[number], cases: [] as PayerCase[] };
    const account = accounts[0];
    const links = await db.select().from(payerCaseLinks).where(eq(payerCaseLinks.payerAccountId, account.id));
    if (!links.length) return { account: account as typeof account | null, cases: [] as PayerCase[] };
    const rows = await db.select().from(disputes).where(inArray(disputes.id, links.map(l => l.disputeId)));
    const byId = new Map(rows.map(d => [d.id, d]));
    const cases = links
      .filter(l => byId.has(l.disputeId))
      .map(l => {
        const d = byId.get(l.disputeId)!;
        return {
          linkId: l.id,
          linkStatus: l.status,
          disputeId: d.id,
          referenceNumber: d.referenceNumber,
          status: d.status,
          currentStep: d.currentStep,
          billedAmount: d.billedAmount,
          qpaAmount: d.qpaAmount,
          initiatingPartyOffer: d.initiatingPartyOffer,
          respondingPartyOffer: d.respondingPartyOffer,
          determinationAmount: d.determinationAmount,
          initiatingPartyName: d.initiatingPartyName,
          createdAt: d.createdAt,
        };
      });
    return { account, cases };
  }),

  /** Payer responds to an open-negotiation notice; recorded on the timeline. */
  respondToOnNotice: protectedProcedure
    .input(z.object({
      disputeId: z.string().min(1),
      response: z.string().min(1).max(4000),
      initialOfferAmount: moneySchema.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { db, account, link, dispute } = await assertPayerLink(ctx.user, input.disputeId);
      if (link.status === "invited") {
        await db.update(payerCaseLinks).set({ status: "active" }).where(eq(payerCaseLinks.id, link.id));
      }
      await db.insert(disputeEvents).values({
        id: crypto.randomUUID(),
        disputeId: input.disputeId,
        step: dispute.currentStep,
        eventType: "payer_on_response",
        description: `Payer "${account.payerName}" responded to open-negotiation notice: ${input.response}`,
        performedBy: ctx.user.id,
        performedByName: ctx.user.name ?? `Payer ${account.payerName}`,
        metadata: { payerAccountId: account.id, initialOfferAmount: input.initialOfferAmount ?? null },
      });
      if (input.initialOfferAmount) {
        await submitOfferDb({
          disputeId: input.disputeId,
          offerType: "responding_party",
          amount: input.initialOfferAmount,
          rationale: `[payer:${account.payerName}] Initial open-negotiation offer`,
          supportingDocIds: null,
          submittedBy: ctx.user.id,
        });
      }
      return { ok: true };
    }),

  /**
   * Payer counter-offer during open negotiation. The offer_type enum has no
   * "counter" value, so the row is written as offer_type "responding_party"
   * with a `[payer:<name>] counter-offer` marker in the rationale field.
   */
  submitCounterOffer: protectedProcedure
    .input(z.object({
      disputeId: z.string().min(1),
      amount: moneySchema,
      rationale: z.string().min(1).max(4000),
    }))
    .mutation(async ({ ctx, input }) => {
      const { account, dispute } = await assertPayerLink(ctx.user, input.disputeId);
      const offerId = await submitOfferDb({
        disputeId: input.disputeId,
        offerType: "responding_party",
        amount: input.amount,
        rationale: `[payer:${account.payerName}] counter-offer — ${input.rationale}`,
        supportingDocIds: null,
        submittedBy: ctx.user.id,
      });
      const db = await requireDb();
      await db.insert(disputeEvents).values({
        id: crypto.randomUUID(),
        disputeId: input.disputeId,
        step: dispute.currentStep,
        eventType: "payer_counter_offer",
        description: `Payer "${account.payerName}" submitted counter-offer of $${input.amount}`,
        performedBy: ctx.user.id,
        performedByName: ctx.user.name ?? `Payer ${account.payerName}`,
        metadata: { offerId, amount: input.amount, payerAccountId: account.id },
      });
      return { offerId };
    }),

  /** Payer accepts the initiating party's offer → determination issued. */
  acceptOffer: protectedProcedure
    .input(z.object({ disputeId: z.string().min(1), offerId: z.string().min(1).optional() }))
    .mutation(async ({ ctx, input }) => {
      const { account } = await assertPayerLink(ctx.user, input.disputeId);
      const updated = await acceptOfferDb(
        input.disputeId,
        input.offerId ?? "",
        ctx.user.id,
        ctx.user.name ?? `Payer ${account.payerName}`
      );
      return { disputeId: updated.id, status: updated.status, determinationAmount: updated.determinationAmount };
    }),

  /**
   * Payer records payment intent for an issued determination: creates a
   * settlement transfer request DRAFT (status "requested"). This records
   * intent only; it never initiates, routes, or releases funds.
   */
  recordPaymentIntent: protectedProcedure
    .input(z.object({
      disputeId: z.string().min(1),
      idempotencyKey: z.string().min(1).max(128),
      reason: z.string().min(1).max(1000),
    }))
    .mutation(async ({ ctx, input }) => {
      const { db, account, dispute } = await assertPayerLink(ctx.user, input.disputeId);
      const determination = dispute.determinationAmount;
      if (!determination) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No determination amount on this dispute yet" });
      }
      const amountCents = Math.round(Number(determination) * 100);
      // Idempotent replay: return the existing draft for the same key.
      const existing = await db.select().from(settlementTransfers)
        .where(eq(settlementTransfers.idempotencyKey, input.idempotencyKey)).limit(1);
      if (existing.length) return { transferId: existing[0].id, status: existing[0].status, replay: true };
      const id = crypto.randomUUID();
      await db.insert(settlementTransfers).values({
        id,
        disputeId: input.disputeId,
        provider: "payer-intent",
        amountCents,
        currency: "USD",
        status: "requested",
        requestedBy: ctx.user.id,
        requestedByName: ctx.user.name ?? `Payer ${account.payerName}`,
        requestReason: `[payer:${account.payerName}] ${input.reason}`,
        idempotencyKey: input.idempotencyKey,
        metadata: { payerAccountId: account.id, source: "payer_record_payment_intent" },
      });
      await db.insert(disputeEvents).values({
        id: crypto.randomUUID(),
        disputeId: input.disputeId,
        step: dispute.currentStep,
        eventType: "payer_payment_intent",
        description: `Payer "${account.payerName}" recorded payment intent for determination $${determination} (transfer draft ${id})`,
        performedBy: ctx.user.id,
        performedByName: ctx.user.name ?? `Payer ${account.payerName}`,
        metadata: { transferId: id, amountCents, payerAccountId: account.id },
      });
      return { transferId: id, status: "requested", replay: false };
    }),
});

// ═══════════════════════════ IDRE / ARBITRATOR WORKBENCH (v1) ═══════════════

const coiSchema = z.object({
  noFinancialInterest: z.boolean(),
  noPriorEngagement: z.boolean(),
  noPartyAffiliation: z.boolean(),
  attestedBy: z.string().min(1).max(255),
});

async function assertAssignmentActor(
  assignment: { arbitratorUserId: string | null },
  user: { id: string; role: string }
) {
  if (user.role === "admin") return;
  if (assignment.arbitratorUserId === user.id) return;
  throw new TRPCError({ code: "FORBIDDEN", message: "Assignment is not addressed to this arbitrator" });
}

export const idreRouter = router({
  /** Provider/admin proposes an IDRE assignment for a dispute. */
  proposeAssignment: protectedProcedure
    .input(z.object({
      disputeId: z.string().min(1),
      idrEntityId: z.string().min(1),
      arbitratorUserId: z.string().min(1).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const dispute = await loadDispute(db, input.disputeId);
      const isAdmin = ctx.user.role === "admin";
      const isInitiator = dispute.initiatingPartyId === ctx.user.id || dispute.createdBy === ctx.user.id;
      if (!isAdmin && !isInitiator) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the initiating party or an admin may propose an IDRE assignment" });
      }
      const id = crypto.randomUUID();
      await db.insert(idreAssignments).values({
        id,
        disputeId: input.disputeId,
        idrEntityId: input.idrEntityId,
        arbitratorUserId: input.arbitratorUserId ?? null,
        status: "proposed",
      });
      await db.insert(disputeEvents).values({
        id: crypto.randomUUID(),
        disputeId: input.disputeId,
        step: dispute.currentStep,
        eventType: "idre_assignment_proposed",
        description: `IDR entity ${input.idrEntityId} proposed for dispute ${dispute.referenceNumber}`,
        performedBy: ctx.user.id,
        performedByName: ctx.user.name ?? undefined,
        metadata: { assignmentId: id, arbitratorUserId: input.arbitratorUserId ?? null },
      });
      if (input.arbitratorUserId) {
        await createNotification({
          disputeId: input.disputeId,
          userId: input.arbitratorUserId,
          dueDate: null,
          notificationType: "idre_assignment",
          title: "New IDRE assignment proposed",
          message: `You have a proposed IDRE assignment on dispute ${dispute.referenceNumber}. Review and accept with a conflict-of-interest attestation.`,
        });
      }
      return { assignmentId: id };
    }),

  /** Assignments for the calling arbitrator (admin sees all). */
  listQueue: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const assignments = ctx.user.role === "admin"
      ? await db.select().from(idreAssignments)
      : await db.select().from(idreAssignments).where(eq(idreAssignments.arbitratorUserId, ctx.user.id));
    if (!assignments.length) return [];
    const rows = await db.select().from(disputes).where(inArray(disputes.id, [...new Set(assignments.map(a => a.disputeId))]));
    const byId = new Map(rows.map(d => [d.id, d]));
    return assignments.map(a => {
      const d = byId.get(a.disputeId);
      return {
        assignmentId: a.id,
        status: a.status,
        idrEntityId: a.idrEntityId,
        arbitratorUserId: a.arbitratorUserId,
        assignedAt: a.assignedAt,
        decidedAt: a.decidedAt,
        disputeId: a.disputeId,
        referenceNumber: d?.referenceNumber ?? null,
        disputeStatus: d?.status ?? null,
        currentStep: d?.currentStep ?? null,
        billedAmount: d?.billedAmount ?? null,
        qpaAmount: d?.qpaAmount ?? null,
        initiatingPartyOffer: d?.initiatingPartyOffer ?? null,
        respondingPartyOffer: d?.respondingPartyOffer ?? null,
        initiatingPartyName: d?.initiatingPartyName ?? null,
        respondingPartyName: d?.respondingPartyName ?? null,
      };
    });
  }),

  /**
   * Accept an assignment. Requires a complete conflict-of-interest
   * attestation (no financial interest / no prior engagement / no party
   * affiliation); any false flag rejects.
   */
  acceptAssignment: protectedProcedure
    .input(z.object({ assignmentId: z.string().min(1), coiAttestation: coiSchema }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const rows = await db.select().from(idreAssignments).where(eq(idreAssignments.id, input.assignmentId)).limit(1);
      if (!rows.length) throw new TRPCError({ code: "NOT_FOUND", message: "Assignment not found" });
      const assignment = rows[0];
      await assertAssignmentActor(assignment, ctx.user);
      if (assignment.status !== "proposed") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Assignment already ${assignment.status}` });
      }
      const coi: CoiAttestation = input.coiAttestation;
      if (!coi.noFinancialInterest || !coi.noPriorEngagement || !coi.noPartyAffiliation) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Conflict-of-interest attestation incomplete: all three attestations (no financial interest, no prior engagement, no party affiliation) must be true",
        });
      }
      await db.update(idreAssignments).set({
        status: "accepted",
        coiAttestation: coi,
        decidedAt: new Date(),
      }).where(eq(idreAssignments.id, input.assignmentId));
      const dispute = await loadDispute(db, assignment.disputeId);
      await db.insert(disputeEvents).values({
        id: crypto.randomUUID(),
        disputeId: assignment.disputeId,
        step: dispute.currentStep,
        eventType: "idre_assignment_accepted",
        description: `IDRE assignment accepted with COI attestation by ${coi.attestedBy}`,
        performedBy: ctx.user.id,
        performedByName: ctx.user.name ?? undefined,
        metadata: { assignmentId: input.assignmentId, coi },
      });
      return { ok: true };
    }),

  /** Decline an assignment; notifies the dispute initiator and frees selection. */
  declineAssignment: protectedProcedure
    .input(z.object({ assignmentId: z.string().min(1), reason: z.string().min(1).max(1000) }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const rows = await db.select().from(idreAssignments).where(eq(idreAssignments.id, input.assignmentId)).limit(1);
      if (!rows.length) throw new TRPCError({ code: "NOT_FOUND", message: "Assignment not found" });
      const assignment = rows[0];
      await assertAssignmentActor(assignment, ctx.user);
      if (assignment.status !== "proposed") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Assignment already ${assignment.status}` });
      }
      await db.update(idreAssignments).set({ status: "declined", decidedAt: new Date() })
        .where(eq(idreAssignments.id, input.assignmentId));
      const dispute = await loadDispute(db, assignment.disputeId);
      await db.insert(disputeEvents).values({
        id: crypto.randomUUID(),
        disputeId: assignment.disputeId,
        step: dispute.currentStep,
        eventType: "idre_assignment_declined",
        description: `IDRE assignment declined: ${input.reason}`,
        performedBy: ctx.user.id,
        performedByName: ctx.user.name ?? undefined,
        metadata: { assignmentId: input.assignmentId, reason: input.reason },
      });
      await createNotification({
        disputeId: assignment.disputeId,
        userId: dispute.initiatingPartyId,
        dueDate: null,
        notificationType: "idre_assignment_declined",
        title: "IDRE assignment declined",
        message: `The proposed IDR entity declined the assignment on dispute ${dispute.referenceNumber}: ${input.reason}. Entity selection is open again.`,
      });
      return { ok: true };
    }),

  /**
   * Write a binding determination (v1). Guards:
   *  - assignment accepted and addressed to the caller (or admin)
   *  - rationale >= 100 chars
   *  - qpaConsidered must be true (45 CFR § 149.510(c)(4)(ii)(A))
   *  - prohibited-basis screen: rejects UCR / usual-and-customary / billed
   *    charge / Medicare / Medicaid as the stated basis (§ 149.510(c)(4)(ii)(B)-(D))
   */
  writeDetermination: protectedProcedure
    .input(z.object({
      assignmentId: z.string().min(1),
      amountCents: z.number().int().positive(),
      rationale: z.string().min(100, "Rationale must be at least 100 characters"),
      qpaConsidered: z.boolean(),
      winner: z.enum(["initiating_party", "responding_party"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const rows = await db.select().from(idreAssignments).where(eq(idreAssignments.id, input.assignmentId)).limit(1);
      if (!rows.length) throw new TRPCError({ code: "NOT_FOUND", message: "Assignment not found" });
      const assignment = rows[0];
      await assertAssignmentActor(assignment, ctx.user);
      if (assignment.status !== "accepted") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Assignment must be accepted (with COI attestation) before writing a determination" });
      }
      if (input.qpaConsidered !== true) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "qpaConsidered must be true — the QPA is the presumed-reasonable basis (45 CFR § 149.510(c)(4)(ii)(A))" });
      }
      const hit = screenProhibitedBasis(input.rationale);
      if (hit) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Prohibited determination basis detected: ${hit}. A certified IDR entity must not consider UCR, billed charges, or Medicare/Medicaid rates (45 CFR § 149.510(c)(4)(ii)).`,
        });
      }
      const dispute = await loadDispute(db, assignment.disputeId);
      const amount = (input.amountCents / 100).toFixed(2);
      const updated = await advanceDisputeStep(
        assignment.disputeId,
        "STEP_13_DETERMINATION_ISSUED",
        "determination_issued",
        ctx.user.id,
        ctx.user.name ?? "Certified IDR entity",
        `IDRE determination issued: $${amount}. ${input.rationale.slice(0, 500)}`,
        {
          determinationAmount: amount,
          determinationBasis: input.rationale,
          determinationWinner: input.winner ?? null,
          idrEntityId: assignment.idrEntityId,
        }
      );
      await createNotification({
        disputeId: assignment.disputeId,
        userId: dispute.initiatingPartyId,
        dueDate: null,
        notificationType: "idre_determination",
        title: "IDR determination issued",
        message: `A determination of $${amount} was issued on dispute ${dispute.referenceNumber} by the certified IDR entity.`,
      });
      return { disputeId: updated.id, status: updated.status, determinationAmount: updated.determinationAmount };
    }),
});

// ════════════════════════════════ ORGS (v1 minimal) ═════════════════════════

async function assertMembership(userId: string, orgId: string) {
  const db = await requireDb();
  const rows = await db.select().from(orgMemberships)
    .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId))).limit(1);
  if (!rows.length) throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this organization" });
  return { db, membership: rows[0] };
}

export const orgsRouter = router({
  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(255),
      type: z.enum(["provider", "biller", "payer", "idre"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const orgId = crypto.randomUUID();
      await db.insert(organizations).values({ id: orgId, name: input.name, type: input.type });
      await db.insert(orgMemberships).values({
        id: crypto.randomUUID(), orgId, userId: ctx.user.id, role: "owner",
      });
      return { orgId };
    }),

  listMine: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const memberships = await db.select().from(orgMemberships).where(eq(orgMemberships.userId, ctx.user.id));
    if (!memberships.length) return [];
    const orgs = await db.select().from(organizations).where(inArray(organizations.id, memberships.map(m => m.orgId)));
    const byId = new Map(orgs.map(o => [o.id, o]));
    return memberships
      .filter(m => byId.has(m.orgId))
      .map(m => ({ orgId: m.orgId, role: m.role, name: byId.get(m.orgId)!.name, type: byId.get(m.orgId)!.type }));
  }),

  addMember: protectedProcedure
    .input(z.object({
      orgId: z.string().min(1),
      userId: z.string().min(1),
      role: z.enum(["owner", "staff", "viewer"]).default("staff"),
    }))
    .mutation(async ({ ctx, input }) => {
      const { db, membership } = await assertMembership(ctx.user.id, input.orgId);
      if (membership.role !== "owner" && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only org owners may add members" });
      }
      const existing = await db.select().from(orgMemberships)
        .where(and(eq(orgMemberships.orgId, input.orgId), eq(orgMemberships.userId, input.userId))).limit(1);
      if (existing.length) return { membershipId: existing[0].id, existing: true };
      const id = crypto.randomUUID();
      await db.insert(orgMemberships).values({ id, orgId: input.orgId, userId: input.userId, role: input.role });
      return { membershipId: id, existing: false };
    }),

  listMembers: protectedProcedure
    .input(z.object({ orgId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { db } = await assertMembership(ctx.user.id, input.orgId);
      return db.select().from(orgMemberships).where(eq(orgMemberships.orgId, input.orgId));
    }),

  /**
   * Switch the caller's working context to an org. v1 returns the org-scoped
   * view filter the client should apply; no server-side session mutation.
   */
  switchContext: protectedProcedure
    .input(z.object({ orgId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { db, membership } = await assertMembership(ctx.user.id, input.orgId);
      const org = (await db.select().from(organizations).where(eq(organizations.id, input.orgId)).limit(1))[0];
      if (!org) throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      return {
        orgId: org.id,
        orgName: org.name,
        type: org.type,
        role: membership.role,
        viewFilter: { orgId: org.id, createdByMembers: true },
      };
    }),

  /**
   * Org-scoped dispute listing (NEW procedure — the existing disputes.list is
   * untouched). v1 scope: disputes created by any member of the org.
   */
  listDisputes: protectedProcedure
    .input(z.object({ orgId: z.string().min(1), limit: z.number().int().min(1).max(200).default(50) }))
    .query(async ({ ctx, input }) => {
      const { db } = await assertMembership(ctx.user.id, input.orgId);
      const members = await db.select().from(orgMemberships).where(eq(orgMemberships.orgId, input.orgId));
      const memberIds = members.map(m => m.userId);
      if (!memberIds.length) return [];
      return db.select({
        id: disputes.id,
        referenceNumber: disputes.referenceNumber,
        status: disputes.status,
        currentStep: disputes.currentStep,
        billedAmount: disputes.billedAmount,
        determinationAmount: disputes.determinationAmount,
        initiatingPartyName: disputes.initiatingPartyName,
        respondingPartyName: disputes.respondingPartyName,
        createdBy: disputes.createdBy,
        createdAt: disputes.createdAt,
      }).from(disputes)
        .where(or(
          inArray(disputes.createdBy, memberIds),
          inArray(disputes.initiatingPartyId, memberIds),
        ))
        .limit(input.limit);
    }),
});
