/**
 * submission-automation routes — thin tRPC wrappers over the verified logic
 * libraries in this directory (package-builder, submission-fsm, feedback).
 * No business logic is duplicated here; all fail-closed behavior of the
 * underlying modules passes through unchanged.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../../../_core/trpc";
import { buildSubmissionPackage } from "./package-builder";
import {
  createSubmission,
  transition as fsmTransition,
  getEventLog,
  InvalidTransitionError,
} from "./submission-fsm";
import {
  recordDetermination,
  remittanceReconciliation,
  DeterminationValidationError,
} from "./feedback";

/** Local admin procedure (same pattern as routers.ts; cannot import it from there due to circularity). */
const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next();
});

const idSchema = z.string().min(1).max(128);

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

const submissionEventSchema = z.object({
  seq: z.number().int().nonnegative(),
  from: submissionStateSchema.nullable(),
  to: submissionStateSchema,
  at: z.string(),
  actorId: z.string().optional(),
  detail: z.string().optional(),
});

const attestationSchema = z.object({
  actorId: z.string().min(1),
  attestedAt: z.string().min(1),
  portalConfirmationText: z.string().optional(),
});

const submissionEntitySchema = z.object({
  disputeId: idSchema,
  tenantId: idSchema,
  state: submissionStateSchema,
  events: z.array(submissionEventSchema),
  cmsDisputeReferenceNumber: z.string().optional(),
  attestation: attestationSchema.optional(),
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

export const submissionAutomationRouter = router({
  /** Build a completeness-checked, portal-ready submission package (no transmission). */
  buildPackage: protectedProcedure
    .input(disputeInputSchema)
    .mutation(({ input }) => {
      return buildSubmissionPackage(input);
    }),

  /** Create a new submission entity in DRAFT state. */
  create: protectedProcedure
    .input(z.object({
      disputeId: idSchema,
      tenantId: idSchema,
      now: z.coerce.date().optional(),
    }))
    .mutation(({ input }) => {
      return createSubmission(input.disputeId, input.tenantId, input.now);
    }),

  /**
   * Guarded FSM transition. InvalidTransitionError -> BAD_REQUEST.
   * For SUBMITTED, the attestation actorId defaults to the caller's user id.
   */
  transition: protectedProcedure
    .input(z.object({
      entity: submissionEntitySchema,
      to: submissionStateSchema,
      now: z.coerce.date().optional(),
      attestation: attestationSchema.omit({ actorId: true }).extend({ actorId: z.string().min(1).optional() }).optional(),
      cmsDisputeReferenceNumber: z.string().min(1).optional(),
      detail: z.string().max(2000).optional(),
    }))
    .mutation(({ input, ctx }) => {
      try {
        return fsmTransition(input.entity, input.to, {
          actorId: ctx.user.id,
          now: input.now,
          attestation: input.attestation
            ? { ...input.attestation, actorId: input.attestation.actorId ?? ctx.user.id }
            : input.to === "SUBMITTED"
              ? { actorId: ctx.user.id, attestedAt: (input.now ?? new Date()).toISOString() }
              : undefined,
          cmsDisputeReferenceNumber: input.cmsDisputeReferenceNumber,
          detail: input.detail,
        });
      } catch (err) {
        if (err instanceof InvalidTransitionError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
    }),

  /** Defensive copy of the append-only submission event log. */
  eventLog: protectedProcedure
    .input(z.object({ entity: submissionEntitySchema }))
    .query(({ input }) => {
      return getEventLog(input.entity);
    }),

  /** Record a certified IDRE determination (30-calendar-day payment clock). */
  recordDetermination: protectedProcedure
    .input(z.object({
      tenantId: idSchema,
      disputeId: idSchema,
      determination: determinationInputSchema,
      now: z.coerce.date().optional(),
    }))
    .mutation(({ input }) => {
      try {
        return recordDetermination(input.tenantId, input.disputeId, input.determination, undefined, input.now);
      } catch (err) {
        if (err instanceof DeterminationValidationError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
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
