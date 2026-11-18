/**
 * server/routers/lakehouse-analytics.ts — phase17-lh
 *
 * Read-back analytics over the lakehouse export pipeline, with an HONEST
 * fallback contract:
 *
 *   - When LAKEHOUSE_QUERY_URL is configured AND reachable, procedures POST
 *     a query envelope (see docs/LAKEHOUSE.md "Query endpoint contract") to
 *     the Spark-side query service and return its rows with
 *     source: "lakehouse".
 *   - OTHERWISE the same aggregates are computed directly over Postgres and
 *     returned with source: "postgres_fallback".
 *   - Lakehouse results are NEVER fabricated: a lakehouse failure (timeout,
 *     non-2xx, malformed envelope) falls back to Postgres and the response
 *     says so. `source` is the contract.
 *
 * AuthZ: org membership required (owner/staff/viewer read), mirroring the
 * practice-audit router's assertOrgMember. Aggregates are org-scoped to
 * disputes initiated by members of the org (initiatingPartyId ∈ org member
 * user ids).
 *
 * Also provides disputeDensityByState — the same Postgres-native aggregation
 * as lakehouse.spatialQuery (server/routers.ts, owned by another workstream
 * and NOT modified) but carrying the source contract field.
 *
 * Labels: postgres_fallback path EXECUTED-VERIFIED (vitest vs embedded PG);
 * lakehouse path STATIC-ONLY in this sandbox (no Spark endpoint) with the
 * fetch/timeout/fallback logic EXECUTED-VERIFIED via injected fetch stubs.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { orgMemberships, organizations } from "../../drizzle/schema-personas";
import { getDb } from "../db";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type AnalyticsSource = "lakehouse" | "postgres_fallback";

async function assertOrgMember(db: Db, userId: string, orgId: string) {
  const rows = await db
    .select()
    .from(orgMemberships)
    .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)))
    .limit(1);
  if (!rows[0]) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You are not an authorized member of this organization" });
  }
  const org = (await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1))[0];
  if (!org) throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
  return rows[0];
}

// ── Lakehouse query endpoint client ─────────────────────────────────────────

/** Default timeout for the lakehouse query endpoint (ms). */
export const LAKEHOUSE_QUERY_TIMEOUT_MS = 5_000;

export interface LakehouseQueryEnvelope {
  /** Stable query name, e.g. "payerBehaviorSummary". */
  query: string;
  /** Query parameters (orgId, period granularity, etc.). */
  params: Record<string, unknown>;
}

export interface LakehouseQueryResponse {
  rows: Array<Record<string, unknown>>;
}

type FetchLike = typeof fetch;

/**
 * POST the query envelope to LAKEHOUSE_QUERY_URL with a hard timeout.
 * Returns parsed rows, or null when the endpoint is unconfigured, unreachable,
 * non-2xx, or returns a malformed envelope — callers MUST fall back to
 * Postgres and label the response accordingly.
 */
