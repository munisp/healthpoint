/**
 * submission-automation routes — thin tRPC wrappers over the verified logic
 * libraries in this directory (package-builder, submission-fsm, feedback,
 * store, validators).
 *
 * Server-authoritative model: the FSM entity is NEVER round-tripped through
 * the client. Clients address a submission by (tenantId, disputeId); the
 * store performs load → guard → apply → CAS persist → hash-chained event.
 * The attestation actorId is forced to ctx.user.id — callers cannot attest
 * on behalf of another user.
 *
 * Telemetry: determination outcomes are persisted to the platform audit log
 * via createAuditEntry (action='idr_submission_outcome_telemetry') — the
 * lightest real analytics sink available in this codebase. See
 * auditTelemetrySink below.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../../_core/trpc";
import { buildSubmissionPackage } from "./package-builder";
import { InvalidTransitionError } from "./submission-fsm";
import {
  getSubmissionStore,
  VersionConflictError,
  DuplicateSubmissionError,
  SubmissionNotFoundError,
} from "./store";
import {
  recordDeterminationWithStore,
  remittanceReconciliation,
  DeterminationValidationError,
  OutcomeTelemetry,
} from "./feedback";
import { isValidCmsDisputeReference } from "./validators";

/** Local admin procedure (same pattern as routers.ts; cannot import it from there due to circularity). */
const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next();
});

/**
 * Win-rate outcome telemetry sink: persists to the platform audit_log table
 * via createAuditEntry (server/db.ts). Chosen because this codebase has no
 * dedicated analytics/event sink for IDR outcomes; the audit log is the
 * existing durable, queryable analytics path. Telemetry failures are logged,
 * never thrown — telemetry must not block determination recording.
 */
export function auditTelemetrySink(actorId: string) {
  return (t: OutcomeTelemetry): void => {
    void (async () => {
      try {
        const mod = await import("../../db");
        await mod.createAuditEntry({
          userId: actorId,
          action: "idr_submission_outcome_telemetry",
          entityType: "idr_dispute",
          entityId: t.disputeId,
          newValue: JSON.stringify(t),
        });
      } catch (err) {
        console.error("[submission-automation] telemetry sink failed:", err);
      }
    })();
  };
}

const idSchema = z.string().min(1).max(128);

const idempotencyKeySchema = z.string().min(1).max(128).optional();

const SUBMISSION_STATES = [
  "DRAFT",
  "PACKAGE_READY",
  "SUBMITTED",
  "ACKNOWLEDGED",
  "IDRE_ASSIGNED",
  "OFFER_SUBMITTED",
  "DETERMINATION_RECEIVED",
  "PAYMENT_TRACKING",
  "CLOSED",
  "WITHDRAWN",
] as const;

const submissionStateSchema = z.enum(SUBMISSION_STATES);

/**
 * Attestation payload WITHOUT actorId: the actor is always the authenticated
 * caller (ctx.user.id), forced server-side. Callers cannot override it.
 */
const attestationSchema = z.object({
  attestedAt: z.string().min(1),
  portalConfirmationText: z.string().optional(),
});

const disputeInputSchema = z.object({
  disputeId: idSchema.optional(),
  tenantId: idSchema.optional(),
  initiatingPartyName: z.string().max(255).optional(),
  initiatingPartyContactEmail: z.string().email().max(255).optional(),
  initiatingPartyContactPhone: z.string().max(64).optional(),
  initiatingPartyNpi: z.string().max(10).optional(),
  initiatingPartyTin: z.string().max(32).optional(),
  respondingPartyName: z.string().max(255).optional(),
  respondingPartyContactEmail: z.string().email().max(255).optional(),
  respondingPartyContactPhone: z.string().max(64).optional(),
  respondingPartyTin: z.string().max(32).optional(),
  claimNumber: z.string().max(128).optional(),
  serviceCode: z.string().max(32).optional(),
  dateOfService: z.string().max(32).optional(),
  billedCharge: z.number().nonnegative().optional(),
  qualifyingPaymentAmount: z.number().nonnegative().optional(),
  initialPlanPayment: z.number().nonnegative().optional(),
  openNegotiationInitiationDate: z.string().max(32).optional(),
  openNegotiationNoticeProofRef: z.string().max(512).optional(),
  certificationAttestedAt: z.string().max(64).optional(),
  certificationAttestorName: z.string().max(255).optional(),
  supportingDocuments: z.array(z.string().max(2048)).max(100).optional(),
  initiatingOffer: z.number().nonnegative().optional(),
  initiatingPartyType: z.enum(["provider", "facility", "oqp", "plan", "issuer"]).optional(),
  adminFeeAmount: z.number().nonnegative().optional(),
  cmsDisputeReferenceNumber: z.string().max(64).optional(),
  strictMode: z.boolean().optional(),
  now: z.coerce.date().optional(),
});

const determinationInputSchema = z.object({
  idreId: z.string().min(1),
  determinationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "determinationDate must be YYYY-MM-DD"),
  prevailingParty: z.enum(["initiating", "responding"]),
  prevailingOffer: z.number().finite(),
  qpa: z.number().finite(),
  otherOffer: z.number().finite(),
  rationaleFactors: z.array(z.string().min(1)).min(1),
  adminFeeAmount: z.number().finite(),
  idreFeeAmount: z.number().finite(),
  determinationDocumentRef: z.string().max(2048).optional(),
});

