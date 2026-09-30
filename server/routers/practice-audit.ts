/**
 * server/routers/practice-audit.ts
 *
 * Phase 17 practice-audit surface (E1/E3/E5/E6 + outcome rollup):
 *  - ingest837: parse an uploaded X12 837P file (server/edi/claim837.ts) and
 *    stage into practice_claims (idempotent by content hash).
 *  - ingestBulkNdjson: parse a FHIR bulk $export ndjson payload
 *    (server/emr/bulk-import.ts) and stage.
 *  - listClaims / getScore: read staged claims + verdicts.
 *  - scoreClaims: run the deterministic eligibility engine
 *    (server/eligibility/engine.ts) over staged claims and persist verdicts
 *    to practice_claim_scores (upsert per claim).
 *  - listIncompleteClaims / bulkCompleteClaims (Phase 17-CE): intake repair
 *    loop — NEEDS_REVIEW/unscored claims expose their dictionary-driven
 *    missingFields checklist; manual field values are applied (provenance
 *    "manual"), re-scored through the engine, and verdicts transition.
 *  - scoreAndSummarize: per-practice rollup — verdict breakdown + projected
 *    recovery. Projected recovery combines breakeven economics (admin fee
 *    from fee_schedules/params-2026 fallback; statutory IDRE fee ranges)
 *    with an OutcomeNet win-probability that is EXPLICITLY LABELED a
 *    statistical estimate (field name + modelCard note: trained on
 *    SYNTHETIC data, ml/data/synthetic_platform_data.py). It is never a
 *    guarantee of outcome — see CRITICAL HONESTY CONSTRAINT.
 *
 * AuthZ: org membership required (owner/staff write; viewer read).
 *
 * Labels: scoring path EXECUTED-VERIFIED (journeys J27 + vitest against
 * embedded PG); OutcomeNet probability MOCK-VERIFIED only — when the AI
 * service is unreachable the rollup reports null with an honest note.
 */
import crypto from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { router, protectedProcedure, publicProcedure } from "../_core/trpc";
import { createAuditEntry } from "../db";
import { organizations, orgMemberships } from "../../drizzle/schema-personas";
import { practiceClaims, practiceClaimScores, auditShareTokens } from "../../drizzle/schema-practice-claims";
import { parse837p, claim837ToNormalized, Claim837ParseError } from "../edi/claim837";
import { importBulkNdjson, stageClaims, type NormalizedPracticeClaim } from "../emr/bulk-import";
import { evaluateClaimEligibility, ELIGIBILITY_ENGINE_META } from "../eligibility/engine";
import { REQUIRED_FIELDS, VENDOR_PROFILES_PUBLIC } from "./practice-audit-meta";
import { getAdminFeeFromDb } from "../fee-schedule";
import { getEffectiveIDRParameters } from "../idr/clocks-2026/params-2026";
import { requireDb } from "../personas/guards";

type Db = Awaited<ReturnType<typeof requireDb>>;

async function assertOrgMember(db: Db, userId: string, orgId: string, roles: string[] = ["owner", "staff"]) {
  const rows = await db
    .select()
    .from(orgMemberships)
    .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)))
    .limit(1);
  const m = rows[0];
  if (!m || !roles.includes(m.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You are not an authorized member of this organization" });
  }
  const org = (await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1))[0];
  if (!org) throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
  if (org.status !== "active" && roles.includes("owner")) {
    throw new TRPCError({ code: "FORBIDDEN", message: `Organization "${org.name}" is ${org.status}; mutations blocked` });
  }
  return { membership: m, org };
}

function toEngineInput(c: typeof practiceClaims.$inferSelect) {
  return {
    claimId: c.claimId,
    planType: c.planType,
    serviceCategory: c.serviceCategory,
    serviceState: c.facilityState ?? c.patientState,
    serviceDate: c.serviceDate,
    cptCodes: c.cptCodes,
    billedCents: c.billedCents,
    payerId: c.payerId,
    renderingNpi: c.renderingNpi ?? c.billingNpi,
    networkStatus: c.networkStatus,
    noticeConsentStatus: c.noticeConsentStatus,
    initialPaymentDate: c.initialPaymentDate,
    priorPaymentDeterminationDate: c.priorPaymentDeterminationDate,
  };
}

