/**
 * server/routers/idr-compliance.ts
 * NSA / Federal IDR compliance router: statutory deadline engine surface,
 * fee management, attestations, and federal reporting exports.
 *
 * REGISTRATION: this router is NOT yet merged into the app router — see
 * server/routers/REGISTER-idr-compliance.md for the one-line registration
 * (server/routers.ts is owned by another workstream and must not be edited
 * here).
 *
 * Regulatory notes:
 *   - Deadline day-counts come from getDeadlinePolicy() (45 CFR § 149.510
 *     defaults, env-overridable; subject to rulemaking change).
 *   - Fee AMOUNTS never appear in this file; they come from the
 *     effective-dated idr_fee_schedules table (45 CFR § 149.510(d)).
 */

import crypto from "crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { disputeEvents, disputes } from "../../drizzle/schema";
import {
  idrAttestations,
  idrDeadlineEvents,
  idrFeeAssessments,
  idrFeeSchedules,
} from "../../drizzle/schema-idr-compliance";
import { assertAdminAccess, assertDisputeAccess } from "../authz";
import { computeIDRDeadlines, getDeadlinePolicy, type DisputeDeadlineAnchors } from "../idr/deadlines";
import {
  buildAdminFeeAssessments,
  buildEnvFeeSchedule,
  buildIdreFeeAssessment,
  selectActiveSchedule,
  assertFeeStatusTransition,
  type FeeScheduleLike,
} from "../idr/fees";
import {
  attestationText,
  planReAttestation,
  validateNewAttestation,
  type AttestationLike,
  type AttestationPartyRole,
  type AttestationType,
} from "../idr/attestations";
import {
  buildDeterminationRecord,
  buildVolumeSummary,
  volumeSummaryToCsv,
} from "../idr/federal-reporting";
import { emitComplianceEvent } from "../idr/compliance-events";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  return db;
}

async function loadDispute(db: Awaited<ReturnType<typeof requireDb>>, disputeId: string) {
  const rows = await db.select().from(disputes).where(eq(disputes.id, disputeId)).limit(1);
  if (!rows.length) throw new TRPCError({ code: "NOT_FOUND", message: "Dispute not found" });
  return rows[0];
}

/** First entry timestamp per workflow step (from the dispute_events timeline). */
async function stepEntryMap(db: Awaited<ReturnType<typeof requireDb>>, disputeId: string) {
  const events = await db
    .select({ step: disputeEvents.step, createdAt: disputeEvents.createdAt })
    .from(disputeEvents)
    .where(eq(disputeEvents.disputeId, disputeId))
    .orderBy(asc(disputeEvents.createdAt));
  const map: Record<string, Date> = {};
  for (const e of events) {
    if (e.createdAt && !map[e.step]) map[e.step] = e.createdAt;
  }
  return map;
}

const DEADLINE_ROWS: Array<{
  key: keyof ReturnType<typeof computeIDRDeadlines>;
  deadlineType: string;
  dayCountKey: "openNegotiationBusinessDays" | "idrInitiationWindowBusinessDays" | "idreSelectionBusinessDays" | "offerSubmissionBusinessDays" | "determinationBusinessDays" | "paymentCalendarDays";
  dayKind: "business" | "calendar";
  cfr: string;
}> = [
  { key: "openNegotiationEnd", deadlineType: "open_negotiation_end", dayCountKey: "openNegotiationBusinessDays", dayKind: "business", cfr: "45 CFR § 149.510(b)(1)" },
  { key: "idrInitiationDeadline", deadlineType: "idr_initiation_window_end", dayCountKey: "idrInitiationWindowBusinessDays", dayKind: "business", cfr: "45 CFR § 149.510(b)(2)(i)" },
  { key: "idreSelectionDeadline", deadlineType: "idre_selection", dayCountKey: "idreSelectionBusinessDays", dayKind: "business", cfr: "45 CFR § 149.510(c)(1)" },
  { key: "offerSubmissionDeadline", deadlineType: "offer_submission", dayCountKey: "offerSubmissionBusinessDays", dayKind: "business", cfr: "45 CFR § 149.510(c)(3)(i)" },
  { key: "determinationDeadline", deadlineType: "determination_due", dayCountKey: "determinationBusinessDays", dayKind: "business", cfr: "45 CFR § 149.510(c)(4)(ii)" },
  { key: "paymentDeadline", deadlineType: "payment_due", dayCountKey: "paymentCalendarDays", dayKind: "calendar", cfr: "PHSA § 2799A-1(c)(6)" },
];

