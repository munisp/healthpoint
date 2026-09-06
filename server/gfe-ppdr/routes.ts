/**
 * GFE / PPDR routes — thin tRPC wrappers over the verified Good Faith
 * Estimate clock (gfe-clock.ts, 45 CFR 149.610) and Patient-Provider Dispute
 * Resolution engine (ppdr.ts, 45 CFR 149.620) in this directory. No business
 * logic is duplicated here; fail-closed behavior of the underlying modules
 * passes through unchanged. Wire date strings are revived to Date instances
 * via z.coerce.date(); the PPDR admin fee must be injected (never defaulted).
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
} from "./ppdr";

/** Map module fail-closed Errors to BAD_REQUEST. */
function toTrpcError(err: unknown): never {
  if (err instanceof TRPCError) throw err;
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

const ppdrEventSchema = z.object({
  type: z.enum(["TRANSITION", "ELIGIBILITY_CHECK", "DETERMINATION_RECORDED"]),
  at: z.coerce.date(),
  from: ppdrStateSchema.optional(),
  to: ppdrStateSchema.optional(),
  detail: z.string().optional(),
});

const ppdrDeterminationSchema = z.object({
  entityId: z.string().min(1).max(128),
  determinedAt: z.coerce.date(),
  patientOwesUsd: z.number().nonnegative(),
  binding: z.boolean(),
  rationale: z.string().max(5000),
});

const ppdrDisputeSchema = z.object({
  id: z.string().min(1).max(128),
  state: ppdrStateSchema,
  gfeTotalUsd: z.number().nonnegative(),
  billedTotalUsd: z.number().nonnegative(),
  billedAt: z.coerce.date(),
  insuranceBilled: z.boolean(),
  adminFeeUsd: z.number().nonnegative().nullable(),
  determination: ppdrDeterminationSchema.nullable(),
  events: z.array(ppdrEventSchema),
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

  /** Create a PPDR dispute in DRAFT state. */
  createDispute: protectedProcedure
    .input(z.object({
      id: z.string().min(1).max(128),
      gfeTotalUsd: z.number().nonnegative(),
      billedTotalUsd: z.number().nonnegative(),
      billedAt: z.coerce.date(),
      insuranceBilled: z.boolean(),
    }))
    .mutation(({ input }) => {
      try {
        return createPpdrDispute(input);
      } catch (err) {
        toTrpcError(err);
      }
    }),

  /**
   * Guarded PPDR FSM transition. INITIATED requires the caller-injected
   * adminFeeUsd from current annual HHS guidance (never defaulted);
   * DETERMINED requires a determination payload and the module caps
   * patientOwesUsd at the GFE total (149.620(f)). Guard rejections and
   * invalid transitions map to BAD_REQUEST.
   */
  transition: protectedProcedure
    .input(z.object({
      dispute: ppdrDisputeSchema,
      to: ppdrStateSchema,
      now: z.coerce.date().optional(),
      adminFeeUsd: z.number().nonnegative().optional(),
      determination: ppdrDeterminationSchema.omit({ binding: true }).optional(),
    }))
    .mutation(({ input }) => {
      try {
        return ppdrTransition(input.dispute, input.to, {
          now: input.now,
          adminFeeUsd: input.adminFeeUsd,
          determination: input.determination,
        });
      } catch (err) {
        toTrpcError(err);
      }
    }),
});

export type GfePpdrRouter = typeof gfePpdrRouter;
