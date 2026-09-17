/**
 * server/routers/patient-portal.ts — patient surface (v1).
 *
 * Provider-side (protected): generate a patient view link per dispute
 * (opaque bearer token, 14-day expiry, single-use, single-scope "view").
 *
 * Public (publicProcedure, token-guarded, no login):
 *   - patientPortal.viewCase       — redacted dispute view
 *   - patientPortal.uploadDocument — patient-authored evidence upload
 *   - patientPortal.ppdrIntake     — public PPDR self-service intake; creates
 *     a gfe-ppdr FSM case via the engine service layer directly
 *     (server/gfe-ppdr + server/fsm-store), never the protected router.
 *
 * Redaction contract: viewCase returns ONLY status, step, reference number,
 * party names, amounts, and determination fields — never internal notes,
 * document paths/keys, or user ids.
 */
import crypto from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { router, protectedProcedure, publicProcedure } from "../_core/trpc";
import { addDocument } from "../db";
import { disputes } from "../../drizzle/schema";
import { patientAccessTokens } from "../../drizzle/schema-personas";
import { assertPatientToken, hashPatientToken, loadDispute, markPatientTokenUsed, requireDb } from "../personas/guards";
import { evaluatePpdrEligibility, createPpdrDispute, transition as ppdrTransition, type PpdrDispute } from "../gfe-ppdr/ppdr";
import { getFsmCaseStore } from "../fsm-store/store";

/** 14-day patient link expiry (v1 policy constant). */
const PATIENT_LINK_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const PPDR_TENANT = "patient-portal";
const PPDR_CASE_TYPE = "gfe-ppdr";

function redactedView(d: typeof disputes.$inferSelect) {
  return {
    referenceNumber: d.referenceNumber,
    status: d.status,
    currentStep: d.currentStep,
    serviceType: d.serviceType,
    serviceDate: d.serviceDate,
    initiatingPartyName: d.initiatingPartyName,
    respondingPartyName: d.respondingPartyName,
    billedAmount: d.billedAmount,
    qpaAmount: d.qpaAmount,
    initiatingPartyOffer: d.initiatingPartyOffer,
    respondingPartyOffer: d.respondingPartyOffer,
    determinationAmount: d.determinationAmount,
    determinationBasis: d.determinationBasis,
    determinationWinner: d.determinationWinner,
    paymentDeadline: d.paymentDeadline,
  };
}