export const idrComplianceRouter = router({
  // ── Statutory deadlines ────────────────────────────────────────────────────

  /** Compute the full statutory deadline set for a dispute and persist the ledger rows. */
  "deadlines.computeForDispute": protectedProcedure
    .input(z.object({ disputeId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertDisputeAccess(ctx.user.id, ctx.user.role, input.disputeId, "write");
      const db = await requireDb();
      const dispute = await loadDispute(db, input.disputeId);
      const steps = await stepEntryMap(db, input.disputeId);

      const anchors: DisputeDeadlineAnchors = {
        openNegotiationInitiatedAt: steps.STEP_01_OPEN_NEGOTIATION_INITIATED ?? dispute.createdAt ?? null,
        idrInitiatedAt: steps.STEP_04_IDR_INITIATED ?? null,
        idreSelectedAt: steps.STEP_07_IDR_ENTITY_SELECTED ?? null,
        determinationIssuedAt: steps.STEP_13_DETERMINATION_ISSUED ?? null,
      };
      const policy = getDeadlinePolicy();
      const computed = computeIDRDeadlines(anchors, policy);
      const now = new Date();

      const basisByType: Record<string, Date | null> = {
        open_negotiation_end: anchors.openNegotiationInitiatedAt,
        idr_initiation_window_end: computed.openNegotiationEnd,
        idre_selection: anchors.idrInitiatedAt,
        offer_submission: anchors.idreSelectedAt,
        determination_due: anchors.idreSelectedAt,
        payment_due: anchors.determinationIssuedAt ?? null,
      };

      for (const row of DEADLINE_ROWS) {
        const deadline = computed[row.key];
        if (!deadline) continue;
        await db
          .insert(idrDeadlineEvents)
          .values({
            id: crypto.randomUUID(),
            disputeId: input.disputeId,
            deadlineType: row.deadlineType,
            basisDate: basisByType[row.deadlineType],
            computedDeadline: deadline,
            dayCount: policy[row.dayCountKey],
            dayKind: row.dayKind,
            cfrReference: row.cfr,
            status: "open",
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [idrDeadlineEvents.disputeId, idrDeadlineEvents.deadlineType],
            set: {
              basisDate: basisByType[row.deadlineType],
              computedDeadline: deadline,
              dayCount: policy[row.dayCountKey],
              cfrReference: row.cfr,
              updatedAt: now,
            },
          });
      }

      return { disputeId: input.disputeId, anchors, computed, policy };
    }),

  /** List the persisted deadline ledger rows for a dispute. */
  "deadlines.listForDispute": protectedProcedure
    .input(z.object({ disputeId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertDisputeAccess(ctx.user.id, ctx.user.role, input.disputeId, "read");
      const db = await requireDb();
      return db
        .select()
        .from(idrDeadlineEvents)
        .where(eq(idrDeadlineEvents.disputeId, input.disputeId))
        .orderBy(asc(idrDeadlineEvents.computedDeadline));
    }),

  /** Mark a statutory deadline obligation satisfied (e.g. offer submitted in time). */
  "deadlines.markMet": protectedProcedure
    .input(z.object({ disputeId: z.string().min(1), deadlineType: z.string().min(1), note: z.string().max(2000).optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertDisputeAccess(ctx.user.id, ctx.user.role, input.disputeId, "write");
      const db = await requireDb();
      const now = new Date();
      const updated = await db
        .update(idrDeadlineEvents)
        .set({ status: "met", metAt: now, updatedAt: now })
        .where(and(
          eq(idrDeadlineEvents.disputeId, input.disputeId),
          eq(idrDeadlineEvents.deadlineType, input.deadlineType),
          eq(idrDeadlineEvents.status, "open")
        ))
        .returning({ id: idrDeadlineEvents.id });
      if (!updated.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No open deadline of that type for this dispute" });
      }
      await emitComplianceEvent({
        eventType: "deadline.warning", // reused channel: resolution recorded in audit trail
        aggregateId: input.disputeId,
        aggregateType: "dispute",
        topic: "idr.audit",
        payload: { action: "deadline_met", deadlineType: input.deadlineType, note: input.note ?? null },
        userId: ctx.user.id,
      });
      return { ok: true, deadlineType: input.deadlineType, metAt: now.toISOString() };
    }),

  // ── Fee management (45 CFR § 149.510(d)) ───────────────────────────────────

  "fees.listSchedules": protectedProcedure.query(async () => {
    const db = await requireDb();
    return db.select().from(idrFeeSchedules).orderBy(asc(idrFeeSchedules.effectiveFrom));
  }),

  /** Admin: create an effective-dated fee schedule (amounts in integer cents). */
  "fees.createSchedule": protectedProcedure
    .input(z.object({
      effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      adminFeeCents: z.number().int().nonnegative(),
      idreFeeSingleMinCents: z.number().int().nonnegative().optional(),
      idreFeeSingleMaxCents: z.number().int().nonnegative().optional(),
      idreFeeBatchedMinCents: z.number().int().nonnegative().optional(),
      idreFeeBatchedMaxCents: z.number().int().nonnegative().optional(),
      batchingMaxLineItems: z.number().int().positive().optional(),
      currency: z.string().length(3).default("USD"),
      source: z.string().max(255).optional(),
      notes: z.string().max(4000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      assertAdminAccess(ctx.user.role, "manage IDR fee schedules");
      const db = await requireDb();
      const id = crypto.randomUUID();
      await db.insert(idrFeeSchedules).values({
        id,
        effectiveFrom: new Date(input.effectiveFrom + "T00:00:00Z"),
        effectiveTo: input.effectiveTo ? new Date(input.effectiveTo + "T00:00:00Z") : null,
        adminFeeCents: input.adminFeeCents,
        idreFeeSingleMinCents: input.idreFeeSingleMinCents ?? null,
        idreFeeSingleMaxCents: input.idreFeeSingleMaxCents ?? null,
        idreFeeBatchedMinCents: input.idreFeeBatchedMinCents ?? null,
        idreFeeBatchedMaxCents: input.idreFeeBatchedMaxCents ?? null,
        batchingMaxLineItems: input.batchingMaxLineItems ?? null,
        currency: input.currency,
        source: input.source ?? null,
        notes: input.notes ?? null,
        createdBy: ctx.user.id,
      });
      return { id };
    }),

  /** Admin: seed a fee schedule from IDR_* environment variables (no-op when unset). */
  "fees.seedFromEnv": protectedProcedure.mutation(async ({ ctx }) => {
    assertAdminAccess(ctx.user.role, "seed IDR fee schedule");
    const db = await requireDb();
    const seed = buildEnvFeeSchedule();
    if (!seed) return { seeded: false as const, reason: "IDR_ADMIN_FEE_CENTS not configured" };
    const id = crypto.randomUUID();
    await db.insert(idrFeeSchedules).values({ id, ...seed });
    return { seeded: true as const, id };
  }),

  /**
   * Assess the administrative fee on IDR initiation — one non-refundable fee
   * PER PARTY (45 CFR § 149.510(d)(1)). Idempotent: re-calling returns the
   * existing assessments without duplicating them.
   */
  "fees.assessOnIdrInitiation": protectedProcedure
    .input(z.object({ disputeId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertDisputeAccess(ctx.user.id, ctx.user.role, input.disputeId, "write");
      const db = await requireDb();
      const dispute = await loadDispute(db, input.disputeId);
      const schedules = await db.select().from(idrFeeSchedules);
      const active = selectActiveSchedule(schedules as FeeScheduleLike[], new Date());
      const result = buildAdminFeeAssessments(input.disputeId, active, {
        initiatingPartyId: dispute.initiatingPartyId,
        respondingPartyId: dispute.respondingPartyId,
      });
      if (!result.ok) {
        throw new TRPCError({
          code: result.reason === "missing_schedule" ? "PRECONDITION_FAILED" : "BAD_REQUEST",
          message:
            result.reason === "missing_schedule"
              ? "No active IDR fee schedule — configure idr_fee_schedules or IDR_ADMIN_FEE_CENTS (amounts are set by HHS guidance under 45 CFR § 149.510(d) and are never defaulted in code)"
              : "Both parties must be recorded on the dispute before fees are assessed",
        });
      }

      let inserted = 0;
      let existing = 0;
      const now = new Date();
      for (const line of result.lines) {
        const rows = await db
          .insert(idrFeeAssessments)
          .values({
            id: crypto.randomUUID(),
            disputeId: input.disputeId,
            feeScheduleId: result.scheduleId,
            feeType: line.feeType,
            partyRole: line.partyRole,
            partyId: line.partyRole === "initiating_party" ? dispute.initiatingPartyId : dispute.respondingPartyId,
            amountCents: line.amountCents,
            currency: line.currency,
            status: "assessed",
            assessedAt: now,
            assessedBy: ctx.user.id,
            idempotencyKey: line.idempotencyKey,
            updatedAt: now,
          })
          .onConflictDoNothing({ target: idrFeeAssessments.idempotencyKey })
          .returning({ id: idrFeeAssessments.id });
        if (rows.length) inserted++;
        else existing++;
      }

      if (inserted > 0) {
        await emitComplianceEvent({
          eventType: "fee.assessed",
          aggregateId: input.disputeId,
          aggregateType: "dispute",
          topic: "idr.payments",
          payload: {
            feeType: "administrative",
            scheduleId: result.scheduleId,
            lines: result.lines.map(l => ({ partyRole: l.partyRole, amountCents: l.amountCents, currency: l.currency })),
            cfrReference: "45 CFR § 149.510(d)(1)",
          },
          userId: ctx.user.id,
          idempotencyKey: `fee-assessed:${input.disputeId}:administrative`,
        });
      }
      return { ok: true as const, inserted, existing, scheduleId: result.scheduleId };
    }),

  /** Assess the certified IDRE fee to the non-prevailing party after determination. */
  "fees.assessIdreFee": protectedProcedure
    .input(z.object({
      disputeId: z.string().min(1),
      batched: z.boolean().default(false),
      amountCents: z.number().int().nonnegative(),
      nonPrevailingPartyRole: z.enum(["initiating_party", "responding_party"]),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertDisputeAccess(ctx.user.id, ctx.user.role, input.disputeId, "write");
      const db = await requireDb();
      await loadDispute(db, input.disputeId);
      const schedules = await db.select().from(idrFeeSchedules);
      const active = selectActiveSchedule(schedules as FeeScheduleLike[], new Date());
      const result = buildIdreFeeAssessment(input.disputeId, active, {
        batched: input.batched,
        amountCents: input.amountCents,
        nonPrevailingPartyRole: input.nonPrevailingPartyRole,
      });
      if (!result.ok) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `IDRE fee assessment failed: ${result.reason}` });
      }
      const line = result.lines[0];
      const rows = await db
        .insert(idrFeeAssessments)
        .values({
          id: crypto.randomUUID(),
          disputeId: input.disputeId,
          feeScheduleId: result.scheduleId,
          feeType: line.feeType,
          partyRole: line.partyRole,
          amountCents: line.amountCents,
          currency: line.currency,
          status: "assessed",
          assessedAt: new Date(),
          assessedBy: ctx.user.id,
          idempotencyKey: line.idempotencyKey,
          updatedAt: new Date(),
        })
        .onConflictDoNothing({ target: idrFeeAssessments.idempotencyKey })
        .returning({ id: idrFeeAssessments.id });
      return {
        ok: true as const,
        inserted: rows.length === 1,
        withinPublishedRange: result.withinRange ?? null,
        warning: result.withinRange === false ? "Amount is outside the schedule's published allowable range (45 CFR § 149.510(d)(2))" : null,
      };
    }),

  "fees.listAssessments": protectedProcedure
    .input(z.object({ disputeId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertDisputeAccess(ctx.user.id, ctx.user.role, input.disputeId, "read");
      const db = await requireDb();
      return db.select().from(idrFeeAssessments).where(eq(idrFeeAssessments.disputeId, input.disputeId));
    }),

  /** Update fee payment status (transition-guarded; audited). */
  "fees.updatePaymentStatus": protectedProcedure
    .input(z.object({
      assessmentId: z.string().min(1),
      status: z.enum(["invoiced", "paid", "waived", "refunded", "void"]),
      paymentReference: z.string().max(128).optional(),
      reason: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const rows = await db.select().from(idrFeeAssessments).where(eq(idrFeeAssessments.id, input.assessmentId)).limit(1);
      if (!rows.length) throw new TRPCError({ code: "NOT_FOUND", message: "Fee assessment not found" });
      const current = rows[0];
      await assertDisputeAccess(ctx.user.id, ctx.user.role, current.disputeId, "write");
      try {
        assertFeeStatusTransition(current.status as never, input.status as never);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: (e as Error).message });
      }
      const now = new Date();
      await db.update(idrFeeAssessments).set({
        status: input.status,
        paidAt: input.status === "paid" ? now : current.paidAt,
        invoicedAt: input.status === "invoiced" ? now : current.invoicedAt,
        paymentReference: input.paymentReference ?? current.paymentReference,
        statusReason: input.reason ?? current.statusReason,
        updatedAt: now,
      }).where(eq(idrFeeAssessments.id, input.assessmentId));
      await emitComplianceEvent({
        eventType: "fee.payment_status_changed",
        aggregateId: current.disputeId,
        aggregateType: "fee_assessment",
        topic: "idr.payments",
        payload: { assessmentId: input.assessmentId, from: current.status, to: input.status, reason: input.reason ?? null },
        userId: ctx.user.id,
      });
      return { ok: true as const, from: current.status, to: input.status };
    }),

  // ── Attestations (45 CFR § 149.510(b)(2), (c)(3)) ─────────────────────────

  /**
   * Record a party attestation of information completeness/accuracy.
   * Pass supersedeExisting=true to correct a prior attestation (the old row
   * is marked superseded and links to the new one; nothing is deleted).
   */
  "attestations.attest": protectedProcedure
    .input(z.object({
      disputeId: z.string().min(1),
      attestationType: z.enum(["idr_initiation", "offer_submission"]),
      partyRole: z.enum(["initiating_party", "responding_party"]),
      informationComplete: z.boolean(),
      informationAccurate: z.boolean(),
      supersedeExisting: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertDisputeAccess(ctx.user.id, ctx.user.role, input.disputeId, "write");
      const db = await requireDb();
      const dispute = await loadDispute(db, input.disputeId);
      const existingRows = await db
        .select()
        .from(idrAttestations)
        .where(eq(idrAttestations.disputeId, input.disputeId));
      const existing: AttestationLike[] = existingRows.map(r => ({
        id: r.id,
        disputeId: r.disputeId,
        attestationType: r.attestationType as AttestationType,
        partyRole: r.partyRole as AttestationPartyRole,
        attestedBy: r.attestedBy,
        status: r.status as AttestationLike["status"],
      }));

      const error = validateNewAttestation(
        input.attestationType,
        input.partyRole,
        dispute.currentStep,
        { informationComplete: input.informationComplete, informationAccurate: input.informationAccurate },
        existing
      );
      if (error === "affirmations_required") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Both completeness and accuracy must be affirmed" });
      }
      if (error === "wrong_step") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Attestation type ${input.attestationType} is not accepted at ${dispute.currentStep}` });
      }

      const now = new Date();
      const id = crypto.randomUUID();

      if (error === "already_active") {
        if (!input.supersedeExisting) {
          throw new TRPCError({ code: "CONFLICT", message: "An active attestation already exists; pass supersedeExisting=true to correct it" });
        }
        const plan = planReAttestation(existing, input.attestationType, input.partyRole);
        if (!plan) throw new TRPCError({ code: "CONFLICT", message: "No active attestation found to supersede" });
        await db.update(idrAttestations)
          .set({ status: "superseded", supersededBy: id })
          .where(and(eq(idrAttestations.id, plan.supersedeId), eq(idrAttestations.status, "active")));
        await emitComplianceEvent({
          eventType: "attestation.superseded",
          aggregateId: input.disputeId,
          aggregateType: "attestation",
          topic: "idr.audit",
          payload: { supersededId: plan.supersedeId, replacementId: id, attestationType: input.attestationType, partyRole: input.partyRole },
          userId: ctx.user.id,
        });
      }

      await db.insert(idrAttestations).values({
        id,
        disputeId: input.disputeId,
        attestationType: input.attestationType,
        partyRole: input.partyRole,
        attestedBy: ctx.user.id,
        attestedByName: ctx.user.name ?? ctx.user.id,
        attestationText: attestationText(input.attestationType),
        informationComplete: input.informationComplete,
        informationAccurate: input.informationAccurate,
        status: "active",
        ipAddress: ctx.req.ip ?? null,
        userAgent: (ctx.req.headers["user-agent"] as string) ?? null,
        attestedAt: now,
      });
      await emitComplianceEvent({
        eventType: "attestation.recorded",
        aggregateId: input.disputeId,
        aggregateType: "attestation",
        topic: "idr.audit",
        payload: {
          attestationId: id,
          attestationType: input.attestationType,
          partyRole: input.partyRole,
          superseded: error === "already_active",
          cfrReference: input.attestationType === "idr_initiation" ? "45 CFR § 149.510(b)(2)" : "45 CFR § 149.510(c)(3)",
        },
        userId: ctx.user.id,
      });
      return { ok: true as const, attestationId: id, supersededPrior: error === "already_active" };
    }),

  "attestations.listForDispute": protectedProcedure
    .input(z.object({ disputeId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertDisputeAccess(ctx.user.id, ctx.user.role, input.disputeId, "read");
      const db = await requireDb();
      return db
        .select()
        .from(idrAttestations)
        .where(eq(idrAttestations.disputeId, input.disputeId))
        .orderBy(asc(idrAttestations.attestedAt));
    }),

  // ── Federal reporting exports ──────────────────────────────────────────────

  /** Admin: dispute-volume / determination summary CSV for a reporting period. */
  "reporting.volumeSummaryCsv": protectedProcedure
    .input(z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }))
    .query(async ({ ctx, input }) => {
      assertAdminAccess(ctx.user.role, "export federal IDR reporting");
      const db = await requireDb();
      const from = new Date(input.from + "T00:00:00Z");
      const to = new Date(input.to + "T23:59:59Z");

      const rows = await db
        .select()
        .from(disputes)
        .where(and(gte(disputes.createdAt, from), lte(disputes.createdAt, to)));

      const ids = rows.map(r => r.id);
      const determinationEvents = ids.length
        ? await db
            .select({ disputeId: disputeEvents.disputeId, createdAt: disputeEvents.createdAt })
            .from(disputeEvents)
            .where(and(inArray(disputeEvents.disputeId, ids), eq(disputeEvents.step, "STEP_13_DETERMINATION_ISSUED")))
            .orderBy(asc(disputeEvents.createdAt))
        : [];
      const determinedAt = new Map<string, Date>();
      for (const e of determinationEvents) {
        if (e.createdAt && !determinedAt.has(e.disputeId)) determinedAt.set(e.disputeId, e.createdAt);
      }

      const feeTotalsRaw = await db
        .select({
          feeType: idrFeeAssessments.feeType,
          status: idrFeeAssessments.status,
          totalCents: sql<number>`COALESCE(SUM(${idrFeeAssessments.amountCents}), 0)`,
          count: sql<number>`COUNT(*)`,
        })
        .from(idrFeeAssessments)
        .where(and(gte(idrFeeAssessments.assessedAt, from), lte(idrFeeAssessments.assessedAt, to)))
        .groupBy(idrFeeAssessments.feeType, idrFeeAssessments.status);

      const summary = buildVolumeSummary({
        periodStart: from,
        periodEnd: to,
        disputes: rows.map(r => ({
          id: r.id,
          status: r.status,
          serviceType: r.serviceType,
          createdAt: r.createdAt ?? from,
          determinedAt: determinedAt.get(r.id) ?? null,
          determinationAmount: r.determinationAmount,
          determinationWinner: r.determinationWinner,
        })),
        feeTotals: feeTotalsRaw.map(f => ({
          feeType: f.feeType,
          status: f.status,
          totalCents: Number(f.totalCents),
          count: Number(f.count),
        })),
      });
      return { csv: volumeSummaryToCsv(summary), summary };
    }),

  /** Per-determination JSON record aligned to HHS federal IDR reporting fields. */
  "reporting.determinationRecord": protectedProcedure
    .input(z.object({ disputeId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertDisputeAccess(ctx.user.id, ctx.user.role, input.disputeId, "read");
      const db = await requireDb();
      const dispute = await loadDispute(db, input.disputeId);
      const steps = await stepEntryMap(db, input.disputeId);
      const fees = await db
        .select()
        .from(idrFeeAssessments)
        .where(eq(idrFeeAssessments.disputeId, input.disputeId));

      const record = buildDeterminationRecord({
        dispute: {
          id: dispute.id,
          referenceNumber: dispute.referenceNumber,
          status: dispute.status,
          currentStep: dispute.currentStep,
          serviceType: dispute.serviceType,
          serviceDate: dispute.serviceDate,
          patientState: dispute.patientState,
          facilityState: dispute.facilityState,
          cptCodes: dispute.cptCodes,
          billedAmount: dispute.billedAmount,
          qpaAmount: dispute.qpaAmount,
          initiatingPartyOffer: dispute.initiatingPartyOffer,
          respondingPartyOffer: dispute.respondingPartyOffer,
          determinationAmount: dispute.determinationAmount,
          determinationWinner: dispute.determinationWinner,
          determinationBasis: dispute.determinationBasis,
          idrEntityId: dispute.idrEntityId,
          idrEntityName: dispute.idrEntityName,
          createdAt: dispute.createdAt ?? new Date(0),
          closedAt: dispute.closedAt,
        },
        stepEnteredAt: steps,
        fees: fees.map(f => ({ feeType: f.feeType, partyRole: f.partyRole, amountCents: f.amountCents, status: f.status })),
      });
      // Ground the "not collected" placeholders to real schema fields when present.
      (record.items_services as Record<string, unknown>).diagnosis_codes = dispute.icd10Codes ?? null;
      if (dispute.idrEntityId) {
        const { idrEntities } = await import("../../drizzle/schema");
        const ents = await db.select({ certificationNumber: idrEntities.certificationNumber })
          .from(idrEntities).where(eq(idrEntities.id, dispute.idrEntityId)).limit(1);
        (record.certified_idr_entity as Record<string, unknown>).certification_number = ents[0]?.certificationNumber ?? null;
      }
      return record;
    }),
});

export type IDRComplianceRouter = typeof idrComplianceRouter;
