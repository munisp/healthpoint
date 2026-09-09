/**
 * GFE / PPDR routes — thin tRPC wrappers over the verified Good Faith
 * Estimate clock (gfe-clock.ts, 45 CFR 149.610), the Patient-Provider Dispute
 * Resolution engine (ppdr.ts, 45 CFR 149.620), and the generic persisted FSM
 * case store (server/fsm-store). No business logic is duplicated here;
 * fail-closed behavior of the underlying modules passes through unchanged.
 * Wire date strings are revived to Date instances via z.coerce.date(); the
 * PPDR admin fee must be injected (never defaulted).
 *
 * SERVER-AUTHORITATIVE: PPDR disputes are persisted server-side in the
 * fsm-store and addressed by (tenantId, disputeId). Clients NEVER round-trip
 * dispute state — transition takes only disputeId + target state + params.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import {
  computeGfeDeadline,
  isGfeLate,
  validateGfeContent,
  validateRecurringGfeWindow,
} from "./gfe-clock";
import {
  evaluatePpdrEligibility,
  createPpdrDispute,
  transition as ppdrTransition,
  type PpdrDispute,
  type PpdrState,
} from "./ppdr";
import {
  getFsmCaseStore,
  FsmCaseNotFoundError,
  FsmDuplicateCaseError,
  FsmVersionConflictError,
} from "../fsm-store/store";

const CASE_TYPE = "gfe-ppdr";
const TERMINAL_STATES: readonly PpdrState[] = ["CLOSED", "INELIGIBLE"];

const idSchema = z.string().min(1).max(128);
const tenantIdSchema = idSchema.default("default");
const idempotencyKeySchema = z.string().min(1).max(128).optional();

/**
 * Revive Date fields after loading a dispute from the fsm-store (JSONB
 * round-trip turns Dates into ISO strings).
 */
function reviveDispute(raw: PpdrDispute): PpdrDispute {
  return {
    ...raw,
    billedAt: new Date(raw.billedAt),
    determination: raw.determination
      ? { ...raw.determination, determinedAt: new Date(raw.determination.determinedAt) }
      : null,
    events: (raw.events ?? []).map((e) => ({ ...e, at: new Date(e.at) })),
  };
}

/** Map module/store fail-closed Errors to tRPC errors. */
function toTrpcError(err: unknown): never {
  if (err instanceof TRPCError) throw err;
  if (err instanceof FsmCaseNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: err.message });
  }
  if (err instanceof FsmDuplicateCaseError || err instanceof FsmVersionConflictError) {
    throw new TRPCError({ code: "CONFLICT", message: err.message });
  }
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: err instanceof Error ? err.message : "GFE/PPDR validation failed",
  });
}

const holidaySetSchema = z
  .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
  .max(400)
  .transform((arr) => new Set(arr));

const ppdrStateSchema = z.enum([
  "DRAFT",
  "INITIATED",
  "DOCS_PENDING",
  "UNDER_REVIEW",
  "DETERMINED",
  "CLOSED",
  "INELIGIBLE",
]);

const ppdrDeterminationSchema = z.object({
  entityId: z.string().min(1).max(128),
  determinedAt: z.coerce.date(),
  patientOwesUsd: z.number().nonnegative(),
  binding: z.boolean(),
  rationale: z.string().max(5000),
});

