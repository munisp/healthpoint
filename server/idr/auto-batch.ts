/**
 * server/idr/auto-batch.ts
 *
 * Phase 18: auto-batcher. Given an org's pool of eligible claim/dispute line
 * items, greedily proposes CMS-9897-F-compliant batched disputes by reusing
 * the regulatory evaluator in server/idr/batching/batching.ts (never a
 * reimplementation):
 *   - criterion (A) same provider NPI/TIN, (B) same payer,
 *   - criterion (C)/(relatedness) via evaluateBatchEligibility per regime,
 *   - criterion (D) 30-business-day service window,
 *   - line-item cap 25 before 2026-11-01 ONPs / 50 on-or-after.
 *
 * Preview-first: this module and the submitter.autoBatch /
 * batching.suggestBatches procedures are pure previews — no dispute rows are
 * created until submitter.confirmBatches is called.
 *
 * Fee savings: projected IDRE-fee savings of one batched dispute vs N single
 * disputes, using the statutory certified-IDRE fee ranges ($200–$840 single,
 * $268–$1,173 batched — CMS Dec 2023 fee rule, unchanged by CMS-9897-F) plus
 * the per-dispute administrative fee (injected; DB-first with params-2026
 * fallback at the router layer). Savings are arithmetic on published fee
 * ranges — labeled as projections, not guarantees.
 */

import {
  evaluateBatchEligibility,
  applicableBatchCap,
  batchingRegime,
  BATCHING_CITATIONS,
  type LineItemInput,
} from "./batching/batching";

/** Statutory certified-IDRE fee ranges (USD). */
export const IDRE_FEE_RANGE_SINGLE_USD = { min: 200, max: 840 } as const;
export const IDRE_FEE_RANGE_BATCHED_USD = { min: 268, max: 1173 } as const;

export interface AutoBatchCandidate extends LineItemInput {
  /** Optional dispute linkage when candidates come from existing disputes. */
  disputeId?: string;
  referenceNumber?: string;
}

export interface ProposedBatch {
  batchKey: string;
  items: AutoBatchCandidate[];
  rationale: string[];
  capApplied: number;
  regimeBasis: string;
  /** Projected fee economics for THIS batch vs filing each item singly. */
  economics: {
    lineItemCount: number;
    singleFilingsAdminFeesUsd: number;
    batchedAdminFeeUsd: number;
    singleFilingsIdreFeeRangeUsd: { min: number; max: number };
    batchedIdreFeeRangeUsd: { min: number; max: number };
    /** (N−1) × admin fee — the deterministic component of savings. */
    adminFeeSavingsUsd: number;
    /** Range-only IDRE-fee delta (sum of singles minus one batched). */
    idreFeeSavingsRangeUsd: { min: number; max: number };
    totalProjectedSavingsRangeUsd: { min: number; max: number };
    label: "projection_not_guarantee";
  };
}

export interface AutoBatchResult {
  batches: ProposedBatch[];
  /** Candidates that could not be batched (singletons or constraint losers). */
  unbatched: Array<{ item: AutoBatchCandidate; reason: string }>;
  poolSize: number;
  citations: string[];
}

export interface AutoBatchOptions {
  /** ONP start date driving cap + relatedness regime (fail-closed when absent). */
  openNegotiationNoticeDate?: Date;
  now?: Date;
  useNowFallback?: boolean;
  /** Administrative fee per dispute (USD) — injected by the router. */
  adminFeeUsd: number;
  env?: NodeJS.ProcessEnv;
}

function economicsFor(n: number, adminFeeUsd: number): ProposedBatch["economics"] {
  const singleAdmin = n * adminFeeUsd;
  const singleIdre = { min: n * IDRE_FEE_RANGE_SINGLE_USD.min, max: n * IDRE_FEE_RANGE_SINGLE_USD.max };
  const adminFeeSavings = singleAdmin - adminFeeUsd; // (n-1) × admin fee
  const idreSavings = {
    min: Math.max(0, singleIdre.min - IDRE_FEE_RANGE_BATCHED_USD.max),
    max: Math.max(0, singleIdre.max - IDRE_FEE_RANGE_BATCHED_USD.min),
  };
  return {
    lineItemCount: n,
    singleFilingsAdminFeesUsd: Math.round(singleAdmin * 100) / 100,
    batchedAdminFeeUsd: Math.round(adminFeeUsd * 100) / 100,
    singleFilingsIdreFeeRangeUsd: singleIdre,
    batchedIdreFeeRangeUsd: { ...IDRE_FEE_RANGE_BATCHED_USD },
    adminFeeSavingsUsd: Math.round(adminFeeSavings * 100) / 100,
    idreFeeSavingsRangeUsd: idreSavings,
    totalProjectedSavingsRangeUsd: {
      min: Math.round((adminFeeSavings + idreSavings.min) * 100) / 100,
      max: Math.round((adminFeeSavings + idreSavings.max) * 100) / 100,
    },
    label: "projection_not_guarantee",
  };
}