function mapStoreError(err: unknown): never {
  if (err instanceof InvalidTransitionError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
  }
  if (err instanceof VersionConflictError) {
    throw new TRPCError({ code: "CONFLICT", message: err.message });
  }
  if (err instanceof DuplicateSubmissionError) {
    throw new TRPCError({ code: "CONFLICT", message: err.message });
  }
  if (err instanceof SubmissionNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: err.message });
  }
  if (err instanceof DeterminationValidationError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
  }
  throw err;
}

export const submissionAutomationRouter = router({
  /** Build a completeness-checked, portal-ready submission package (no transmission). */
  buildPackage: protectedProcedure
    .input(disputeInputSchema)
    .mutation(({ input }) => {
      return buildSubmissionPackage(input);
    }),

  /**
   * Create a new submission entity in DRAFT state (server-persisted).
   * Idempotent via idempotencyKey; a second ACTIVE submission for the same
   * (tenantId, disputeId) is rejected with CONFLICT.
   */
  create: protectedProcedure
    .input(z.object({
      disputeId: idSchema,
      tenantId: idSchema,
      idempotencyKey: idempotencyKeySchema,
      now: z.coerce.date().optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        return await getSubmissionStore().createSubmission(input);
      } catch (err) {
        mapStoreError(err);
      }
    }),

  /**
   * Guarded, server-authoritative FSM transition. The entity is loaded from
   * the store (never trusted from the client); the transition is CAS-persisted
   * and appended to the hash-chained event log. For SUBMITTED, the attestation
   * actorId is FORCED to ctx.user.id. ACKNOWLEDGED additionally requires the
   * CMS dispute reference number to match the configured format (fail-closed).
   */
  transition: protectedProcedure
    .input(z.object({
      tenantId: idSchema,
      disputeId: idSchema,
      to: submissionStateSchema,
      idempotencyKey: idempotencyKeySchema,
      now: z.coerce.date().optional(),
      attestation: attestationSchema.optional(),
      cmsDisputeReferenceNumber: z.string().min(1).optional(),
      detail: z.string().max(2000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.to === "ACKNOWLEDGED") {
        const ref = input.cmsDisputeReferenceNumber;
        if (!ref || !isValidCmsDisputeReference(ref)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "cmsDisputeReferenceNumber does not match the configured CMS reference format",
          });
        }
      }
      try {
        return await getSubmissionStore().transitionSubmission(input.tenantId, input.disputeId, {
          to: input.to,
          actorId: ctx.user.id,
          now: input.now,
          attestation: input.attestation
            ? { ...input.attestation, actorId: ctx.user.id }
            : input.to === "SUBMITTED"
              ? { actorId: ctx.user.id, attestedAt: (input.now ?? new Date()).toISOString() }
              : undefined,
          cmsDisputeReferenceNumber: input.cmsDisputeReferenceNumber,
          detail: input.detail,
          idempotencyKey: input.idempotencyKey,
        });
      } catch (err) {
        mapStoreError(err);
      }
    }),

  /** Append-only, hash-chained event log with chain verification result. */
  eventLog: protectedProcedure
    .input(z.object({ tenantId: idSchema, disputeId: idSchema }))
    .query(async ({ input }) => {
      const store = getSubmissionStore();
      const events = await store.getEventLog(input.tenantId, input.disputeId);
      const verification = await store.verifyEventChain(input.tenantId, input.disputeId);
      return { events, verification };
    }),

  /**
   * Record a certified IDRE determination (30-calendar-day payment clock).
   * Store-linked: fails closed unless the dispute's active submission is in
   * OFFER_SUBMITTED or DETERMINATION_RECEIVED; auto-transitions
   * OFFER_SUBMITTED → DETERMINATION_RECEIVED. PAYMENT_TRACKING remains an
   * explicit step. Outcome telemetry is persisted via auditTelemetrySink.
   */
  recordDetermination: protectedProcedure
    .input(z.object({
      tenantId: idSchema,
      disputeId: idSchema,
      determination: determinationInputSchema,
      idempotencyKey: idempotencyKeySchema,
      now: z.coerce.date().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await recordDeterminationWithStore(
          input.tenantId,
          input.disputeId,
          input.determination,
          getSubmissionStore(),
          auditTelemetrySink(ctx.user.id),
          input.now,
          input.idempotencyKey
        );
      } catch (err) {
        mapStoreError(err);
      }
    }),

  /**
   * CARC/RARC remittance reconciliation status. BLOCKED until 2027-01-01
   * (CMS-9897-F) and the REMITTANCE_2027_ENABLED flag — admin-only.
   */
  remittanceReconciliation: adminProcedure
    .input(z.object({ now: z.coerce.date().optional() }).optional())
    .query(({ input }) => {
      return remittanceReconciliation(input?.now);
    }),
});

export type SubmissionAutomationRouter = typeof submissionAutomationRouter;
