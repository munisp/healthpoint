/**
 * Notice & Consent routes — thin tRPC wrappers over the verified waiver
 * engine (waiver.ts) and lifecycle FSM (fsm.ts) in this directory
 * (45 CFR 149.410–450). No business logic is duplicated here; fail-closed
 * behavior of the underlying modules passes through unchanged. Wire date
 * strings are revived to Date instances via z.coerce.date().
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import {
  evaluateWaiverEligibility,
  validateNoticeTiming,
  validateNoticeContent,
  retentionUntil,
} from "./waiver";
import { createNoticeConsentCase, transition } from "./fsm";

const serviceCategorySchema = z.enum([
  "EMERGENCY",
  "ANCILLARY",
  "DIAGNOSTIC",
  "UNFORESEEN_URGENT",
  "NON_EMERGENCY",
]);

const waiverInputSchema = z.object({
  serviceCategory: serviceCategorySchema,
  providerSpecialty: z.string().max(128).optional(),
  noInNetworkProviderAvailable: z.boolean().optional(),
  providerInNetwork: z.boolean().optional(),
});

const timingInputSchema = z.object({
  scheduledAt: z.coerce.date(),
  serviceAt: z.coerce.date(),
  noticeDeliveredAt: z.coerce.date(),
  consentSignedAt: z.coerce.date().optional(),
});

const ncStateSchema = z.enum([
  "NOTICE_REQUIRED",
  "NOTICE_DELIVERED",
  "CONSENT_SIGNED",
  "SERVICE_RENDERED",
  "CONSENT_REVOKED",
  "NOTICE_EXPIRED",
  "WAIVED_IMPOSSIBLE",
]);

const ncEventSchema = z.object({
  type: z.enum(["TRANSITION", "GUARD_REJECTION", "RETENTION_COMPUTED"]),
  at: z.coerce.date(),
  from: ncStateSchema.optional(),
  to: ncStateSchema.optional(),
  detail: z.string().optional(),
});

const noticeConsentCaseSchema = z.object({
  id: z.string().min(1).max(128),
  state: ncStateSchema,
  waiverInput: waiverInputSchema,
  timing: timingInputSchema,
  noticeElements: z.array(z.string().max(128)),
  retentionUntil: z.coerce.date().nullable(),
  events: z.array(ncEventSchema),
});

/** Map module fail-closed Errors to BAD_REQUEST. */
function toTrpcError(err: unknown): never {
  if (err instanceof TRPCError) throw err;
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: err instanceof Error ? err.message : "Notice-consent validation failed",
  });
}

export const noticeConsentRouter = router({
  /** Waiver availability per 45 CFR 149.410(c)(4) / 149.420(b) (fail-closed). */
  evaluateWaiverEligibility: protectedProcedure
    .input(waiverInputSchema)
    .query(({ input }) => evaluateWaiverEligibility(input)),

  /** 72-hour / day-of / 3-hour timing validation per 149.420(c)-(d). */
  validateTiming: protectedProcedure
    .input(timingInputSchema)
    .query(({ input }) => {
      try {
        return validateNoticeTiming(input);
      } catch (err) {
        toTrpcError(err);
      }
    }),

  /** Notice content completeness against REQUIRED_NOTICE_ELEMENTS. */
  validateContent: protectedProcedure
    .input(z.object({ elementsProvided: z.array(z.string().max(128)).max(64) }))
    .query(({ input }) => validateNoticeContent(input.elementsProvided)),

  /** End of the 7-year retention window (26 CFR 54.9816-7) for a signed consent. */
  retentionUntil: protectedProcedure
    .input(z.object({ signedAt: z.coerce.date() }))
    .query(({ input }) => {
      try {
        return { retentionUntil: retentionUntil(input.signedAt) };
      } catch (err) {
        toTrpcError(err);
      }
    }),

  /** Create a notice-consent case in NOTICE_REQUIRED state. */
  createCase: protectedProcedure
    .input(z.object({
      id: z.string().min(1).max(128),
      waiverInput: waiverInputSchema,
      timing: timingInputSchema,
      noticeElements: z.array(z.string().max(128)).max(64),
    }))
    .mutation(({ input }) => {
      try {
        return createNoticeConsentCase(input);
      } catch (err) {
        toTrpcError(err);
      }
    }),

  /**
   * Guarded FSM transition. Guard rejections (incomplete notice, non-waivable
   * service, timing violations, invalid transitions) map to BAD_REQUEST.
   */
  transition: protectedProcedure
    .input(z.object({
      case: noticeConsentCaseSchema,
      to: ncStateSchema,
      now: z.coerce.date().optional(),
    }))
    .mutation(({ input }) => {
      try {
        return transition(input.case, input.to, { now: input.now });
      } catch (err) {
        toTrpcError(err);
      }
    }),
});

export type NoticeConsentRouter = typeof noticeConsentRouter;