export const gfePpdrRouter = router({
  /**
   * GFE delivery deadline (45 CFR 149.610(a)(2)): 3 business days for
   * long-horizon scheduling/requests, 1 business day for 3–9-business-day
   * horizons, at-scheduling (fail-closed) for <3 business days.
   */
  computeDeadline: protectedProcedure
    .input(z.object({
      scheduledAt: z.coerce.date(),
      serviceAt: z.coerce.date(),
      requestedWithoutScheduling: z.boolean().optional(),
      holidays: holidaySetSchema.optional(),
    }))
    .query(({ input }) => {
      try {
        return computeGfeDeadline(input);
      } catch (err) {
        toTrpcError(err);
      }
    }),

  /** Whether a GFE delivered at a given time missed its computed deadline. */
  isLate: protectedProcedure
    .input(z.object({
      scheduledAt: z.coerce.date(),
      serviceAt: z.coerce.date(),
      requestedWithoutScheduling: z.boolean().optional(),
      holidays: holidaySetSchema.optional(),
      deliveredAt: z.coerce.date(),
    }))
    .query(({ input }) => {
      try {
        const { deliveredAt, ...deadlineInput } = input;
        const result = computeGfeDeadline(deadlineInput);
        return { late: isGfeLate(result, deliveredAt), deadline: result.deadline, horizon: result.horizon };
      } catch (err) {
        toTrpcError(err);
      }
    }),

  /** GFE content completeness against REQUIRED_GFE_ELEMENTS (149.610(b)). */
  validateContent: protectedProcedure
    .input(z.object({ elementsProvided: z.array(z.string().max(128)).max(64) }))
    .query(({ input }) => validateGfeContent(input.elementsProvided)),

  /** Recurring-services GFE 12-month window check (149.610(a)(2)(iii)). */
  validateRecurringWindow: protectedProcedure
    .input(z.object({
      firstServiceAt: z.coerce.date(),
      lastServiceAt: z.coerce.date(),
    }))
    .query(({ input }) => {
      try {
        return validateRecurringGfeWindow(input.firstServiceAt, input.lastServiceAt);
      } catch (err) {
        toTrpcError(err);
      }
    }),

  /**
   * PPDR eligibility (45 CFR 149.620(b)): uninsured/self-pay only, billed
   * charges >= $400 above the GFE total, initiation within 120 calendar days
   * of the initial bill.
   */
  evaluateEligibility: protectedProcedure
    .input(z.object({
      gfeTotalUsd: z.number().nonnegative(),
      billedTotalUsd: z.number().nonnegative(),
      billedAt: z.coerce.date(),
      insuranceBilled: z.boolean(),
      asOf: z.coerce.date().optional(),
    }))
    .query(({ input }) => {
      try {
        return evaluatePpdrEligibility(input);
      } catch (err) {
        toTrpcError(err);
      }
    }),

  /**
   * Create a PPDR dispute in DRAFT state, persisted server-side.
   * Duplicate (tenantId, disputeId) → CONFLICT.
   */
  createDispute: protectedProcedure
    .input(z.object({
      tenantId: tenantIdSchema,
      disputeId: idSchema,
      gfeTotalUsd: z.number().nonnegative(),
      billedTotalUsd: z.number().nonnegative(),
      billedAt: z.coerce.date(),
      insuranceBilled: z.boolean(),
      idempotencyKey: idempotencyKeySchema,
    }))
    .mutation(async ({ input }) => {
      try {
        return await getFsmCaseStore().createCase<PpdrDispute>({
          tenantId: input.tenantId,
          caseType: CASE_TYPE,
          caseId: input.disputeId,
          create: () =>
            createPpdrDispute({
              id: input.disputeId,
              gfeTotalUsd: input.gfeTotalUsd,
              billedTotalUsd: input.billedTotalUsd,
              billedAt: input.billedAt,
              insuranceBilled: input.insuranceBilled,
            }),
          terminalStates: TERMINAL_STATES,
          idempotencyKey: input.idempotencyKey,
        });
      } catch (err) {
        toTrpcError(err);
      }
    }),

  /** Load the server-authoritative PPDR dispute (null when not found). */
  getDispute: protectedProcedure
    .input(z.object({ tenantId: tenantIdSchema, disputeId: idSchema }))
    .query(async ({ input }) => {
      return getFsmCaseStore().getCase<PpdrDispute>(input.tenantId, CASE_TYPE, input.disputeId);
    }),

  /**
   * Guarded PPDR FSM transition, server-authoritative. The client supplies
   * only (tenantId, disputeId, to, transition params) — never dispute state;
   * the store loads the persisted dispute, applies the module's pure
   * guard/transition, and CAS-persists. INITIATED requires the caller-injected
   * adminFeeUsd from current annual HHS guidance (never defaulted);
   * DETERMINED requires a determination payload and the module caps
   * patientOwesUsd at the GFE total (149.620(f)). Guard rejections and
   * invalid transitions map to BAD_REQUEST; unknown dispute → NOT_FOUND;
   * version conflict → CONFLICT.
   */
  transition: protectedProcedure
    .input(z.object({
      tenantId: tenantIdSchema,
      disputeId: idSchema,
      to: ppdrStateSchema,
      now: z.coerce.date().optional(),
      adminFeeUsd: z.number().nonnegative().optional(),
      determination: ppdrDeterminationSchema.omit({ binding: true }).optional(),
      idempotencyKey: idempotencyKeySchema,
    }))
    .mutation(async ({ input }) => {
      try {
        return await getFsmCaseStore().transitionCase<PpdrDispute>(
          input.tenantId,
          CASE_TYPE,
          input.disputeId,
          {
            apply: (current) =>
              ppdrTransition(reviveDispute(current), input.to, {
                now: input.now,
                adminFeeUsd: input.adminFeeUsd,
                determination: input.determination,
              }),
            terminalStates: TERMINAL_STATES,
            idempotencyKey: input.idempotencyKey,
            now: input.now,
          }
        );
      } catch (err) {
        toTrpcError(err);
      }
    }),

  /** Append-only hash-chained event log + tamper-evident chain verification. */
  getEvents: protectedProcedure
    .input(z.object({ tenantId: tenantIdSchema, disputeId: idSchema }))
    .query(async ({ input }) => {
      const store = getFsmCaseStore();
      const events = await store.getEventLog(input.tenantId, CASE_TYPE, input.disputeId);
      const verification = await store.verifyEventChain(input.tenantId, CASE_TYPE, input.disputeId);
      return { events, verification };
    }),
});

export type GfePpdrRouter = typeof gfePpdrRouter;
