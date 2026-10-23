/**
 * server/routers/intelligence.ts
 *
 * Phase 21: intelligence & learning loop — tRPC surface.
 *
 *   feedback.record / feedback.metrics  (S1: suggestion-feedback events)
 *   prefill.dispute / prefill.quarantineRows  (S2: eager prefill producers)
 *   offerStrategy.recommendV2           (S3: data-trained offer strategy)
 *
 * Merged in server/app-router.ts (routers.ts is a shared-ownership file).
 *
 * AuthZ: every procedure asserts org membership via the bulk-upload.ts
 * assertOrgMember precedent (owner/staff write; owner/staff/viewer read).
 * Platform-wide aggregates are read server-side only — no cross-org data is
 * ever returned to a client.
 *
 * Honesty: thin segments NEVER produce a trained-looking output — the
 * insufficient_data label is in the payload (design §4.2). Suggestion
 * events store sha256 hashes and segment keys, never values (PII-free by
 * construction; a server-side metadata denylist strips PHI-shaped keys).
 */
import crypto from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { disputes } from "../../drizzle/schema";
import { organizations, orgMemberships } from "../../drizzle/schema-personas";
import {
  suggestionEvents,
  modelVersions,
  SUGGESTION_SURFACES,
  SUGGESTION_EVENT_ACTIONS,
} from "../../drizzle/schema-intelligence";
import { claimQuarantine, bulkUploadSessions } from "../../drizzle/schema-bulk-upload";
import { submitterClients } from "../../drizzle/schema-submitter";
import { requireDb } from "../personas/guards";
import { getAdminFeeFromDb } from "../fee-schedule";
import { getEffectiveIDRParameters } from "../idr/clocks-2026/params-2026";
import {
  recommendOfferV2,
  minLeafSamples,
  MIN_MID_SAMPLES,
  MIN_PLATFORM_SAMPLES,
  type SegmentStatsV2,
  type ModelVersionBlock,
} from "../idr/offer-strategy-v2";
import { OFFER_MODEL_NAME } from "../scheduled/offerModelRefresh";

type Db = Awaited<ReturnType<typeof requireDb>>;

const READ_ROLES = ["owner", "staff", "viewer"];

/** Same membership assertion as server/routers/bulk-upload.ts:49. */
export async function assertOrgMember(db: Db, userId: string, orgId: string, roles: string[] = ["owner", "staff"]) {
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
  if (org.status !== "active") {
    throw new TRPCError({ code: "FORBIDDEN", message: `Organization "${org.name}" is ${org.status}; mutations blocked` });
  }
  return { membership: m, org };
}

