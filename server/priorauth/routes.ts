/**
 * priorauth routes — thin tRPC wrappers over the CMS-0057-F decision-clock
 * engine, the PA lifecycle FSM, and the (STATIC-ONLY) Da Vinci PAS adapter.
 * Fail-closed behavior passes through unchanged: submitViaPas stays BLOCKED
 * unless PA_API_2027_ENABLED=true and a payer endpoint is configured, and the
 * PA_PAYER_ENDPOINT value is never returned to clients.
 *
 * SERVER-AUTHORITATIVE: PA requests are persisted server-side in the
 * fsm-store and addressed by (tenantId, requestId). Clients NEVER round-trip
 * request state — transition takes only requestId + target state + params.
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
  type PaState,
} from "./fsm";
import { buildPasBundle, submitViaPas, loadPasConfig } from "./pas-adapter";
import {
  getFsmCaseStore,
  FsmCaseNotFoundError,
  FsmDuplicateCaseError,
  FsmVersionConflictError,
} from "../fsm-store/store";

const CASE_TYPE = "priorauth";
const TERMINAL_STATES: readonly PaState[] = ["CLOSED", "CANCELLED"];

const idSchema = z.string().min(1).max(128);
const tenantIdSchema = idSchema.default("default");
const idempotencyKeySchema = z.string().min(1).max(128).optional();

/**
 * Revive Date fields after loading a request from the fsm-store (JSONB
 * round-trip turns Dates into ISO strings).
 */
function reviveRequest(raw: PaRequest): PaRequest {
  return {
    ...raw,
    submittedAt: raw.submittedAt ? new Date(raw.submittedAt) : null,
    decidedAt: raw.decidedAt ? new Date(raw.decidedAt) : null,
    events: (raw.events ?? []).map((e) => ({ ...e, at: new Date(e.at) })),
  };
}

/** Map module/store fail-closed Errors to tRPC errors. */
function toTrpcError(err: unknown, fallback: string): never {
  if (err instanceof TRPCError) throw err;
  if (err instanceof FsmCaseNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: err.message });
  }
  if (err instanceof FsmDuplicateCaseError || err instanceof FsmVersionConflictError) {
    throw new TRPCError({ code: "CONFLICT", message: err.message });
  }
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: err instanceof Error ? err.message : fallback,
  });
}

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
 * them before calling into the FSM. Used ONLY by the read-only
 * denialReasonRequired query (a pure function) — never for transitions.
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

  /**
   * Create a new PA request in DRAFT state, persisted server-side.
   * Duplicate (tenantId, requestId) → CONFLICT.
   */
  createRequest: protectedProcedure
    .input(z.object({
      tenantId: tenantIdSchema,
      requestId: idSchema,
      payerType: payerTypeSchema,
      urgency: urgencySchema,
      idempotencyKey: idempotencyKeySchema,
    }))
    .mutation(async ({ input }) => {
      try {
        return await getFsmCaseStore().createCase<PaRequest>({
          tenantId: input.tenantId,
          caseType: CASE_TYPE,
          caseId: input.requestId,
          create: () =>
            createPaRequest({
              id: input.requestId,
              payerType: input.payerType,
              urgency: input.urgency,
            }),
          terminalStates: TERMINAL_STATES,
          idempotencyKey: input.idempotencyKey,
        });
      } catch (err) {
        toTrpcError(err, "Invalid PA request");
      }
    }),

  /** Load the server-authoritative PA request (null when not found). */
  getRequest: protectedProcedure
    .input(z.object({ tenantId: tenantIdSchema, requestId: idSchema }))
    .query(async ({ input }) => {
      return getFsmCaseStore().getCase<PaRequest>(input.tenantId, CASE_TYPE, input.requestId);
    }),

  /**
   * Guarded FSM transition, server-authoritative. The client supplies only
   * (tenantId, requestId, to, transition params); the store loads the
   * persisted request, applies the module's pure guard/transition, and
   * CAS-persists. Invalid transitions and the CMS-0057-F denial-reason guard
   * surface as BAD_REQUEST; unknown request → NOT_FOUND; version conflict →
   * CONFLICT. Client-supplied state is NEVER accepted.
   */
  transition: protectedProcedure
    .input(z.object({
      tenantId: tenantIdSchema,
      requestId: idSchema,
      to: paStateSchema,
      now: z.coerce.date().optional(),
      denialReason: z.string().max(2000).optional(),
      enforcementDiscretion: z.boolean().optional(),
      idempotencyKey: idempotencyKeySchema,
    }))
    .mutation(async ({ input }) => {
      try {
        return await getFsmCaseStore().transitionCase<PaRequest>(
          input.tenantId,
          CASE_TYPE,
          input.requestId,
          {
            apply: (current) =>
              paTransition(reviveRequest(current), input.to, {
                now: input.now,
                denialReason: input.denialReason,
                enforcementDiscretion: input.enforcementDiscretion,
              }),
            terminalStates: TERMINAL_STATES,
            idempotencyKey: input.idempotencyKey,
            now: input.now,
          }
        );
      } catch (err) {
        toTrpcError(err, "Invalid PA transition");
      }
    }),

  /** Append-only hash-chained event log + tamper-evident chain verification. */
  getEvents: protectedProcedure
    .input(z.object({ tenantId: tenantIdSchema, requestId: idSchema }))
    .query(async ({ input }) => {
      const store = getFsmCaseStore();
      const events = await store.getEventLog(input.tenantId, CASE_TYPE, input.requestId);
      const verification = await store.verifyEventChain(input.tenantId, CASE_TYPE, input.requestId);
      return { events, verification };
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