/**
 * Greedy grouping: bucket by (payer, provider NPI/TIN), order by date of
 * service, and grow each open batch while evaluateBatchEligibility still
 * passes AND the cap holds. Fail-closed: candidates missing payer/provider/
 * service-code/date identifiers are reported unbatched, never forced.
 */
export function proposeBatches(
  candidates: AutoBatchCandidate[],
  opts: AutoBatchOptions
): AutoBatchResult {
  const env = opts.env ?? process.env;
  const effectiveOnp =
    opts.openNegotiationNoticeDate ??
    (opts.useNowFallback ? opts.now ?? new Date() : undefined);
  const { cap } = applicableBatchCap(effectiveOnp, env);
  const regime = batchingRegime(opts.openNegotiationNoticeDate, {
    now: opts.now,
    useNowFallback: opts.useNowFallback,
  });

  const eligible = candidates.filter(c => c.qualifiedIdrItem);
  const unbatched: AutoBatchResult["unbatched"] = candidates
    .filter(c => !c.qualifiedIdrItem)
    .map(item => ({ item, reason: "Not flagged as a qualified IDR item/service." }));

  // Bucket by (payer, provider).
  const buckets = new Map<string, AutoBatchCandidate[]>();
  for (const c of eligible) {
    const provider = c.providerNpi ?? c.providerTin;
    if (!provider || !c.payerId || !c.serviceCode || !(c.dateOfService instanceof Date)) {
      unbatched.push({
        item: c,
        reason: "Fail-closed: missing payer, provider NPI/TIN, service code, or date of service.",
      });
      continue;
    }
    const key = `${c.payerId.trim()}|${provider}`;
    const list = buckets.get(key) ?? [];
    list.push(c);
    buckets.set(key, list);
  }

  const batches: ProposedBatch[] = [];
  for (const [key, members] of [...buckets.entries()].sort()) {
    members.sort(
      (a, b) => (a.dateOfService?.getTime() ?? 0) - (b.dateOfService?.getTime() ?? 0)
    );
    let current: AutoBatchCandidate[] = [];
    let batchIdx = 0;
    const flush = () => {
      if (current.length >= 2) {
        const evalRes = evaluateBatchEligibility(current, {
          openNegotiationNoticeDate: opts.openNegotiationNoticeDate,
          now: opts.now,
          useNowFallback: opts.useNowFallback,
          env,
        });
        if (evalRes.eligible) {
          batchIdx++;
          batches.push({
            batchKey: `${key}#${batchIdx}`,
            items: current,
            rationale: [
              `Grouped ${current.length} line items sharing payer "${current[0].payerId}" and provider "${current[0].providerNpi ?? current[0].providerTin}" (criteria A/B).`,
              ...evalRes.appliedCriteria,
            ],
            capApplied: evalRes.capApplied,
            regimeBasis: regime.basis,
            economics: economicsFor(current.length, opts.adminFeeUsd),
          });
        } else {
          for (const item of current) {
            unbatched.push({ item, reason: `Batch evaluation failed: ${evalRes.failures.join("; ")}` });
          }
        }
      } else {
        for (const item of current) {
          unbatched.push({ item, reason: "Singleton: fewer than 2 batchable line items in this payer/provider grouping." });
        }
      }
      current = [];
    };
    for (const c of members) {
      const trial = [...current, c];
      const overCap = trial.length > cap;
      const res = overCap
        ? { eligible: false }
        : evaluateBatchEligibility(trial, {
            openNegotiationNoticeDate: opts.openNegotiationNoticeDate,
            now: opts.now,
            useNowFallback: opts.useNowFallback,
            env,
          });
      if (res.eligible) {
        current = trial;
      } else {
        flush();
        current = [c];
      }
    }
    flush();
  }

  return {
    batches,
    unbatched,
    poolSize: candidates.length,
    citations: [...BATCHING_CITATIONS],
  };
}