/** sha256 hex helper (values are hashed, never stored). */
export function sha256Hex(value: unknown): string {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

/** Deterministic correlation hash: sha256(orgId|surface|sorted segment keys). */
export function contextHash(orgId: string, surface: string, segmentKeys: Record<string, string>): string {
  const parts = Object.keys(segmentKeys).sort().map(k => `${k}=${segmentKeys[k]}`);
  return sha256Hex([orgId, surface, ...parts].join("|"));
}

/**
 * Server-side PHI denylist for free-form metadata keys (design §10.5). Any
 * key whose lowercase form matches is stripped before insert.
 */
const PHI_METADATA_KEY_DENYLIST = [
  "patientname", "patient_name", "patient", "mrn", "medicalrecordnumber",
  "dob", "dateofbirth", "date_of_birth", "ssn", "socialsecurity",
  "claimnotes", "claim_notes", "notes", "freetext", "address", "email",
  "phone", "memberid", "member_id", "subscriberid", "subscriber_id",
];

export function stripPhiMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    const lk = k.toLowerCase().replace(/[^a-z]/g, "");
    if (PHI_METADATA_KEY_DENYLIST.includes(lk)) continue;
    // Defensive depth cap: drop nested objects beyond one level.
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      const inner: Record<string, unknown> = {};
      for (const [ik, iv] of Object.entries(v as Record<string, unknown>)) {
        const lik = ik.toLowerCase().replace(/[^a-z]/g, "");
        if (PHI_METADATA_KEY_DENYLIST.includes(lik)) continue;
        if (iv !== null && typeof iv === "object") continue;
        inner[ik] = iv;
      }
      out[k] = inner;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Insert suggestion events; terminal actions are idempotent (partial unique index). */
export async function recordSuggestionEvents(
  db: Db,
  rows: Array<{
    orgId: string;
    userId: string;
    suggestionId: string;
    surface: (typeof SUGGESTION_SURFACES)[number];
    action: (typeof SUGGESTION_EVENT_ACTIONS)[number];
    modelName: string;
    modelVersionId?: string | null;
    confidence?: number | null;
    contextHash?: string | null;
    fieldName?: string | null;
    suggestedValueHash?: string | null;
    finalValueHash?: string | null;
    keystrokeCount?: number | null;
    latencyMs?: number | null;
    metadata?: Record<string, unknown> | null;
  }>,
): Promise<number> {
  if (rows.length === 0) return 0;
  let inserted = 0;
  // Batched multi-row INSERT (design §10.1) — chunks of 200.
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200).map(r => ({
      orgId: r.orgId,
      userId: r.userId,
      suggestionId: r.suggestionId,
      surface: r.surface,
      action: r.action,
      modelName: r.modelName,
      modelVersionId: r.modelVersionId ?? null,
      confidence: r.confidence !== undefined && r.confidence !== null ? String(r.confidence) : null,
      contextHash: r.contextHash ?? null,
      fieldName: r.fieldName ?? null,
      suggestedValueHash: r.suggestedValueHash ?? null,
      finalValueHash: r.finalValueHash ?? null,
      keystrokeCount: r.keystrokeCount ?? null,
      latencyMs: r.latencyMs ?? null,
      metadata: r.metadata ? stripPhiMetadata(r.metadata) : null,
    }));
    const res = await db.insert(suggestionEvents).values(chunk).onConflictDoNothing().returning({ id: suggestionEvents.id });
    inserted += res.length;
  }
  return inserted;
}

// ────────────────────────────────────────────────────────────────────────────
// S1: feedback router
// ────────────────────────────────────────────────────────────────────────────