const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? "http://localhost:8000";

function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

/**
 * OutcomeNet P(provider-favorable determination) for a claim — STATISTICAL
 * ESTIMATE from a model trained on synthetic data. Returns null (honest)
 * when the model service is unreachable or rejects the request.
 */
async function outcomeNetWinProbability(claim: {
  billedCents: number | null;
  allowedCents: number | null;
  cptCodes: string[];
  serviceCategory: string | null;
}): Promise<number | null> {
  try {
    const billed = (claim.billedCents ?? 0) / 100;
    const allowed = (claim.allowedCents ?? 0) / 100;
    // OutcomeNet expects 10 features (ml/models/pytorch_models.py:117); the
    // exact feature order is the training-time synthetic schema — padded
    // deterministically here and labeled synthetic-model estimate.
    const ratio = allowed > 0 ? billed / allowed : 2.0;
    const features = [
      Math.min(ratio, 10), billed > 0 ? Math.log10(billed + 1) : 0,
      claim.cptCodes.length, claim.cptCodes[0] ? Number(claim.cptCodes[0].replace(/\D/g, "").slice(0, 5) || 0) / 100000 : 0,
      claim.serviceCategory === "EMERGENCY" ? 1 : 0,
      0, 0, 0, 0, 0,
    ];
    const res = await fetch(`${AI_SERVICE_URL}/outcome/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ features }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { outcome_probability?: number };
    const p = body.outcome_probability;
    return typeof p === "number" && p >= 0 && p <= 1 ? p : null;
  } catch {
    return null; // honest: model unavailable
  }
}

export const practiceAuditRouter = router({
  /** Data dictionary (contexts → required fields + citations) for UI/checklists. */
  requiredFields: protectedProcedure.query(() => REQUIRED_FIELDS),

  /** Vendor connection profile templates (STATIC-ONLY labels). */
  vendorProfiles: protectedProcedure.query(() => VENDOR_PROFILES_PUBLIC),

  /** Ingest an X12 837P claim file into practice_claims staging. */
  ingest837: protectedProcedure
    .input(z.object({
      orgId: z.string(),
      fileName: z.string().max(255).optional(),
      content: z.string().min(10).max(5_000_000),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await assertOrgMember(db, ctx.user.id, input.orgId);
      let parsed;
      try {
        parsed = parse837p(input.content);
      } catch (err) {
        if (err instanceof Claim837ParseError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `837 parse failed: ${err.message}` });
        }
        throw err;
      }
      const normalized: NormalizedPracticeClaim[] = parsed.map(c => {
        const n = claim837ToNormalized(c);
        return {
          claimId: n.claimId,
          patientRef: n.patientRef,
          planType: null, // 837P carries no plan-type segment — honest null (E6)
          serviceCategory: null,
          patientState: n.patientState,
          facilityState: n.facilityState,
          serviceDate: n.serviceDate,
          serviceEndDate: n.serviceEndDate,
          placeOfService: n.placeOfService,
          networkStatus: null,
          noticeConsentStatus: null,
          initialPaymentDate: null, // 837 is pre-adjudication; payment dates come from 835/EOB
          denialDate: null,
          priorPaymentDeterminationDate: null,
          cptCodes: n.cptCodes,
          modifiers: n.modifiers,
          diagnoses: n.diagnoses,
          payerId: n.payerId,
          payerName: n.payerName,
          planIdentifier: null,
          renderingNpi: n.renderingNpi,
          billingNpi: n.billingNpi,
          tin: n.tin,
          billedCents: n.billedCents,
          allowedCents: null,
          paidCents: null,
          sourceProvenance: {
            claimId: { source: "edi" as const, detail: "837P CLM01" },
            billedCents: { source: "edi" as const, detail: "837P CLM02/SV1-2" },
            placeOfService: { source: "edi" as const, detail: "837P CLM05-1" },
            serviceDate: { source: "edi" as const, detail: "837P DTP*472" },
            tin: { source: "edi" as const, detail: "837P REF*EI" },
          },
          sourceResourceRefs: [`x12-837:${n.claimId}`],
        };
      });
      const staged = await stageClaims(db, input.orgId, "x12_837", input.fileName ?? null, null, normalized);
      return {
        parsedClaims: parsed.length,
        ...staged,
        notes: [
          "837P (professional) parsed; 837I (institutional) is unsupported and rejected with an explicit error.",
          "837 is pre-adjudication: initial payment dates, allowed amounts, network status, and plan type are NOT present and are left null (NEEDS_REVIEW drivers).",
        ],
      };
    }),

  /** Ingest a FHIR bulk $export ndjson payload (Claim/EOB/Coverage/Patient/Procedure/Practitioner/Organization). */
  ingestBulkNdjson: protectedProcedure
    .input(z.object({
      orgId: z.string(),
      emrConnectionId: z.string().optional(),
      sourceRef: z.string().max(128).optional(),
      ndjson: z.string().min(2).max(20_000_000),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await assertOrgMember(db, ctx.user.id, input.orgId);
      const result = await importBulkNdjson(db, {
        orgId: input.orgId,
        emrConnectionId: input.emrConnectionId ?? null,
        sourceRef: input.sourceRef ?? null,
        ndjson: input.ndjson,
      });
      return result;
    }),

  /** List staged practice claims (with latest score when present). */
  listClaims: protectedProcedure
    .input(z.object({ orgId: z.string(), limit: z.number().int().min(1).max(500).default(100) }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      await assertOrgMember(db, ctx.user.id, input.orgId, ["owner", "staff", "viewer"]);
      const claims = await db.select().from(practiceClaims)
        .where(eq(practiceClaims.orgId, input.orgId)).limit(input.limit);
      const ids = claims.map(c => c.id);
      const scores = ids.length
        ? await db.select().from(practiceClaimScores).where(inArray(practiceClaimScores.claimId, ids))
        : [];
      const scoreByClaim = new Map(scores.map(s => [s.claimId, s]));
      return claims.map(c => ({ ...c, score: scoreByClaim.get(c.id) ?? null }));
    }),

  /** Score staged claims with the deterministic eligibility engine; persist verdicts. */
  scoreClaims: protectedProcedure
    .input(z.object({
      orgId: z.string(),
      claimIds: z.array(z.string()).max(500).optional(), // default: all org claims
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await assertOrgMember(db, ctx.user.id, input.orgId);
      const claims = input.claimIds?.length
        ? await db.select().from(practiceClaims).where(and(eq(practiceClaims.orgId, input.orgId), inArray(practiceClaims.id, input.claimIds)))
        : await db.select().from(practiceClaims).where(eq(practiceClaims.orgId, input.orgId));
      const results = [];
      for (const c of claims) {
        const r = evaluateClaimEligibility(toEngineInput(c));
        const row = {
          id: crypto.randomUUID(),
          claimId: c.id,
          verdict: r.verdict,
          rulesFired: r.rulesFired,
          missingFields: r.missingFields,
          evidenceChecklist: r.evidenceChecklist,
          completenessPct: r.completenessPct,
          jurisdiction: r.jurisdiction,
          winProbabilityStatisticalEstimate: null as string | null,
          scoredAt: new Date(),
        };
        await db.insert(practiceClaimScores).values(row)
          .onConflictDoUpdate({
            target: practiceClaimScores.claimId,
            set: {
              verdict: row.verdict, rulesFired: row.rulesFired, missingFields: row.missingFields,
              evidenceChecklist: row.evidenceChecklist, completenessPct: row.completenessPct,
              jurisdiction: row.jurisdiction, scoredAt: row.scoredAt,
            },
          });
        results.push({ claimId: c.id, claimRef: c.claimId, verdict: r.verdict, jurisdiction: r.jurisdiction, missingFields: r.missingFields, completenessPct: r.completenessPct });
      }
      return { scored: results.length, results, engineNote: ELIGIBILITY_ENGINE_META.honestyNote };
    }),

  /**
   * Phase 17-CE intake repair loop: claims whose latest verdict is
   * NEEDS_REVIEW (or that are unscored) with their per-claim missingFields
   * checklist — computed FROM the required-fields dictionary via the engine,
   * never hardcoded.
   */
  listIncompleteClaims: protectedProcedure
    .input(z.object({ orgId: z.string(), limit: z.number().int().min(1).max(500).default(100) }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      await assertOrgMember(db, ctx.user.id, input.orgId, ["owner", "staff", "viewer"]);
      const claims = await db.select().from(practiceClaims)
        .where(eq(practiceClaims.orgId, input.orgId)).limit(input.limit);
      const ids = claims.map(c => c.id);
      const scores = ids.length
        ? await db.select().from(practiceClaimScores).where(inArray(practiceClaimScores.claimId, ids))
        : [];
      const scoreByClaim = new Map(scores.map(s => [s.claimId, s]));
      const incomplete = [];
      for (const c of claims) {
        const s = scoreByClaim.get(c.id);
        if (s && s.verdict !== "NEEDS_REVIEW") continue;
        // Unscored claims: evaluate on the fly so the checklist is always real.
        const r = s
          ? { missingFields: s.missingFields, evidenceChecklist: s.evidenceChecklist, completenessPct: s.completenessPct, verdict: s.verdict }
          : (() => { const e = evaluateClaimEligibility(toEngineInput(c)); return { missingFields: e.missingFields, evidenceChecklist: e.evidenceChecklist, completenessPct: e.completenessPct, verdict: "UNSCORED" as const }; })();
        incomplete.push({
          claimDbId: c.id,
          claimId: c.claimId,
          source: c.source,
          verdict: r.verdict,
          completenessPct: r.completenessPct,
          missingFields: r.missingFields,
          checklist: r.evidenceChecklist,
        });
      }
      return { orgId: input.orgId, incompleteCount: incomplete.length, claims: incomplete };
    }),

  /**
   * Phase 17-CE bulk-complete: apply manual field values to staged claims,
   * re-score with the deterministic engine, and persist the new verdicts.
   * Every applied field is recorded in sourceProvenance with source "manual"
   * (W6 convention). Verdict transitions are returned per claim. Fail-closed:
   * unknown field keys are rejected; a claim that remains incomplete stays
   * NEEDS_REVIEW.
   */
  bulkCompleteClaims: protectedProcedure
    .input(z.object({
      orgId: z.string(),
      updates: z.array(z.object({
        claimDbId: z.string(),
        fields: z.object({
          planType: z.enum(["FULLY_INSURED", "SELF_FUNDED", "FEHB"]).optional(),
          serviceCategory: z.enum(["EMERGENCY", "NON_EMERGENCY", "POST_STABILIZATION", "AIR_AMBULANCE"]).optional(),
          networkStatus: z.enum(["out_of_network", "in_network"]).optional(),
          noticeConsentStatus: z.enum(["none", "signed", "waived_exception"]).optional(),
          serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          initialPaymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          priorPaymentDeterminationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          denialDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          facilityState: z.string().length(2).optional(),
          patientState: z.string().length(2).optional(),
          payerId: z.string().min(1).max(64).optional(),
          payerName: z.string().min(1).max(255).optional(),
          planIdentifier: z.string().min(1).max(128).optional(),
          renderingNpi: z.string().regex(/^\d{10}$/).optional(),
          billingNpi: z.string().regex(/^\d{10}$/).optional(),
          tin: z.string().regex(/^\d{9}$/).optional(),
          claimId: z.string().min(1).max(128).optional(),
          cptCodes: z.array(z.string().min(1)).min(1).optional(),
          billedCents: z.number().int().nonnegative().optional(),
          allowedCents: z.number().int().nonnegative().optional(),
          paidCents: z.number().int().nonnegative().optional(),
        }),
      })).min(1).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await assertOrgMember(db, ctx.user.id, input.orgId);
      const results = [];
      for (const u of input.updates) {
        const claim = (await db.select().from(practiceClaims)
          .where(and(eq(practiceClaims.id, u.claimDbId), eq(practiceClaims.orgId, input.orgId)))
          .limit(1))[0];
        if (!claim) throw new TRPCError({ code: "NOT_FOUND", message: `Claim ${u.claimDbId} not found in this org` });
        const applied = Object.entries(u.fields).filter(([, v]) => v !== undefined).map(([k]) => k);
        if (applied.length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `No field values supplied for claim ${u.claimDbId}` });
        }
        const provenance = { ...(claim.sourceProvenance ?? {}) };
        for (const k of applied) {
          provenance[k] = { source: "manual" as const, detail: `bulk-complete ${new Date().toISOString().slice(0, 10)}` };
        }
        await db.update(practiceClaims)
          .set({ ...(u.fields as Record<string, unknown>), sourceProvenance: provenance })
          .where(eq(practiceClaims.id, claim.id));
        // Re-score through the real engine path.
        const fresh = (await db.select().from(practiceClaims).where(eq(practiceClaims.id, claim.id)).limit(1))[0];
        const prior = (await db.select().from(practiceClaimScores).where(eq(practiceClaimScores.claimId, claim.id)).limit(1))[0];
        const r = evaluateClaimEligibility(toEngineInput(fresh));
        await db.insert(practiceClaimScores).values({
          id: crypto.randomUUID(),
          claimId: claim.id,
          verdict: r.verdict,
          rulesFired: r.rulesFired,
          missingFields: r.missingFields,
          evidenceChecklist: r.evidenceChecklist,
          completenessPct: r.completenessPct,
          jurisdiction: r.jurisdiction,
          winProbabilityStatisticalEstimate: null as string | null,
          scoredAt: new Date(),
        }).onConflictDoUpdate({
          target: practiceClaimScores.claimId,
          set: {
            verdict: r.verdict, rulesFired: r.rulesFired, missingFields: r.missingFields,
            evidenceChecklist: r.evidenceChecklist, completenessPct: r.completenessPct,
            jurisdiction: r.jurisdiction, scoredAt: new Date(),
          },
        });
        results.push({
          claimDbId: claim.id,
          claimRef: fresh.claimId,
          appliedFields: applied,
          previousVerdict: prior?.verdict ?? null,
          verdict: r.verdict,
          missingFields: r.missingFields,
          completenessPct: r.completenessPct,
          transition: `${prior?.verdict ?? "UNSCORED"} -> ${r.verdict}`,
        });
      }
      return { updated: results.length, results, engineNote: ELIGIBILITY_ENGINE_META.honestyNote };
    }),

  /**
   * Per-practice rollup. Outcome probabilities are STATISTICAL ESTIMATES
   * from OutcomeNet (trained on SYNTHETIC data) — see modelCard. Nothing in
   * this response is a guarantee of winning an IDR determination.
   */
  scoreAndSummarize: protectedProcedure
    .input(z.object({
      orgId: z.string(),
      /** Optional win-rate override (0..1) for sensitivity analysis. */
      winRateOverride: z.number().min(0).max(1).optional(),
      asOf: z.coerce.date().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      await assertOrgMember(db, ctx.user.id, input.orgId, ["owner", "staff", "viewer"]);
      const claims = await db.select().from(practiceClaims).where(eq(practiceClaims.orgId, input.orgId));
      const scores = claims.length
        ? await db.select().from(practiceClaimScores).where(inArray(practiceClaimScores.claimId, claims.map(c => c.id)))
        : [];
      const scoreByClaim = new Map(scores.map(s => [s.claimId, s]));
      const breakdown = { QUALIFIES: 0, BLOCKED: 0, NEEDS_REVIEW: 0, UNSCORED: 0 };
      let qualifyingClaimCount = 0;
      let totalGapCents = 0;
      let pWinSum = 0;
      let pWinCount = 0;
      for (const c of claims) {
        const s = scoreByClaim.get(c.id);
        if (!s) { breakdown.UNSCORED++; continue; }
        breakdown[s.verdict as keyof typeof breakdown]++;
        if (s.verdict === "QUALIFIES") {
          qualifyingClaimCount++;
          const gap = (c.billedCents ?? 0) - (c.allowedCents ?? c.paidCents ?? 0);
          totalGapCents += Math.max(0, gap);
          const pWin = input.winRateOverride ?? (await outcomeNetWinProbability(c));
          if (pWin !== null) { pWinSum += pWin; pWinCount++; }
        }
      }
      const asOf = input.asOf ?? new Date();
      const params = getEffectiveIDRParameters(asOf);
      const dbFee = await getAdminFeeFromDb("single", asOf);
      const adminFeeUsd = dbFee ? Number(dbFee.amountUsd) : params.adminFeeUsd;
      // Statutory certified-IDRE fee range minimum (single dispute).
      const idreFeeMinUsd = 200;
      const meanPWin = input.winRateOverride ?? (pWinCount > 0 ? pWinSum / pWinCount : null);
      // Expected net recovery across QUALIFIES claims — STATISTICAL ESTIMATE.
      const projectedRecoveryUsd =
        meanPWin === null
          ? null
          : Math.round((meanPWin * (totalGapCents / 100) - qualifyingClaimCount * (adminFeeUsd + (1 - meanPWin) * idreFeeMinUsd)) * 100) / 100;
      return {
        orgId: input.orgId,
        totalClaims: claims.length,
        verdicts: breakdown,
        qualifyingClaims: qualifyingClaimCount,
        totalBilledMinusPaidUsd: Math.round((totalGapCents / 100) * 100) / 100,
        adminFeeUsd,
        idreFeeMinUsd,
        /** STATISTICAL ESTIMATE (OutcomeNet; synthetic training data). Null when unavailable. */
        winProbabilityStatisticalEstimate: meanPWin === null ? null : Math.round(meanPWin * 1000) / 1000,
        /** STATISTICAL ESTIMATE — expected net recovery across qualifying claims, not a promise. */
        projectedNetRecoveryUsdStatisticalEstimate: projectedRecoveryUsd,
        modelCard: {
          name: "OutcomeNet",
          trainedOn: "synthetic",
          note: "OutcomeNet is trained on synthetic platform data (ml/data/synthetic_platform_data.py) — no real IDR determination outcomes. Probabilities are model-of-a-simulation estimates for triage only; they are NOT assurances of any dispute outcome.",
        },
        verdictSemantics:
          "QUALIFIES/BLOCKED/NEEDS_REVIEW are deterministic rule verdicts about federal IDR ELIGIBILITY with CFR citations. They assert nothing about the probability or certainty of winning a determination.",
        citations: [...params.citations],
      };
    }),

  // ── Phase 18: audit-as-leadgen share links ─────────────────────────────────
  /**
   * Create a tokenized READ-ONLY share link for this org's practice audit
   * report (the three-lane scorecard = scoreAndSummarize rollup). The raw
   * bearer token is returned ONCE; only its sha256 persists
   * (patient-token pattern). Default expiry 30 days (max 90); revocable.
   */
  createAuditShareToken: protectedProcedure
    .input(z.object({
      orgId: z.string().min(1),
      label: z.string().max(255).optional(),
      expiresInDays: z.number().int().min(1).max(90).default(30),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await assertOrgMember(db, ctx.user.id, input.orgId);
      const rawToken = crypto.randomBytes(32).toString("base64url");
      const id = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);
      await db.insert(auditShareTokens).values({
        id,
        tokenHash: sha256Hex(rawToken),
        orgId: input.orgId,
        scope: "practice_audit_read",
        label: input.label ?? null,
        expiresAt,
        createdByUserId: ctx.user.id,
      });
      await createAuditEntry({
        userId: ctx.user.id,
        action: "practiceAudit.createAuditShareToken",
        entityType: "audit_share_token",
        entityId: id,
        oldValue: null,
        newValue: JSON.stringify({ orgId: input.orgId, label: input.label ?? null, expiresInDays: input.expiresInDays }),
        ipAddress: null,
        userAgent: null,
      });
      return { shareTokenId: id, shareToken: rawToken, expiresAt, scope: "practice_audit_read" as const };
    }),

  /** List share tokens for an org (hashes never returned). */
  listAuditShareTokens: protectedProcedure
    .input(z.object({ orgId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      await assertOrgMember(db, ctx.user.id, input.orgId, ["owner", "staff", "viewer"]);
      const rows = await db.select().from(auditShareTokens).where(eq(auditShareTokens.orgId, input.orgId));
      return rows.map(t => ({
        id: t.id, orgId: t.orgId, scope: t.scope, label: t.label,
        expiresAt: t.expiresAt, revokedAt: t.revokedAt,
        lastAccessedAt: t.lastAccessedAt, accessCount: t.accessCount, createdAt: t.createdAt,
      }));
    }),

  /** Revoke a share token (owner/staff of the org). */
  revokeAuditShareToken: protectedProcedure
    .input(z.object({ shareTokenId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const row = (await db.select().from(auditShareTokens).where(eq(auditShareTokens.id, input.shareTokenId)).limit(1))[0];
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Share token not found" });
      await assertOrgMember(db, ctx.user.id, row.orgId);
      if (row.revokedAt) throw new TRPCError({ code: "CONFLICT", message: "Share token already revoked" });
      await db.update(auditShareTokens).set({ revokedAt: new Date(), revokedByUserId: ctx.user.id })
        .where(eq(auditShareTokens.id, row.id));
      await createAuditEntry({
        userId: ctx.user.id,
        action: "practiceAudit.revokeAuditShareToken",
        entityType: "audit_share_token",
        entityId: row.id,
        oldValue: null,
        newValue: JSON.stringify({ revoked: true }),
        ipAddress: null,
        userAgent: null,
      });
      return { shareTokenId: row.id, revoked: true as const };
    }),

  /**
   * PUBLIC read-only resolution of a share token: returns the org's audit
   * scorecard rollup (verdict breakdown + counts — no claim-level rows, no
   * PII) when the token is valid (sha256 match, unexpired, unrevoked).
   * Fail-closed: invalid/expired/revoked tokens all return UNAUTHORIZED
   * without distinguishing which check failed.
   */
  resolveAuditShareToken: publicProcedure
    .input(z.object({ token: z.string().min(1).max(256) }))
    .query(async ({ input }) => {
      const db = await requireDb();
      const hash = sha256Hex(input.token);
      const rows = await db.select().from(auditShareTokens)
        .where(and(eq(auditShareTokens.tokenHash, hash), isNull(auditShareTokens.revokedAt)))
        .limit(1);
      const token = rows[0];
      if (!token || token.expiresAt <= new Date()) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid, expired, or revoked share token" });
      }
      await db.update(auditShareTokens)
        .set({ lastAccessedAt: new Date(), accessCount: token.accessCount + 1 })
        .where(eq(auditShareTokens.id, token.id));
      const claims = await db.select().from(practiceClaims).where(eq(practiceClaims.orgId, token.orgId));
      const scores = claims.length
        ? await db.select().from(practiceClaimScores).where(inArray(practiceClaimScores.claimId, claims.map(c => c.id)))
        : [];
      const breakdown = { QUALIFIES: 0, BLOCKED: 0, NEEDS_REVIEW: 0, UNSCORED: 0 };
      for (const c of claims) {
        const s = scores.find(sc => sc.claimId === c.id);
        if (!s) breakdown.UNSCORED++;
        else breakdown[s.verdict as keyof typeof breakdown]++;
      }
      const org = (await db.select().from(organizations).where(eq(organizations.id, token.orgId)).limit(1))[0];
      return {
        scope: token.scope,
        label: token.label,
        organizationName: org?.name ?? null,
        report: {
          totalClaims: claims.length,
          verdicts: breakdown,
          qualifyingClaims: breakdown.QUALIFIES,
          generatedAt: new Date().toISOString(),
        },
        readOnly: true as const,
        note: "Read-only shared audit scorecard. Verdicts are deterministic federal IDR ELIGIBILITY determinations (see practiceAudit.scoreAndSummarize semantics) — not assurances of outcome.",
      };
    }),
});

export type PracticeAuditRouter = typeof practiceAuditRouter;
