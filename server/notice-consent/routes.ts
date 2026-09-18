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
import { router, protectedProcedure, publicProcedure } from "../_core/trpc";
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
import {
  composeNoticeDocument,
  isNoticeLanguage,
  NOTICE_LANGUAGES,
} from "../../shared/i18n/notices";
import { eventBus } from "../events/bus";
import { registerConsentRevokedListener } from "./consent-events";
import {
  CONSENT_SIGN_SCOPE,
  CONSENT_SIGNATURE_LINK_TTL_MS,
  assertConsentSignToken,
  buildSignatureArtifact,
  persistSignatureArtifact,
  tokenCaseRef,
} from "./signature";
import { hashPatientToken } from "../personas/guards";
import { getDb } from "../db";
import { patientAccessTokens } from "../../drizzle/schema-personas";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";

// W4-F3: downstream balance-billing-prohibited flagging on consent.revoked.
registerConsentRevokedListener();

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
  "AIR_AMBULANCE",
  "POST_STABILIZATION",
]);

const waiverInputSchema = z.object({
  serviceCategory: serviceCategorySchema,
  providerSpecialty: z.string().max(128).optional(),
  noInNetworkProviderAvailable: z.boolean().optional(),
  providerInNetwork: z.boolean().optional(),
  emergencyAirAmbulance: z.boolean().optional(),
  postStabilization: z
    .object({
      patientStable: z.boolean().optional(),
      canTravelToParticipatingFacility: z.boolean().optional(),
      receivingFacilityReachable: z.boolean().optional(),
      informedConsentObtained: z.boolean().optional(),
    })
    .optional(),
});

const languageSchema = z
  .string()
  .max(16)
  .refine((v) => isNoticeLanguage(v), {
    message: `language must be one of: ${NOTICE_LANGUAGES.join(", ")}`,
  });

