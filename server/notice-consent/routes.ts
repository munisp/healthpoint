/**
 * Notice & Consent routes — thin tRPC wrappers over the verified waiver
 * engine (waiver.ts), the lifecycle FSM (fsm.ts), and the generic persisted
 * FSM case store (server/fsm-store) (45 CFR 149.410–450). No business logic is
 * duplicated here; fail-closed behavior of the underlying modules passes
 * through unchanged. Wire date strings are revived to Date instances via
 * z.coerce.date().
 *
 * SERVER-AUTHORITATIVE: cases are persisted server-side in the fsm-store and
 * addressed by (tenantId, caseId). Clients NEVER round-trip case state — the
 * transition procedure takes only caseId + target state + transition params,
 * and the store loads the server-side case, applies the module's pure
 * guard/transition, and persists with optimistic locking + a hash-chained
 * event log. A client cannot forge CONSENT_SIGNED or inject event history.
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
import {
  createNoticeConsentCase,
  transition,
  type NoticeConsentCase,
  type NcState,
} from "./fsm";
import {
  getFsmCaseStore,
  FsmCaseNotFoundError,
  FsmDuplicateCaseError,
  FsmVersionConflictError,
} from "../fsm-store/store";

const CASE_TYPE = "notice-consent";
const TERMINAL_STATES: readonly NcState[] = [
  "SERVICE_RENDERED",
  "CONSENT_REVOKED",
  "NOTICE_EXPIRED",
  "WAIVED_IMPOSSIBLE",
];

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

const idSchema = z.string().min(1).max(128);
const tenantIdSchema = idSchema.default("default");
const idempotencyKeySchema = z.string().min(1).max(128).optional();

/**
 * Revive Date fields after loading a case from the fsm-store (JSONB
 * round-trip turns Dates into ISO strings).
 */
function reviveCase(raw: NoticeConsentCase): NoticeConsentCase {
  return {
    ...raw,
    timing: {
      ...raw.timing,
      scheduledAt: new Date(raw.timing.scheduledAt),
      serviceAt: new Date(raw.timing.serviceAt),
      noticeDeliveredAt: new Date(raw.timing.noticeDeliveredAt),
      consentSignedAt: raw.timing.consentSignedAt
        ? new Date(raw.timing.consentSignedAt)
        : undefined,
    },
    retentionUntil: raw.retentionUntil ? new Date(raw.retentionUntil) : null,
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

  /**
   * Create a notice-consent case in NOTICE_REQUIRED state, persisted
   * server-side. Duplicate (tenantId, caseId) → CONFLICT.
   */
  createCase: protectedProcedure
    .input(z.object({
      tenantId: tenantIdSchema,
      caseId: idSchema,
      waiverInput: waiverInputSchema,
      timing: timingInputSchema,
      noticeElements: z.array(z.string().max(128)).max(64),
      idempotencyKey: idempotencyKeySchema,
    }))
    .mutation(async ({ input }) => {
      try {
        return await getFsmCaseStore().createCase<NoticeConsentCase>({
          tenantId: input.tenantId,
          caseType: CASE_TYPE,
          caseId: input.caseId,
          create: () =>
            createNoticeConsentCase({
              id: input.caseId,
              waiverInput: input.waiverInput,
              timing: input.timing,
              noticeElements: input.noticeElements,
            }),
          terminalStates: TERMINAL_STATES,
          idempotencyKey: input.idempotencyKey,
        });
      } catch (err) {
        toTrpcError(err);
      }
    }),

  /** Load the server-authoritative case (null when not found). */
  getCase: protectedProcedure
    .input(z.object({ tenantId: tenantIdSchema, caseId: idSchema }))
    .query(async ({ input }) => {
      return getFsmCaseStore().getCase<NoticeConsentCase>(
        input.tenantId,
        CASE_TYPE,
        input.caseId
      );
    }),

  /**
   * Guarded FSM transition, server-authoritative. The client supplies only
   * (tenantId, caseId, to, now?); the store loads the persisted case, applies
   * the module's pure guard/transition, and CAS-persists. Guard rejections
   * (incomplete notice, non-waivable service, timing violations, invalid
   * transitions) map to BAD_REQUEST; unknown case → NOT_FOUND; version
   * conflict → CONFLICT.
   */
  transition: protectedProcedure
    .input(z.object({
      tenantId: tenantIdSchema,
      caseId: idSchema,
      to: ncStateSchema,
      now: z.coerce.date().optional(),
      idempotencyKey: idempotencyKeySchema,
    }))
    .mutation(async ({ input }) => {
      try {
        return await getFsmCaseStore().transitionCase<NoticeConsentCase>(
          input.tenantId,
          CASE_TYPE,
          input.caseId,
          {
            apply: (current) => transition(reviveCase(current), input.to, { now: input.now }),
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
    .input(z.object({ tenantId: tenantIdSchema, caseId: idSchema }))
    .query(async ({ input }) => {
      const store = getFsmCaseStore();
      const events = await store.getEventLog(input.tenantId, CASE_TYPE, input.caseId);
      const verification = await store.verifyEventChain(input.tenantId, CASE_TYPE, input.caseId);
      return { events, verification };
    }),
});

export type NoticeConsentRouter = typeof noticeConsentRouter;