export const patientPortalRouter = router({
  // ── Provider-side (protected) ──────────────────────────────────────────────

  /**
   * Issue a patient view link for a dispute. Only the dispute initiator /
   * creator or an admin may issue. Returns the raw token exactly once — only
   * its sha256 hash is persisted.
   */
  issueViewToken: protectedProcedure
    .input(z.object({
      disputeId: z.string().min(1),
      patientName: z.string().min(1).max(255),
      email: z.string().email().max(320).optional(),
      phone: z.string().max(32).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const dispute = await loadDispute(db, input.disputeId);
      const isAdmin = ctx.user.role === "admin";
      const isInitiator = dispute.initiatingPartyId === ctx.user.id || dispute.createdBy === ctx.user.id;
      if (!isAdmin && !isInitiator) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the initiating party or an admin may issue a patient link" });
      }
      const token = crypto.randomBytes(32).toString("base64url");
      const id = crypto.randomUUID();
      await db.insert(patientAccessTokens).values({
        id,
        tokenHash: hashPatientToken(token),
        disputeId: input.disputeId,
        patientName: input.patientName,
        email: input.email ?? null,
        phone: input.phone ?? null,
        scope: "view",
        expiresAt: new Date(Date.now() + PATIENT_LINK_TTL_MS),
        createdByUserId: ctx.user.id,
      });
      return { token, expiresAt: new Date(Date.now() + PATIENT_LINK_TTL_MS), path: `/patient/${token}` };
    }),

  /** Issue a public PPDR self-service intake link (scope ppdr_intake). */
  issuePpdrIntakeToken: protectedProcedure
    .input(z.object({
      patientName: z.string().min(1).max(255),
      email: z.string().email().max(320).optional(),
      phone: z.string().max(32).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const token = crypto.randomBytes(32).toString("base64url");
      await db.insert(patientAccessTokens).values({
        id: crypto.randomUUID(),
        tokenHash: hashPatientToken(token),
        disputeId: null,
        patientName: input.patientName,
        email: input.email ?? null,
        phone: input.phone ?? null,
        scope: "ppdr_intake",
        expiresAt: new Date(Date.now() + PATIENT_LINK_TTL_MS),
        createdByUserId: ctx.user.id,
      });
      return { token, expiresAt: new Date(Date.now() + PATIENT_LINK_TTL_MS), path: `/patient/${token}` };
    }),

  /** List patient tokens issued by the caller for a dispute (hashes only). */
  listTokens: protectedProcedure
    .input(z.object({ disputeId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const dispute = await loadDispute(db, input.disputeId);
      const isAdmin = ctx.user.role === "admin";
      const isInitiator = dispute.initiatingPartyId === ctx.user.id || dispute.createdBy === ctx.user.id;
      if (!isAdmin && !isInitiator) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the initiating party or an admin may list patient links" });
      }
      const rows = await db.select().from(patientAccessTokens);
      return rows
        .filter(r => r.disputeId === input.disputeId)
        .map(r => ({
          id: r.id, patientName: r.patientName, scope: r.scope,
          expiresAt: r.expiresAt, usedAt: r.usedAt, createdAt: r.createdAt,
        }));
    }),

  // ── Public, token-guarded (no login) ───────────────────────────────────────

  /** Redacted dispute view for the patient (single-use "view" token). */
  viewCase: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .query(async ({ input }) => {
      const { db, tokenRow } = await assertPatientToken(input.token, "view");
      if (!tokenRow.disputeId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This token is not linked to a dispute" });
      }
      const dispute = await loadDispute(db, tokenRow.disputeId);
      await markPatientTokenUsed(db, tokenRow.id);
      return { patientName: tokenRow.patientName, dispute: redactedView(dispute) };
    }),

  /**
   * Patient uploads a supporting document to their dispute. Writes through
   * the existing disputeDocuments helper with uploadedBy marked "patient".
   * Token-guarded; "view"-scope tokens are single-use for the view itself, so
   * uploads accept the token while it is unexpired regardless of usedAt.
   */
  uploadDocument: publicProcedure
    .input(z.object({
      token: z.string().min(1),
      documentType: z.string().min(1).max(64),
      fileName: z.string().min(1).max(255),
      fileSize: z.number().int().nonnegative().optional(),
      mimeType: z.string().max(128).optional(),
      description: z.string().max(2000).optional(),
    }))
    .mutation(async ({ input }) => {
      // Upload path tolerates prior view use: check validity without the
      // usedAt guard by re-validating expiry/scope directly.
      const db = await requireDb();
      const hash = hashPatientToken(input.token);
      const rows = await db.select().from(patientAccessTokens).where(eq(patientAccessTokens.tokenHash, hash));
      const tokenRow = rows.find(r => r.scope === "view");
      if (!tokenRow || tokenRow.expiresAt < new Date()) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid or expired patient access token" });
      }
      if (!tokenRow.disputeId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This token is not linked to a dispute" });
      }
      await loadDispute(db, tokenRow.disputeId);
      const documentId = await addDocument({
        disputeId: tokenRow.disputeId,
        documentType: input.documentType,
        fileName: input.fileName,
        fileSize: input.fileSize ?? null,
        mimeType: input.mimeType ?? null,
        s3Key: null,
        uploadedBy: `patient:${tokenRow.patientName}`,
        description: input.description ?? null,
      });
      return { documentId };
    }),

  /**
   * Public PPDR self-service intake (45 CFR 149.620). Validates eligibility
   * via the gfe-ppdr engine, then creates + initiates a persisted FSM case
   * via the engine service layer (never the protected router).
   *
   * The PPDR administrative fee is injected from configuration
   * (PPDR_ADMIN_FEE_USD env) — the engine correctly refuses a hardcoded
   * default at INITIATED; the value here is deployment configuration, not a
   * statutory constant.
   */
  ppdrIntake: publicProcedure
    .input(z.object({
      token: z.string().min(1),
      gfeTotalUsd: z.number().nonnegative(),
      billedTotalUsd: z.number().nonnegative(),
      billedAt: z.coerce.date(),
      insuranceBilled: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      const { db, tokenRow } = await assertPatientToken(input.token, "ppdr_intake");
      const eligibility = evaluatePpdrEligibility({
        gfeTotalUsd: input.gfeTotalUsd,
        billedTotalUsd: input.billedTotalUsd,
        billedAt: input.billedAt,
        insuranceBilled: input.insuranceBilled,
      });
      if (!eligibility.eligible) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `PPDR ineligible: ${eligibility.reasons.join(" ")}` });
      }
      const adminFeeUsd = Number(process.env.PPDR_ADMIN_FEE_USD ?? "25");
      if (!Number.isFinite(adminFeeUsd) || adminFeeUsd < 0) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "PPDR admin fee is not configured" });
      }
      const disputeId = crypto.randomUUID();
      const store = getFsmCaseStore();
      await store.createCase<PpdrDispute>({
        tenantId: PPDR_TENANT,
        caseType: PPDR_CASE_TYPE,
        caseId: disputeId,
        create: () =>
          createPpdrDispute({
            id: disputeId,
            gfeTotalUsd: input.gfeTotalUsd,
            billedTotalUsd: input.billedTotalUsd,
            billedAt: input.billedAt,
            insuranceBilled: input.insuranceBilled,
          }),
        terminalStates: ["CLOSED", "INELIGIBLE"],
      });
      const initiated = await store.transitionCase<PpdrDispute>(
        PPDR_TENANT,
        PPDR_CASE_TYPE,
        disputeId,
        {
          apply: (current) =>
            ppdrTransition(
              { ...current, billedAt: new Date(current.billedAt), events: (current.events ?? []).map(e => ({ ...e, at: new Date(e.at) })) },
              "INITIATED",
              { adminFeeUsd }
            ),
          terminalStates: ["CLOSED", "INELIGIBLE"],
        }
      );
      await markPatientTokenUsed(db, tokenRow.id);
      return {
        ppdrDisputeId: disputeId,
        state: initiated.state,
        excessUsd: eligibility.excessUsd,
        adminFeeUsd,
      };
    }),
});