const timingInputSchema = z.object({
  scheduledAt: z.coerce.date(),
  serviceAt: z.coerce.date(),
  noticeDeliveredAt: z.coerce.date(),
  consentSignedAt: z.coerce.date().optional(),
  /** W4-F7: IANA timezone for the day-of-scheduling check (default UTC + warning). */
  timeZone: z.string().max(64).optional(),
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
/**
 * BACKWARD COMPAT ONLY: clients may still send tenantId, but it is IGNORED.
 * The tenant is always derived server-side from the authenticated caller
 * (X1: tenant binding) so a client can never read or mutate another
 * tenant's cases/disputes.
 */
const tenantIdSchema = idSchema.optional();

/** Server-authoritative tenant binding: one tenant per authenticated user. */
function callerTenant(ctx: { user: { id: string } }): string {
  return `tenant:${ctx.user.id}`;
}
const idempotencyKeySchema = z.string().min(1).max(128).optional();

/**
 * Revive Date fields after loading a case from the fsm-store (JSONB
 * round-trip turns Dates into ISO strings).
 */
function reviveCase(raw: NoticeConsentCase): NoticeConsentCase {
  return {
    ...raw,
    language: raw.language ?? "en", // pre-W4 rows have no language column
    noticedServiceAt: raw.noticedServiceAt ? new Date(raw.noticedServiceAt) : undefined,
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

  /**
   * Notice content completeness against REQUIRED_NOTICE_ELEMENTS.
   * W4-F1: optional `language` validates against the matching language's
   * available statutory text blocks (fail closed on unsupported language).
   */
  validateContent: protectedProcedure
    .input(z.object({
      elementsProvided: z.array(z.string().max(128)).max(64),
      language: z.string().max(16).optional(),
    }))
    .query(({ input }) => validateNoticeContent(input.elementsProvided, input.language)),

  /**
   * W4-F1: compose the full statutory notice & consent document text for a
   * persisted case in the requested language (default: the case language).
   */
  renderNoticeDocument: protectedProcedure
    .input(z.object({
      caseId: idSchema,
      language: z.string().max(16).optional(),
      providerName: z.string().min(1).max(255),
      itemsAndServices: z.array(z.string().max(512)).max(128).optional(),
      gfeTotalUsd: z.number().nonnegative().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const stored = await getFsmCaseStore().getCase<NoticeConsentCase>(
        callerTenant(ctx),
        CASE_TYPE,
        input.caseId
      );
      if (!stored) {
        throw new TRPCError({ code: "NOT_FOUND", message: `No notice-consent case ${input.caseId}` });
      }
      const language = input.language ?? stored.data.language ?? "en";
      return {
        caseId: input.caseId,
        language,
        document: composeNoticeDocument({
          providerName: input.providerName,
          caseId: input.caseId,
          itemsAndServices: input.itemsAndServices,
          gfeTotalUsd: input.gfeTotalUsd,
          language,
        }),
      };
    }),

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
      language: languageSchema.optional(),
      idempotencyKey: idempotencyKeySchema,
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await getFsmCaseStore().createCase<NoticeConsentCase>({
          tenantId: callerTenant(ctx),
          caseType: CASE_TYPE,
          caseId: input.caseId,
          create: () =>
            createNoticeConsentCase({
              id: input.caseId,
              waiverInput: input.waiverInput,
              timing: input.timing,
              noticeElements: input.noticeElements,
              language: input.language,
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
    .query(async ({ input, ctx }) => {
      return getFsmCaseStore().getCase<NoticeConsentCase>(
        callerTenant(ctx),
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
      /** W4-F3: rescheduled service date for the NOTICE_EXPIRED guard. */
      currentServiceAt: z.coerce.date().optional(),
      /** W4-F3: loose dispute linkage carried onto the consent.revoked event. */
      linkedDisputeId: idSchema.optional(),
      idempotencyKey: idempotencyKeySchema,
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const tenantId = callerTenant(ctx);
        const result = await getFsmCaseStore().transitionCase<NoticeConsentCase>(
          tenantId,
          CASE_TYPE,
          input.caseId,
          {
            apply: (current) =>
              transition(reviveCase(current), input.to, {
                now: input.now,
                currentServiceAt: input.currentServiceAt,
              }),
            terminalStates: TERMINAL_STATES,
            idempotencyKey: input.idempotencyKey,
            now: input.now,
          }
        );
        // W4-F3: bus events for downstream consumers (balance-billing
        // prohibition flagging, notification fan-out). Publish AFTER the CAS
        // persist so the event never claims a transition that rolled back.
        if (input.to === "CONSENT_REVOKED" || input.to === "CONSENT_SIGNED") {
          const eventType = input.to === "CONSENT_REVOKED" ? "consent.revoked" : "consent.signed";
          await eventBus
            .publish(eventType, input.caseId, "notice-consent-case", {
              tenantId,
              caseId: input.caseId,
              revokedAt: input.to === "CONSENT_REVOKED" ? (input.now ?? new Date()).toISOString() : undefined,
              ownerUserId: ctx.user.id,
              linkedDisputeId: input.linkedDisputeId,
            }, { userId: ctx.user.id, timestamp: new Date().toISOString(), source: "notice-consent" })
            .catch((err: unknown) => {
              console.error(`[notice-consent] ${eventType} publish failed:`, err);
            });
        }
        return result;
      } catch (err) {
        toTrpcError(err);
      }
    }),

  /**
   * W4-F3: record a service reschedule. Updates the case's current
   * timing.serviceAt; the noticed date (frozen at NOTICE_DELIVERED) is
   * untouched, so a reschedule beyond the noticed window becomes detectable
   * by the expiry sweep / NOTICE_EXPIRED guard.
   */
  rescheduleService: protectedProcedure
    .input(z.object({
      caseId: idSchema,
      newServiceAt: z.coerce.date(),
      idempotencyKey: idempotencyKeySchema,
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await getFsmCaseStore().transitionCase<NoticeConsentCase>(
          callerTenant(ctx),
          CASE_TYPE,
          input.caseId,
          {
            apply: (current) => {
              const revived = reviveCase(current);
              if (revived.state !== "NOTICE_DELIVERED" && revived.state !== "CONSENT_SIGNED") {
                throw new Error(`Cannot reschedule from state ${revived.state}`);
              }
              return {
                ...revived,
                timing: { ...revived.timing, serviceAt: input.newServiceAt },
              };
            },
            terminalStates: TERMINAL_STATES,
            idempotencyKey: input.idempotencyKey,
          }
        );
      } catch (err) {
        toTrpcError(err);
      }
    }),

  /**
   * W4-F4: issue a patient-portal consent-signature link. Creates a
   * patient_access_tokens row with scope 'consent_sign' bound to the case
   * (disputeId slot carries `nc:<caseId>` — documented seam). The raw token
   * is returned exactly once; only its sha256 hash persists.
   */
  issueSignatureLink: protectedProcedure
    .input(z.object({
      caseId: idSchema,
      patientName: z.string().min(1).max(255),
      email: z.string().email().max(320).optional(),
      phone: z.string().max(32).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const stored = await getFsmCaseStore().getCase<NoticeConsentCase>(
        callerTenant(ctx),
        CASE_TYPE,
        input.caseId
      );
      if (!stored) {
        throw new TRPCError({ code: "NOT_FOUND", message: `No notice-consent case ${input.caseId}` });
      }
      if (stored.state !== "NOTICE_DELIVERED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Signature links can only be issued in NOTICE_DELIVERED (current: ${stored.state})`,
        });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const token = crypto.randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + CONSENT_SIGNATURE_LINK_TTL_MS);
      await db.insert(patientAccessTokens).values({
        id: crypto.randomUUID(),
        tokenHash: hashPatientToken(token),
        disputeId: tokenCaseRef(input.caseId),
        patientName: input.patientName,
        email: input.email ?? null,
        phone: input.phone ?? null,
        scope: CONSENT_SIGN_SCOPE,
        expiresAt,
        createdByUserId: ctx.user.id,
      });
      return { token, expiresAt, path: `/patient/consent-sign/${token}` };
    }),

  /**
   * W4-F4: PUBLIC patient e-signature capture. Validates the consent_sign
   * token (single-use), records a tamper-evident signature artifact
   * (sha256 of {caseId, signerName, timestamp, ip?}) into the case metadata
   * + consent_signatures table, and transitions the case to CONSENT_SIGNED
   * with the full guard suite (waiver, timing, retention).
   */
  patientSignConsent: publicProcedure
    .input(z.object({
      token: z.string().min(1).max(256),
      signerName: z.string().min(1).max(255),
      attestation: z.boolean().refine((v) => v === true, {
        message: "attestation must be true to sign",
      }),
      signatureText: z.string().min(1).max(255),
    }))
    .mutation(async ({ input, ctx }) => {
      const { db, tokenRow } = await assertConsentSignToken(input.token);
      const now = new Date();
      // Tenant binding: the token issuer's tenant. Tokens are single-tenant
      // because issueSignatureLink stores createdByUserId; recover it.
      const issuerRows = await db
        .select({ createdByUserId: patientAccessTokens.createdByUserId })
        .from(patientAccessTokens)
        .where(eq(patientAccessTokens.tokenHash, hashPatientToken(input.token)))
        .limit(1);
      const tenantId = `tenant:${issuerRows[0]?.createdByUserId ?? ""}`;

      const ip =
        (ctx as unknown as { req?: { headers?: Record<string, unknown>; ip?: string } }).req
          ?.headers?.["x-forwarded-for"] as string | undefined ??
        (ctx as unknown as { req?: { ip?: string } }).req?.ip;

      const artifact = buildSignatureArtifact({
        caseId: tokenRow.caseId,
        signerName: input.signerName,
        signatureText: input.signatureText,
        attestation: input.attestation,
        timestamp: now,
        ip: typeof ip === "string" ? ip.split(",")[0].trim() : undefined,
      });

      let stored;
      try {
        stored = await getFsmCaseStore().transitionCase<NoticeConsentCase>(
          tenantId,
          CASE_TYPE,
          tokenRow.caseId,
          {
            apply: (current) => {
              const revived = reviveCase(current);
              const signed = transition(
                {
                  ...revived,
                  timing: { ...revived.timing, consentSignedAt: now },
                },
                "CONSENT_SIGNED",
                { now },
              );
              // Record the artifact into the case metadata; the hash also
              // lands in the transition event detail via the store chain.
              return {
                ...signed,
                events: signed.events.map((e, i) =>
                  i === signed.events.length - 1
                    ? { ...e, detail: `${e.detail ?? ""} | signatureArtifact:${artifact.artifactHash}` }
                    : e,
                ),
                signatureArtifact: artifact,
              } as NoticeConsentCase;
            },
            terminalStates: TERMINAL_STATES,
            idempotencyKey: `consent-sign:${tokenRow.id}`,
            now,
          }
        );
      } catch (err) {
        toTrpcError(err);
      }

      // Single-use: stamp the token only AFTER the transition succeeded.
      await db
        .update(patientAccessTokens)
        .set({ usedAt: now })
        .where(eq(patientAccessTokens.id, tokenRow.id));

      const events = await getFsmCaseStore().getEventLog(tenantId, CASE_TYPE, tokenRow.caseId);
      const prevHash = events.length > 0 ? events[events.length - 1].eventHash : "0".repeat(64);
      await persistSignatureArtifact(db, tenantId, artifact, prevHash);

      await eventBus
        .publish("consent.signed", tokenRow.caseId, "notice-consent-case", {
          tenantId,
          caseId: tokenRow.caseId,
          signerName: input.signerName,
          artifactHash: artifact.artifactHash,
        }, { timestamp: now.toISOString(), source: "patient-portal" })
        .catch(() => {});

      return {
        caseId: tokenRow.caseId,
        state: stored!.state,
        artifactHash: artifact.artifactHash,
        signedAt: now.toISOString(),
      };
    }),

  /** Append-only hash-chained event log + tamper-evident chain verification. */
  getEvents: protectedProcedure
    .input(z.object({ tenantId: tenantIdSchema, caseId: idSchema }))
    .query(async ({ input, ctx }) => {
      const store = getFsmCaseStore();
      const events = await store.getEventLog(callerTenant(ctx), CASE_TYPE, input.caseId);
      const verification = await store.verifyEventChain(callerTenant(ctx), CASE_TYPE, input.caseId);
      return { events, verification };
    }),
});

export type NoticeConsentRouter = typeof noticeConsentRouter;
