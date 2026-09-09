/**
 * server/idr/qpa/routes.ts
 *
 * qpaEngineRouter — thin tRPC wrappers over the statutory QPA engine in this
 * directory. No business logic is duplicated here; fail-closed behavior of
 * computeQPA / ingestContractedRates passes through unchanged. This router is
 * registered separately from the pre-existing illustrative `qpa` router
 * (which remains untouched); it is the §149.140 median-of-contracted-rates
 * computation path.
 */
import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure } from "../../_core/trpc";
import { qpaContractedRates, qpaIngestionBatches, qpaCpiFactors } from "../../../drizzle/schema-qpa";
import { computeQPA } from "./engine";
import {
  ingestContractedRates,
  type ContractedRateStore,
  type IngestionBatch,
  type ProvenanceSourceType,
} from "./ingestion";
import {
  INSURANCE_MARKETS,
  QPA_CITATIONS,
  MIN_CONTRACTED_RATES,
  QPA_BASELINE_DATE,
  loadCpiFactorsFromEnv,
  type CpiFactorTable,
  type ContractedRateRow,
  type InsuranceMarket,
} from "./methodology";

/** Local admin procedure (same pattern as routers.ts; cannot import it from there due to circularity). */
const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next();
});

const marketSchema = z.enum(INSURANCE_MARKETS as [InsuranceMarket, ...InsuranceMarket[]]);

const rateRowSchema = z.object({
  payerId: z.string().min(1).max(128),
  serviceCode: z.string().min(1).max(16),
  market: marketSchema,
  region: z.string().min(1).max(128),
  contractedRateCents: z.number().int().positive(),
  arrangementType: z.enum([
    "FEE_FOR_SERVICE", "SINGLE_CASE_AGREEMENT", "LETTER_OF_AGREEMENT",
    "NON_FFS_BUNDLED", "NON_FFS_CAPITATION", "RISK_SHARING_ADJUSTMENT", "BONUS_PENALTY_ADJUSTMENT",
  ]),
  effectiveDate: z.coerce.date(),
  underlyingFeeScheduleCents: z.number().int().positive().optional(),
  derivedAmountCents: z.number().int().positive().optional(),
  claimsSharePercent: z.number().min(0).max(100).optional(),
});

/** Postgres-backed ContractedRateStore over drizzle/schema-qpa.ts tables. */
export function createPostgresStore(db: any): ContractedRateStore & {
  loadRates(): Promise<ContractedRateRow[]>;
  loadCpiFactors(): Promise<CpiFactorTable | null>;
  batchStats(): Promise<{ batches: number; rates: number; cpiYears: number }>;
} {
  return {
    async findBatchByContentHash(contentHash: string) {
      const rows = await db
        .select({ batchId: qpaIngestionBatches.batchId })
        .from(qpaIngestionBatches)
        .where(eq(qpaIngestionBatches.contentHash, contentHash))
        .limit(1);
      return rows[0]?.batchId ?? null;
    },
    async persistBatch(batch: IngestionBatch) {
      await db.insert(qpaIngestionBatches).values({
        batchId: batch.batchId,
        contentHash: batch.contentHash,
        sourceType: batch.provenance.sourceType,
        sourceRef: batch.provenance.sourceRef,
        importedAt: batch.provenance.importedAt,
        totalRows: batch.totalRows,
        acceptedRows: batch.accepted.length,
        rejectedRows: batch.rejected.length,
      });
      if (batch.accepted.length) {
        await db
          .insert(qpaContractedRates)
          .values(
            batch.accepted.map((r) => ({
              // Gap fix (journey J06): `${batchId}:${rowHash}` is 86+ chars and
              // overflows id varchar(80) (Postgres 22001 on every ingest).
              // The rowHash is already the unique dedupe key (unique index +
              // ON CONFLICT target), so use it as the primary key directly.
              id: r.rowHash,
              batchId: batch.batchId,
              payerId: r.payerId,
              serviceCode: r.serviceCode,
              market: r.market,
              region: r.region,
              contractedRateCents: r.contractedRateCents,
              arrangementType: r.arrangementType,
              effectiveDate: r.effectiveDate,
              underlyingFeeScheduleCents: r.underlyingFeeScheduleCents ?? null,
              derivedAmountCents: r.derivedAmountCents ?? null,
              claimsSharePercent: r.claimsSharePercent != null ? String(r.claimsSharePercent) : null,
              rowHash: r.rowHash,
              provenance: batch.provenance,
            }))
          )
          .onConflictDoNothing({ target: qpaContractedRates.rowHash });
      }
    },
    async loadRates() {
      // Load all rows; the methodology layer performs the statutory
      // dimension filtering + eligibility exclusions (single source of truth).
      const rows = await db.select().from(qpaContractedRates);
      return rows.map((r: any): ContractedRateRow => ({
        payerId: r.payerId,
        serviceCode: r.serviceCode,
        market: r.market,
        region: r.region,
        contractedRateCents: r.contractedRateCents,
        arrangementType: r.arrangementType,
        effectiveDate: r.effectiveDate,
        ...(r.underlyingFeeScheduleCents != null ? { underlyingFeeScheduleCents: r.underlyingFeeScheduleCents } : {}),
        ...(r.derivedAmountCents != null ? { derivedAmountCents: r.derivedAmountCents } : {}),
        ...(r.claimsSharePercent != null ? { claimsSharePercent: Number(r.claimsSharePercent) } : {}),
      }));
    },
    async loadCpiFactors() {
      const rows = await db.select().from(qpaCpiFactors);
      if (!rows.length) return null; // fail-closed
      const factors: Record<number, number> = {};
      for (const r of rows) factors[r.year] = Number(r.factor);
      return { baseYear: 2019, factors };
    },
    async batchStats() {
      const batches = await db.select({ batchId: qpaIngestionBatches.batchId }).from(qpaIngestionBatches);
      const rates = await db.select({ id: qpaContractedRates.id }).from(qpaContractedRates);
      const cpi = await db.select({ year: qpaCpiFactors.year }).from(qpaCpiFactors);
      return { batches: batches.length, rates: rates.length, cpiYears: cpi.length };
    },
  };
}