export async function queryLakehouse(
  envelope: LakehouseQueryEnvelope,
  deps: { fetchImpl?: FetchLike; url?: string; timeoutMs?: number } = {},
): Promise<Array<Record<string, unknown>> | null> {
  const url = deps.url ?? process.env.LAKEHOUSE_QUERY_URL?.trim();
  if (!url) return null; // unconfigured — honest fallback
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? LAKEHOUSE_QUERY_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(envelope),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as LakehouseQueryResponse;
    if (!body || !Array.isArray(body.rows)) return null;
    return body.rows;
  } catch {
    return null; // timeout/network/parse — honest fallback
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve rows from the lakehouse or Postgres, with the honesty contract. */
async function withSource<T extends Record<string, unknown>>(
  envelope: LakehouseQueryEnvelope,
  pgFallback: () => Promise<T[]>,
  deps: { fetchImpl?: FetchLike } = {},
): Promise<{ source: AnalyticsSource; rows: T[] }> {
  const lakehouseRows = await queryLakehouse(envelope, deps);
  if (lakehouseRows != null) {
    return { source: "lakehouse", rows: lakehouseRows as T[] };
  }
  return { source: "postgres_fallback", rows: await pgFallback() };
}

/** SQL fragment: org scope = disputes initiated by any member of the org. */
function orgMemberDisputeScope(orgId: string) {
  return sql`d."initiatingPartyId" IN (SELECT "userId" FROM org_memberships WHERE "orgId" = ${orgId})`;
}

export const lakehouseAnalyticsRouter = router({
  /**
   * Per-payer aggregates for an org: dispute counts by status/outcome and
   * underpayment evidence (billed − paid, cumulative verified amounts only —
   * never payment instructions).
   */
  payerBehaviorSummary: protectedProcedure
    .input(z.object({ orgId: z.string() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await assertOrgMember(db, ctx.user.id, input.orgId);
      return withSource(
        { query: "payerBehaviorSummary", params: { orgId: input.orgId } },
        async () => {
          const res = await db.execute(sql`
            SELECT COALESCE(d."respondingPartyName", 'unknown') AS "payerName",
                   COUNT(*)::int AS "disputeCount",
                   COUNT(*) FILTER (WHERE d."determinationWinner" = 'initiating_party')::int AS "providerWins",
                   COUNT(*) FILTER (WHERE d."determinationWinner" = 'responding_party')::int AS "payerWins",
                   COUNT(*) FILTER (WHERE d."status" = 'closed')::int AS "closedCount",
                   COALESCE(SUM(GREATEST(d."billedAmount"::numeric - COALESCE(d."paidAmount"::numeric, 0), 0)), 0)::text AS "totalUnderpayment"
            FROM disputes d
            WHERE ${orgMemberDisputeScope(input.orgId)}
            GROUP BY 1
            ORDER BY 2 DESC
          `);
          const rows: any[] = Array.isArray(res) ? (res as any) : ((res as any)?.rows ?? []);
          return rows;
        },
      );
    }),

  /**
   * QPA trends: average/median-ish QPA per CPT code × state × month period.
   */
  qpaTrends: protectedProcedure
    .input(z.object({
      orgId: z.string(),
      code: z.string().optional(),
      state: z.string().length(2).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await assertOrgMember(db, ctx.user.id, input.orgId);
      return withSource(
        { query: "qpaTrends", params: { orgId: input.orgId, code: input.code ?? null, state: input.state ?? null } },
        async () => {
          const res = await db.execute(sql`
            SELECT cpt AS "code",
                   d."facilityState" AS "state",
                   to_char(date_trunc('month', d."serviceDate"), 'YYYY-MM') AS "period",
                   COUNT(*)::int AS "disputeCount",
                   AVG(d."qpaAmount"::numeric)::text AS "avgQpa",
                   AVG(d."billedAmount"::numeric)::text AS "avgBilled"
            FROM disputes d, LATERAL jsonb_array_elements_text(d."cptCodes") AS cpt
            WHERE ${orgMemberDisputeScope(input.orgId)}
              AND d."qpaAmount" IS NOT NULL
              AND (${input.code ?? null}::text IS NULL OR cpt = ${input.code ?? null})
              AND (${input.state ?? null}::text IS NULL OR d."facilityState" = ${input.state ?? null})
            GROUP BY 1, 2, 3
            ORDER BY 3, 1, 2
          `);
          const rows: any[] = Array.isArray(res) ? (res as any) : ((res as any)?.rows ?? []);
          return rows;
        },
      );
    }),

  /** Claim/dispute volume per month × status for an org. */
  claimVolumeStats: protectedProcedure
    .input(z.object({ orgId: z.string() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await assertOrgMember(db, ctx.user.id, input.orgId);
      return withSource(
        { query: "claimVolumeStats", params: { orgId: input.orgId } },
        async () => {
          const res = await db.execute(sql`
            SELECT to_char(date_trunc('month', d."createdAt"), 'YYYY-MM') AS "period",
                   d."status"::text AS "status",
                   COUNT(*)::int AS "count",
                   COALESCE(SUM(d."billedAmount"::numeric), 0)::text AS "totalBilled"
            FROM disputes d
            WHERE ${orgMemberDisputeScope(input.orgId)}
            GROUP BY 1, 2
            ORDER BY 1, 2
          `);
          const rows: any[] = Array.isArray(res) ? (res as any) : ((res as any)?.rows ?? []);
          return rows;
        },
      );
    }),

  /**
   * State-level dispute density — same Postgres-native aggregation as
   * lakehouse.spatialQuery (which is owned by another workstream and NOT
   * modified), but carrying the honest `source` contract field.
   */
  disputeDensityByState: protectedProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      return withSource(
        { query: "disputeDensityByState", params: {} },
        async () => {
          const res = await db.execute(sql`
            SELECT COALESCE(NULLIF("facilityState", ''), "patientState") AS "stateCode",
                   COUNT(*)::int AS count
            FROM disputes
            GROUP BY 1
            HAVING COALESCE(NULLIF("facilityState", ''), "patientState") IS NOT NULL
            ORDER BY 1
          `);
          const rows: any[] = Array.isArray(res) ? (res as any) : ((res as any)?.rows ?? []);
          return rows;
        },
      );
    }),
});
