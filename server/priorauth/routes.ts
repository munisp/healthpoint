/**
 * priorauth routes — thin tRPC wrappers over the CMS-0057-F decision-clock
 * engine, the PA lifecycle FSM, and the (STATIC-ONLY) Da Vinci PAS adapter.
 * Fail-closed behavior passes through unchanged: submitViaPas stays BLOCKED
 * unless PA_API_2027_ENABLED=true and a payer endpoint is configured, and the
 * PA_PAYER_ENDPOINT value is never returned to clients.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { computeDecisionDeadline } from "./clocks";
import {
  createPaRequest,
  transition as paTransition,
  denialReasonRequired,
  type PaRequest,
} from "./fsm";
import { buildPasBundle, submitViaPas, loadPasConfig } from "./pas-adapter";

const payerTypeSchema = z.enum(["MA", "MEDICAID_FFS", "MEDICAID_MCO", "CHIP_FFS", "CHIP_MCO", "QHP_FFE"]);
const urgencySchema = z.enum(["STANDARD", "EXPEDITED"]);
const paStateSchema = z.enum([
  "DRAFT",
  "SUBMITTED",
  "PENDED_INFO",
  "APPROVED",
  "DENIED",
  "APPEAL_ROUTED",
  "CLOSED",
  "CANCELLED",
]);

/**
 * PaRequest schema with Date revival: Dates serialize to strings over the
 * wire, so submittedAt/decidedAt/events[].at are z.coerce.date() to revive
 * them before calling into the FSM.
 */
const paEventSchema = z.object({
  type: z.enum(["TRANSITION", "CLOCK_BREACH"]),
  at: z.coerce.date(),
  from: paStateSchema.optional(),
  to: paStateSchema.optional(),
  detail: z.string().optional(),
});

const paRequestSchema = z.object({
  id: z.string().min(1).max(128),
  state: paStateSchema,
  payerType: payerTypeSchema,
  urgency: urgencySchema,
  submittedAt: z.coerce.date().nullable(),
  decidedAt: z.coerce.date().nullable(),
  denialReason: z.string().max(2000).nullable(),
  events: z.array(paEventSchema),
});

export const priorAuthRouter = router({
  /** Compute the CMS-0057-F decision deadline for a PA request. */
  computeDeadline: protectedProcedure
    .input(z.object({
      urgency: urgencySchema,
      payerType: payerTypeSchema,
      submittedAt: z.coerce.date(),
      asOfDate: z.coerce.date().optional(),
      enforcementDiscretion: z.boolean().optional(),
    }))
    .query(({ input }) => {
      try {
        return computeDecisionDeadline(input);
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err instanceof Error ? err.message : "Invalid deadline input",
        });
      }
    }),

  /** Create a new PA request in DRAFT state. */
  createRequest: protectedProcedure
    .input(z.object({
      id: z.string().min(1).max(128),
      payerType: payerTypeSchema,
      urgency: urgencySchema,
    }))
    .mutation(({ input }) => {
      try {
        return createPaRequest(input);
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err instanceof Error ? err.message : "Invalid PA request",
        });
      }
    }),

  /**
   * Guarded FSM transition. Invalid transitions and the CMS-0057-F
   * denial-reason guard surface as BAD_REQUEST.
   */
  transition: protectedProcedure
    .input(z.object({
      request: paRequestSchema,
      to: paStateSchema,
      now: z.coerce.date().optional(),
      denialReason: z.string().max(2000).optional(),
      enforcementDiscretion: z.boolean().optional(),
    }))
    .mutation(({ input }) => {
      try {
        return paTransition(input.request as PaRequest, input.to, {
          now: input.now,
          denialReason: input.denialReason,
          enforcementDiscretion: input.enforcementDiscretion,
        });
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err instanceof Error ? err.message : "Invalid PA transition",
        });
      }
    }),

  /** Whether CMS-0057-F requires a specific denial reason for this request. */
  denialReasonRequired: protectedProcedure
    .input(z.object({ request: paRequestSchema }))
    .query(({ input }) => {
      return denialReasonRequired(input.request as PaRequest);
    }),

  /** Build a FHIR R4 PAS Bundle skeleton (pure/static; no I/O). */
  buildPasBundle: protectedProcedure
    .input(z.object({
      id: z.string().min(1).max(128),
      urgency: urgencySchema,
      createdAt: z.coerce.date().optional(),
    }))
    .query(({ input }) => {
      try {
        return buildPasBundle(input);
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err instanceof Error ? err.message : "Invalid PAS bundle input",
        });
      }
    }),

  /**
   * Attempt PAS submission. Config is loaded server-side; the
   * PA_PAYER_ENDPOINT value is NEVER returned — only status/reason/bundle.
   */
  submitViaPas: protectedProcedure
    .input(z.object({
      id: z.string().min(1).max(128),
      urgency: urgencySchema,
    }))
    .mutation(({ input }) => {
      const result = submitViaPas(input, loadPasConfig());
      if (result.status === "BLOCKED") {
        return { status: result.status, reason: result.reason };
      }
      return { status: result.status, bundle: result.bundle };
    }),

  /** PA API configuration status — booleans only, never values. */
  getPaConfig: protectedProcedure.query(() => {
    const config = loadPasConfig();
    return {
      enabled: config.paApi2027Enabled,
      endpointConfigured: typeof config.payerEndpoint === "string" && config.payerEndpoint.length > 0,
    };
  }),
});

export type PriorAuthRouter = typeof priorAuthRouter;