export const qpaEngineRouter = router({
  /**
   * Statutory QPA per 45 CFR 149.140. Fail-closed: returns
   * computable:false (never a benchmark or default number) when contracted
   * rates or CPI factors are missing/insufficient.
   */
  compute: protectedProcedure
    .input(
      z.object({
        serviceCode: z.string().min(1).max(16),
        market: marketSchema,
        region: z.string().min(1).max(128),
        asOfDate: z.coerce.date(),
      })
    )
    .query(async ({ input }) => {
      const { getDb } = await import("../../db");
      const db = await getDb();
      if (!db) {
        // Fail-closed: without the rate store there is no statutory input.
        return {
          qpaCents: null, computable: false,
          methodology: "45 CFR 149.140 median of contracted rates",
          ratesUsed: 0, cpiFactor: null, medianContractedRateCents: null,
          serviceYear: input.asOfDate.getUTCFullYear(),
          reason: "Contracted-rate store unavailable; no statutory input data (fail-closed).",
          fallback: "ELIGIBLE_DATABASE_REQUIRED",
          citations: [...QPA_CITATIONS],
          provenanceSummary: { batchCount: 0, sourceTypes: [], sourceRefs: [] },
        };
      }
      const store = createPostgresStore(db);
      const [rates, cpiFactors] = await Promise.all([store.loadRates(), store.loadCpiFactors()]);
      const batches = await db.select().from(qpaIngestionBatches);
      return computeQPA(input, {
        rates,
        cpiFactors: cpiFactors ?? loadCpiFactorsFromEnv(),
        provenance: batches.map((b: any) => ({
          sourceType: b.sourceType as ProvenanceSourceType,
          sourceRef: b.sourceRef,
          importedAt: b.importedAt,
        })),
      });
    }),

  /** Admin-only ingestion of validated contracted-rate rows (idempotent by content hash). */
  ingest: adminProcedure
    .input(
      z.object({
        rows: z.array(rateRowSchema).min(1).max(10000),
        provenance: z.object({
          sourceType: z.enum(["TIC_MRF", "PAYER_FILE", "MANUAL"]),
          sourceRef: z.string().min(1),
          importedAt: z.coerce.date(),
        }),
      })
    )
    .mutation(async ({ input }) => {
      const { getDb } = await import("../../db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const store = createPostgresStore(db);
      const result = await ingestContractedRates(input.rows, input.provenance, store);
      return {
        batchId: result.batchId,
        contentHash: result.contentHash,
        totalRows: result.totalRows,
        acceptedRows: result.accepted.length,
        rejectedRows: result.rejected.length,
        rejected: result.rejected,
        idempotentReplay: result.idempotentReplay,
      };
    }),

  /** Ingestion status: batch/rate/CPI-factor counts (admin). */
  ingestionStatus: adminProcedure.query(async () => {
    const { getDb } = await import("../../db");
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    return createPostgresStore(db).batchStats();
  }),

  /** Public methodology statement + citations (no rate data exposed). */
  methodology: publicProcedure.query(() => ({
    standard: "45 CFR 149.140 — Methodology for calculating qualifying payment amount",
    baselineDate: QPA_BASELINE_DATE,
    minContractedRates: MIN_CONTRACTED_RATES,
    markets: [...INSURANCE_MARKETS],
    failClosed: true,
    summary:
      "Median of contracted rates per service code / insurance market / geographic region at the " +
      "Jan 31, 2019 baseline, indexed by published CPI-U increases. Single-case agreements excluded " +
      "(149.140(a)(1)); non-FFS arrangements use underlying fee schedule or derived amounts " +
      "(149.140(b)(2)(iii)); incentive/retrospective adjustments excluded (149.140(b)(2)(iv)). " +
      "Fewer than 3 eligible contracted rates => computable:false with the 149.140(c)(3) " +
      "eligible-database fallback marker; this engine never returns illustrative or default values.",
    citations: [...QPA_CITATIONS],
  })),
});

export type QpaEngineRouter = typeof qpaEngineRouter;