export const feedbackRouter = router({
  record: protectedProcedure
    .input(z.object({
      orgId: z.string(),
      suggestionId: z.string().min(1),
      surface: z.enum(SUGGESTION_SURFACES),
      action: z.enum(SUGGESTION_EVENT_ACTIONS),
      modelName: z.string().max(64),
      modelVersionId: z.string().optional(),
      confidence: z.number().min(0).max(1).optional(),
      contextHash: z.string().length(64).optional(),
      fieldName: z.string().max(64).optional(),
      suggestedValueHash: z.string().length(64).optional(),
      finalValueHash: z.string().length(64).optional(),
      keystrokeCount: z.number().int().min(0).max(100000).optional(),
      latencyMs: z.number().int().min(0).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await assertOrgMember(db, ctx.user.id, input.orgId, READ_ROLES);
      const inserted = await recordSuggestionEvents(db, [{
        orgId: input.orgId,
        userId: ctx.user.id,
        suggestionId: input.suggestionId,
        surface: input.surface,
        action: input.action,
        modelName: input.modelName,
        modelVersionId: input.modelVersionId,
        confidence: input.confidence,
        contextHash: input.contextHash,
        fieldName: input.fieldName,
        suggestedValueHash: input.suggestedValueHash,
        finalValueHash: input.finalValueHash,
        keystrokeCount: input.keystrokeCount,
        latencyMs: input.latencyMs,
        metadata: input.metadata,
      }]);
      // inserted === 0 means a terminal-event replay was deduped by the
      // partial unique index — idempotent, NOT an error.
      return { recorded: inserted > 0, deduplicated: inserted === 0 };
    }),

  metrics: protectedProcedure
    .input(z.object({
      orgId: z.string(),
      surface: z.string().optional(),
      days: z.number().int().min(1).max(365).default(30),
    }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      await assertOrgMember(db, ctx.user.id, input.orgId, READ_ROLES);
      function rowsOfExec(r: unknown): Array<Record<string, unknown>> {
      return (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>;
    }
      const surfaceFilter = input.surface ? sql`AND surface = ${input.surface}` : sql``;
      // §2.4 aggregates, computed directly in Postgres (lakehouse read-back
      // reuse is a follow-up; honesty label mirrors lakehouse-analytics).
      const bySurfaceRows = rowsOfExec(await db.execute(sql`
        SELECT surface, model_name AS "modelName", model_version_id AS "modelVersionId",
          COUNT(*) FILTER (WHERE action = 'presented')::int AS presented,
          COUNT(*) FILTER (WHERE action = 'accepted')::int AS accepted,
          COUNT(*) FILTER (WHERE action = 'edited')::int AS edited,
          COUNT(*) FILTER (WHERE action = 'rejected')::int AS rejected,
          COUNT(*) FILTER (WHERE action IN ('accepted','edited','rejected'))::int AS terminal
        FROM suggestion_events
        WHERE org_id = ${input.orgId}
          AND created_at >= now() - (${input.days} || ' days')::interval
          ${surfaceFilter}
        GROUP BY 1, 2, 3
        ORDER BY 1, 2
      `));
      // Lazy expiry: presented events older than 7 days with no terminal
      // event for the same (suggestion_id, field) count as expired (§2.3).
      const expiredRows = rowsOfExec(await db.execute(sql`
        SELECT surface, COUNT(*)::int AS expired
        FROM suggestion_events p
        WHERE p.org_id = ${input.orgId}
          AND p.action = 'presented'
          AND p.created_at >= now() - (${input.days} || ' days')::interval
          AND p.created_at < now() - interval '7 days'
          ${input.surface ? sql`AND p.surface = ${input.surface}` : sql``}
          AND NOT EXISTS (
            SELECT 1 FROM suggestion_events t
            WHERE t.suggestion_id = p.suggestion_id
              AND COALESCE(t.field_name, '') = COALESCE(p.field_name, '')
              AND t.action IN ('accepted','edited','rejected')
          )
        GROUP BY 1
      `));
      // keystrokes-per-dispute (new_dispute_prefill): avg of per-dispute sums.
      const keystrokeRows = rowsOfExec(await db.execute(sql`
        SELECT AVG(ks)::float AS "avgKeystrokes", COUNT(*)::int AS disputes
        FROM (
          SELECT COALESCE(metadata->>'disputeId', context_hash) AS disp,
                 SUM(COALESCE(keystroke_count, 0))::float AS ks
          FROM suggestion_events
          WHERE org_id = ${input.orgId}
            AND surface = 'new_dispute_prefill'
            AND created_at >= now() - (${input.days} || ' days')::interval
            AND (metadata->>'disputeId' IS NOT NULL OR context_hash IS NOT NULL)
          GROUP BY 1
        ) per_dispute
      `));
      // fields-changed/prefilled ratio per dispute.
      const ratioRows = rowsOfExec(await db.execute(sql`
        SELECT AVG(ratio)::float AS "avgRatio", COUNT(*)::int AS disputes
        FROM (
          SELECT disp,
                 SUM(changed)::float / NULLIF(SUM(presented), 0) AS ratio
          FROM (
            SELECT COALESCE(metadata->>'disputeId', context_hash) AS disp,
                   CASE WHEN action = 'presented' AND field_name IS NOT NULL THEN 1 ELSE 0 END AS presented,
                   CASE WHEN action IN ('edited','rejected')
                         OR (action = 'accepted' AND final_value_hash IS NOT NULL
                             AND suggested_value_hash IS NOT NULL
                             AND final_value_hash <> suggested_value_hash)
                        THEN 1 ELSE 0 END AS changed
            FROM suggestion_events
            WHERE org_id = ${input.orgId}
              AND surface = 'new_dispute_prefill'
              AND created_at >= now() - (${input.days} || ' days')::interval
          ) flags
          GROUP BY disp
        ) ratios
      `));
      const expiredBySurface = new Map(expiredRows.map(r => [String(r.surface), Number(r.expired ?? 0)]));
      return {
        orgId: input.orgId,
        windowDays: input.days,
        source: "postgres_fallback" as const,
        bySurface: bySurfaceRows.map(r => {
          const terminal = Number(r.terminal ?? 0);
          const accepted = Number(r.accepted ?? 0);
          return {
            surface: String(r.surface),
            modelName: String(r.modelName),
            modelVersionId: r.modelVersionId === null ? null : String(r.modelVersionId),
            presented: Number(r.presented ?? 0),
            accepted,
            edited: Number(r.edited ?? 0),
            rejected: Number(r.rejected ?? 0),
            expired: expiredBySurface.get(String(r.surface)) ?? 0,
            terminal,
            acceptanceRate: terminal > 0 ? Math.round((accepted / terminal) * 1000) / 1000 : null,
          };
        }),
        keystrokesPerDispute: {
          disputes: Number(keystrokeRows[0]?.disputes ?? 0),
          avgKeystrokes: keystrokeRows[0]?.avgKeystrokes != null ? Math.round(Number(keystrokeRows[0].avgKeystrokes) * 10) / 10 : null,
        },
        fieldsChangedRatio: {
          disputes: Number(ratioRows[0]?.disputes ?? 0),
          avgRatio: ratioRows[0]?.avgRatio != null ? Math.round(Number(ratioRows[0].avgRatio) * 1000) / 1000 : null,
        },
      };
    }),
});

// ────────────────────────────────────────────────────────────────────────────
// S2: prefill router
// ────────────────────────────────────────────────────────────────────────────

/** Fields eligible for org-prior suggestions: low-cardinality, non-PHI. */
const ORG_PRIOR_FIELDS = new Set([
  "planType", "serviceCategory", "networkStatus", "noticeConsentStatus",
  "patientState", "facilityState",
]);
/** Minimum prior accepts before an org-prior suggestion is shown (design §3.2). */
export const ORG_PRIOR_MIN_ACCEPTS = 5;


interface QuarantineSuggestion {
  field: string;
  suggestedValue: unknown;
  confidence: number;
  source: "reparse" | "org_prior";
  modelVersionId: null;
}

/**
 * Reparse a quarantined raw payload with the lenient mappers and collect
 * values for the row's missing fields. Returns an empty array when the
 * payload still does not parse (or is a CSV row, whose headers are not part
 * of the stored raw_payload — honest no-suggestion).
 */
export async function reparseQuarantineRow(
  fileType: string | null,
  rawPayload: string,
  missingFields: string[],
): Promise<QuarantineSuggestion[]> {
  if (!missingFields.length) return [];
  let normalized: Record<string, unknown> | null = null;
  try {
    if (fileType === "ndjson") {
      const { parseNdjson, normalizeFhirResources } = await import("../emr/bulk-import");
      const resources = parseNdjson(rawPayload);
      const { claims } = normalizeFhirResources(resources);
      normalized = (claims[0] ?? null) as unknown as Record<string, unknown> | null;
    } else if (fileType === "837") {
      const { parse837p, claim837ToNormalized } = await import("../edi/claim837");
      const parsed = parse837p(rawPayload);
      normalized = parsed[0] ? (claim837ToNormalized(parsed[0]) as unknown as Record<string, unknown>) : null;
    } else {
      // csv / 835 / unknown: raw_payload alone is insufficient for reparse
      // (CSV headers live on the first file line, not the quarantined row).
      return [];
    }
  } catch {
    return [];
  }
  if (!normalized) return [];
  const out: QuarantineSuggestion[] = [];
  for (const f of missingFields) {
    const v = normalized[f];
    if (v === null || v === undefined || v === "") continue;
    out.push({ field: f, suggestedValue: v, confidence: 0.8, source: "reparse", modelVersionId: null });
  }
  return out;
}

/**
 * Org priors: the most common NON-NULL value per field across the org's own
 * staged claims (practice_claims), requiring >= ORG_PRIOR_MIN_ACCEPTS
 * occurrences. Aggregates of the org's own data only; low-cardinality enum
 * fields; never PHI.
 */
export async function orgPriorSuggestions(
  db: Db,
  orgId: string,
  missingFields: string[],
): Promise<Map<string, QuarantineSuggestion>> {
  const out = new Map<string, QuarantineSuggestion>();
  const wanted = missingFields.filter(f => ORG_PRIOR_FIELDS.has(f));
  if (!wanted.length) return out;
  const { practiceClaims } = await import("../../drizzle/schema-practice-claims");
  for (const field of wanted) {
    // Field name comes from the fixed ORG_PRIOR_FIELDS allowlist (never raw
    // input); org scoping is parameterized.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const col = (practiceClaims as any)[field];
    if (!col) continue;
    const rows = await db
      .select({
        v: col,
        n: sql<number>`COUNT(*)::int`,
        total: sql<number>`SUM(COUNT(*)) OVER ()::int`,
      })
      .from(practiceClaims)
      .where(and(eq(practiceClaims.orgId, orgId), sql`${col} IS NOT NULL`))
      .groupBy(col)
      .orderBy(sql`2 DESC, 1 ASC`)
      .limit(1);
    const top = rows[0] as { v: string; n: number; total: number } | undefined;
    if (!top || Number(top.n) < ORG_PRIOR_MIN_ACCEPTS) continue; // n<5 gate: omit, never show thin
    const confidence = Number(top.total) > 0 ? Math.round((Number(top.n) / Number(top.total)) * 1000) / 1000 : 0.5;
    out.set(field, {
      field,
      suggestedValue: top.v,
      confidence: Math.min(0.95, Math.max(0.5, confidence)),
      source: "org_prior",
      modelVersionId: null,
    });
  }
  return out;
}

export const prefillRouter = router({
  /**
   * S2a: eager prefill for the NewDispute wizard. Calls the same
   * extractEmrData helper as ai.pullDisputeData (routers.ts:2132) and
   * records one `presented` suggestion event per extracted field, so a FE
   * crash never loses the denominator. Output adds suggestionId, modelName
   * and per-field suggestedValueHash to the pullDisputeData shape.
   */
  dispute: protectedProcedure
    .input(z.object({
      orgId: z.string(),
      connectionId: z.string(),
      emrSystem: z.string(),
      patientId: z.string().optional(),
      claimId: z.string().optional(),
      encounterId: z.string().optional(),
      dateOfService: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      await assertOrgMember(db, ctx.user.id, input.orgId, READ_ROLES);
      const { extractEmrData } = await import("../emr/bulk-import");
      const result = await extractEmrData({
        connectionId: input.connectionId,
        emrSystem: input.emrSystem,
        patientId: input.patientId,
        encounterId: input.encounterId,
        claimId: input.claimId,
        dateOfService: input.dateOfService,
      });
      const suggestionId = crypto.randomUUID();
      const modelName = `emr-extract-${input.emrSystem}`;
      const extracted = result.extractedData ?? {};
      const fields = Object.keys(extracted);
      const cHash = contextHash(input.orgId, "new_dispute_prefill", {
        emrSystem: input.emrSystem,
        ...(input.claimId ? { claimId: sha256Hex(input.claimId).slice(0, 16) } : {}),
      });
      await recordSuggestionEvents(db, fields.map(f => ({
        orgId: input.orgId,
        userId: ctx.user.id,
        suggestionId,
        surface: "new_dispute_prefill" as const,
        action: "presented" as const,
        modelName,
        modelVersionId: null,
        confidence: result.fieldConfidence?.[f] ?? null,
        contextHash: cHash,
        fieldName: f,
        suggestedValueHash: sha256Hex(extracted[f]),
        metadata: { emrSystem: input.emrSystem },
      })));
      return {
        ...result,
        suggestionId,
        modelName,
        modelVersionId: null,
        suggestedValueHashes: Object.fromEntries(fields.map(f => [f, sha256Hex(extracted[f])])),
      };
    }),

  /**
   * S2b: quarantine-repair inline suggestions. Per row: (a) reparse-derived
   * values for missing fields; (b) org priors (n>=5 gate — thin priors are
   * OMITTED, never shown thin). Records batched `presented` events.
   */
  quarantineRows: protectedProcedure
    .input(z.object({ orgId: z.string(), quarantineIds: z.array(z.string()).min(1).max(100) }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      await assertOrgMember(db, ctx.user.id, input.orgId, READ_ROLES);
      const { inArray } = await import("drizzle-orm");
      const rows = await db.select().from(claimQuarantine)
        .where(and(eq(claimQuarantine.orgId, input.orgId), inArray(claimQuarantine.id, input.quarantineIds)));
      const sessionIds = [...new Set(rows.map(r => r.sessionId))];
      const sessions = sessionIds.length
        ? await db.select().from(bulkUploadSessions).where(inArray(bulkUploadSessions.id, sessionIds))
        : [];
      const fileTypeBySession = new Map(sessions.map(s => [s.id, s.fileType as string]));

      const results: Array<{ quarantineId: string; suggestionId: string; suggestions: QuarantineSuggestion[] }> = [];
      const presented: Parameters<typeof recordSuggestionEvents>[1] = [];
      for (const row of rows) {
        const missing = Array.isArray(row.missingFields) ? (row.missingFields as string[]) : [];
        const suggestionId = crypto.randomUUID();
        const reparse = await reparseQuarantineRow(fileTypeBySession.get(row.sessionId) ?? null, row.rawPayload, missing);
        const covered = new Set(reparse.map(s => s.field));
        const priors = await orgPriorSuggestions(db, input.orgId, missing.filter(f => !covered.has(f)));
        const suggestions = [...reparse, ...priors.values()];
        results.push({ quarantineId: row.id, suggestionId, suggestions });
        const cHash = contextHash(input.orgId, "quarantine_repair", { sessionId: row.sessionId });
        for (const s of suggestions) {
          presented.push({
            orgId: input.orgId,
            userId: ctx.user.id,
            suggestionId,
            surface: "quarantine_repair" as const,
            action: "presented" as const,
            modelName: "quarantine-repair-v1",
            modelVersionId: null,
            confidence: s.confidence,
            contextHash: cHash,
            fieldName: s.field,
            suggestedValueHash: sha256Hex(s.suggestedValue),
            metadata: { source: s.source, quarantineId: row.id },
          });
        }
      }
      await recordSuggestionEvents(db, presented);
      return { rows: results };
    }),
});

// ────────────────────────────────────────────────────────────────────────────
// S3: offer-strategy v2 router
// ────────────────────────────────────────────────────────────────────────────

function segmentFromParams(
  tierList: Array<{ key: Record<string, string>; sampleSize: number; wins: number; awardToQpaP25: number | null; awardToQpaMedian: number | null; awardToQpaP75: number | null; medianDeterminationUsd: number | null }> | undefined,
  tier: SegmentStatsV2["tier"],
  match: Record<string, string | null>,
): SegmentStatsV2 {
  const row = (tierList ?? []).find(r => Object.entries(match).every(([k, v]) => v === null || v === undefined ? true : r.key[k] === v));
  return {
    tier,
    sampleSize: row?.sampleSize ?? 0,
    wins: row?.wins ?? 0,
    awardToQpaMedian: row?.awardToQpaMedian ?? null,
    awardToQpaP25: row?.awardToQpaP25 ?? null,
    awardToQpaP75: row?.awardToQpaP75 ?? null,
    medianDeterminationUsd: row?.medianDeterminationUsd ?? null,
  };
}

export const offerStrategyRouter = router({
  /**
   * S3: data-trained offer recommendation. Same authZ shape as
   * submitter.recommendOffer (dispute creator, admin, or org member of the
   * owning submitter/client org via membership-derived scoping). Loads the
   * ACTIVE model_versions row, walks the segment fallback chain, and returns
   * the engine payload WITH the modelVersion block and honesty label. Thin
   * data => label "insufficient_data" and a null estimate — never the
   * synthetic v1 fallback.
   */
  recommendV2: protectedProcedure
    .input(z.object({ orgId: z.string(), disputeId: z.string() }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      await assertOrgMember(db, ctx.user.id, input.orgId, READ_ROLES);
      const d = (await db.select().from(disputes).where(eq(disputes.id, input.disputeId)).limit(1))[0];
      if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Dispute not found" });
      // Dispute must belong to the org: membership-derived scoping (creator
      // is an org member, or the dispute is linked through a submitter
      // client of this org).
      const creatorMember = d.createdBy
        ? (await db.select({ userId: orgMemberships.userId }).from(orgMemberships)
            .where(and(eq(orgMemberships.orgId, input.orgId), eq(orgMemberships.userId, d.createdBy))).limit(1))[0]
        : undefined;
      if (!creatorMember && d.submitterClientId) {
        const link = (await db.select().from(submitterClients).where(eq(submitterClients.id, d.submitterClientId)).limit(1))[0];
        if (!link || (link.submitterOrgId !== input.orgId && link.clientOrgId !== input.orgId)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "No access to this dispute" });
        }
      } else if (!creatorMember) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No access to this dispute" });
      }

      const active = (await db.select().from(modelVersions)
        .where(and(eq(modelVersions.modelName, OFFER_MODEL_NAME), eq(modelVersions.status, "active")))
        .limit(1))[0];

      let chain: SegmentStatsV2[];
      let mvBlock: ModelVersionBlock;
      if (active) {
        const tiers = (active.parameters as { tiers?: Record<string, unknown[]> }).tiers ?? {};
        chain = [
          segmentFromParams(tiers.idr_entity_x_service_x_patientstate as never[], "idr_entity_x_service_x_patientstate", {
            idrEntityId: d.idrEntityId, serviceType: d.serviceType, patientState: d.patientState,
          }),
          segmentFromParams(tiers.idr_entity_x_service as never[], "idr_entity_x_service", {
            idrEntityId: d.idrEntityId, serviceType: d.serviceType,
          }),
          segmentFromParams(tiers.service_x_patientstate as never[], "service_x_patientstate", {
            serviceType: d.serviceType, patientState: d.patientState,
          }),
          segmentFromParams(tiers.service as never[], "service", { serviceType: d.serviceType }),
          segmentFromParams([tiers.platform as never], "platform", {}),
        ];
        mvBlock = {
          id: active.id,
          version: active.version,
          trainedAt: active.trainedAt ? active.trainedAt.toISOString() : null,
          trainingSampleSize: active.trainingSampleSize,
          honestyLabel: active.honestyLabel as ModelVersionBlock["honestyLabel"],
        };
      } else {
        // No active model — honest insufficient_data with an empty chain.
        const zero = (tier: SegmentStatsV2["tier"]): SegmentStatsV2 => ({
          tier, sampleSize: 0, wins: 0, awardToQpaMedian: null, awardToQpaP25: null, awardToQpaP75: null, medianDeterminationUsd: null,
        });
        chain = ["idr_entity_x_service_x_patientstate", "idr_entity_x_service", "service_x_patientstate", "service", "platform"]
          .map(t => zero(t as SegmentStatsV2["tier"]));
        mvBlock = { id: null, version: null, trainedAt: null, trainingSampleSize: 0, honestyLabel: "insufficient_data" };
      }

      const asOf = new Date();
      const params = getEffectiveIDRParameters(asOf);
      const dbFee = await getAdminFeeFromDb("single", asOf);
      const adminFeeUsd = dbFee ? Number(dbFee.amountUsd) : params.adminFeeUsd;

      const result = recommendOfferV2({
        qpaUsd: d.qpaAmount !== null ? Number(d.qpaAmount) : null,
        initialPaymentUsd: d.respondingPartyOffer !== null ? Number(d.respondingPartyOffer) : null,
        billedUsd: Number(d.billedAmount),
        adminFeeUsd,
        segmentChain: chain,
        modelVersion: mvBlock,
      });

      // Producer records `presented` (design §2.3: producer records
      // presented; the client records the terminal action).
      const suggestionId = crypto.randomUUID();
      await recordSuggestionEvents(db, [{
        orgId: input.orgId,
        userId: ctx.user.id,
        suggestionId,
        surface: "offer_recommendation",
        action: "presented",
        modelName: OFFER_MODEL_NAME,
        modelVersionId: mvBlock.id,
        contextHash: contextHash(input.orgId, "offer_recommendation", {
          serviceType: d.serviceType, patientState: d.patientState, idrEntityId: d.idrEntityId ?? "none",
        }),
        metadata: { disputeId: d.id, segmentTier: result.features.segmentTierUsed },
      }]);

      return { disputeId: d.id, referenceNumber: d.referenceNumber, suggestionId, ...result };
    }),
});
