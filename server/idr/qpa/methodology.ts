/**
 * server/idr/qpa/methodology.ts
 *
 * Statutory Qualifying Payment Amount (QPA) methodology per 45 CFR 149.140.
 * Every rule encoded here was verified against the current eCFR text
 * (accessed 2026-09-07):
 *   https://www.ecfr.gov/current/title-45/subtitle-B/subchapter-B/part-149/subpart-D/section-149.140
 *
 * Verified rules encoded (quotes are brief excerpts from eCFR, 2026-09-07):
 *
 * (a)(1) Contracted rate: "the total amount (including cost sharing) that a
 *   group health plan or health insurance issuer has contractually agreed to
 *   pay a participating provider..." — AND "a single case agreement, letter of
 *   agreement, or other similar arrangement ... does not constitute a
 *   contract" for this definition. => SINGLE_CASE_AGREEMENT / LETTER_OF_AGREEMENT
 *   rows are EXCLUDED from the median population.
 *
 * (a)(15) Sufficient information: "(i) The plan or issuer has at least three
 *   contracted rates on January 31, 2019, to calculate the median of the
 *   contracted rates" (and, for later years, at least three contracted rates
 *   on January 31 of the preceding year accounting for at least 25 percent of
 *   claims). => Fewer than 3 eligible contracted rates => NOT computable;
 *   per (c)(3) the fallback is an eligible database — this engine never
 *   invents a number and returns fallback 'ELIGIBLE_DATABASE_REQUIRED'.
 *
 * (b)(1) Median: "arranging in order from least to greatest the contracted
 *   rates ... and selecting the middle number. If there are an even number of
 *   contracted rates, the median contracted rate is the average of the middle
 *   two contracted rates." Standard statistical median, one rate per contract.
 *
 * (b)(2)(i)/(a)(8) Insurance market: median is computed within one insurance
 *   market — individual, large group, small group, or self-insured (all
 *   self-insured plans of the same plan sponsor, or at sponsor option all
 *   self-insured plans administered by the same entity). => `market` is a
 *   required dimension; rates never mix across markets.
 *
 * (a)(7) Geographic region: primary region is one MSA in a State plus one
 *   region of all other portions of the State (Census-division fallbacks only
 *   when information is insufficient — represented by the caller's region key;
 *   this engine computes exactly within the region key supplied).
 *
 * (b)(2)(iii) Non-fee-for-service: "payments ... not on a fee-for-service
 *   basis (such as bundled or capitation payments)" must use "the underlying
 *   fee schedule rates"; if none, "the derived amount". => NON_FFS rows are
 *   eligible ONLY if they carry an underlying fee-schedule rate or derived
 *   amount; otherwise they are excluded (fail-closed, never estimated).
 *
 * (b)(2)(iv) "Exclude risk sharing, bonus, penalty, or other incentive-based
 *   or retrospective payments or payment adjustments." => rows whose
 *   arrangementType is an adjustment-only category are excluded.
 *
 * (c)(1)(i) 2022 indexing: increase the Jan 31, 2019 median by "the combined
 *   percentage increase ... to reflect the percentage increase in the CPI-U
 *   over 2019, ... over 2020, and ... over 2021"; CPI-U per year is "the
 *   average of the CPI-U as of the close of the 12-month period ending on
 *   August 31 of the calendar year" (combined increase =
 *   (CPI-U2019/CPI-U2018)×(CPI-U2020/CPI-U2019)×(CPI-U2021/CPI-U2020)).
 *
 * (c)(1)(ii) 2023+ indexing: increase the prior-year QPA "by the percentage
 *   increase as published by the Department of the Treasury and the Internal
 *   Revenue Service" (CPI-Upresent/CPI-Uprior). Because year-over-year
 *   increases chain multiplicatively, this engine accepts a table of
 *   CUMULATIVE factors from the 2019 baseline to each target year
 *   (factor(2022) = combined 2019–2021 increase; factor(y) = factor(y-1) ×
 *   published increase for y). Factors are INJECTED — env JSON override or
 *   the qpa_cpi_factors table — and a requested year with no factor is a
 *   hard failure (fail-closed); the engine never synthesizes an index.
 *
 * GHOST-RATE DOCUMENTATION HOOK: so-called "ghost rates" (contracted rates
 * nominally on paper but never actually paid / for providers never utilized)
 * were a TMA III litigation subject; the regulation's sufficient-information
 * test (a)(15)(ii)(B) requires rates to account for ≥25% of claims for
 * later-year medians. This engine exposes a `claimsSharePercent` field on
 * ingested rows so deployments can enforce the ≥25% criterion for
 * non-2019-baseline medians; rows flagged with claimsSharePercent = 0 are
 * eligible for the 2019-baseline median (where (a)(15)(i) has no claims-share
 * prong) but are reported in the exclusion audit detail so reviewers can
 * document ghost-rate review. See provenance output field.
 */

export const QPA_CITATIONS = [
  "45 CFR 149.140(a)(1) (contracted rate; single case agreements excluded)",
  "45 CFR 149.140(a)(7) (geographic region)",
  "45 CFR 149.140(a)(8) (insurance market)",
  "45 CFR 149.140(a)(15) (sufficient information: >=3 contracted rates; >=25% of claims for later years)",
  "45 CFR 149.140(b)(1) (median of contracted rates; average of middle two when even)",
  "45 CFR 149.140(b)(2)(iii) (non-fee-for-service: underlying fee schedule or derived amount)",
  "45 CFR 149.140(b)(2)(iv) (exclude risk sharing, bonus, penalty, incentive/retrospective adjustments)",
  "45 CFR 149.140(c)(1)(i) (2022: 2019-2021 combined CPI-U increase over Jan 31, 2019 median)",
  "45 CFR 149.140(c)(1)(ii) (2023+: prior-year QPA increased by published CPI-U increase)",
  "45 CFR 149.140(c)(3) (insufficient information -> eligible database fallback)",
  "https://www.ecfr.gov/current/title-45/subtitle-B/subchapter-B/part-149/subpart-D/section-149.140 (accessed 2026-09-07)",
] as const;

/** Statutory baseline date for the standard median (149.140(c)(1)(i)). */
export const QPA_BASELINE_DATE = "2019-01-31";

/**
 * Minimum contracted rates for "sufficient information" per
 * 149.140(a)(15)(i) / (a)(15)(ii)(A). Fail-closed below this.
 */
export const MIN_CONTRACTED_RATES = 3;

/** Insurance markets per 149.140(a)(8). */
export type InsuranceMarket =
  | "INDIVIDUAL"
  | "LARGE_GROUP"
  | "SMALL_GROUP"
  | "SELF_INSURED";

export const INSURANCE_MARKETS: readonly InsuranceMarket[] = [
  "INDIVIDUAL",
  "LARGE_GROUP",
  "SMALL_GROUP",
  "SELF_INSURED",
];

/** Arrangement types recognised by the ingestion schema. */
export type ArrangementType =
  | "FEE_FOR_SERVICE"
  | "SINGLE_CASE_AGREEMENT"
  | "LETTER_OF_AGREEMENT"
  | "NON_FFS_BUNDLED"
  | "NON_FFS_CAPITATION"
  | "RISK_SHARING_ADJUSTMENT"
  | "BONUS_PENALTY_ADJUSTMENT";

export const ARRANGEMENT_TYPES: readonly ArrangementType[] = [
  "FEE_FOR_SERVICE",
  "SINGLE_CASE_AGREEMENT",
  "LETTER_OF_AGREEMENT",
  "NON_FFS_BUNDLED",
  "NON_FFS_CAPITATION",
  "RISK_SHARING_ADJUSTMENT",
  "BONUS_PENALTY_ADJUSTMENT",
];

/** One contracted-rate observation (validated ingestion row, cents to avoid float drift). */
export interface ContractedRateRow {
  payerId: string;
  serviceCode: string;
  market: InsuranceMarket;
  region: string;
  /** Contracted rate in cents; for NON_FFS rows this is the nominal rate (see underlying/derived). */
  contractedRateCents: number;
  arrangementType: ArrangementType;
  /** Effective date of the contract rate (ISO day or Date). */
  effectiveDate: Date | string;
  /** (b)(2)(iii) underlying fee schedule rate for non-FFS arrangements, cents. */
  underlyingFeeScheduleCents?: number;
  /** (b)(2)(iii) derived amount when no underlying fee schedule rate exists, cents. */
  derivedAmountCents?: number;
  /**
   * (a)(15)(ii)(B) / ghost-rate documentation hook: share of claims the rate
   * accounted for (0–100). 0 is admissible for the 2019 baseline but is
   * surfaced in the audit detail for ghost-rate review.
   */
  claimsSharePercent?: number;
}

export interface RateExclusion {
  rowIndex: number;
  reason:
    | "NOT_A_CONTRACT" // (a)(1): single case / letter of agreement
    | "NON_FFS_NO_UNDERLYING_RATE" // (b)(2)(iii)
    | "ADJUSTMENT_ONLY" // (b)(2)(iv)
    | "WRONG_DIMENSION" // service code / market / region mismatch
    | "NOT_EFFECTIVE"; // not in effect on the baseline/as-of date
}

export interface MedianComputation {
  computable: boolean;
  /** Median in cents when computable; otherwise null. Never invented. */
  medianCents: number | null;
  ratesUsed: number;
  /** Eligible rates actually used (sorted ascending), cents. */
  eligibleRatesCents: number[];
  exclusions: RateExclusion[];
  reason?: string;
  fallback?: "ELIGIBLE_DATABASE_REQUIRED";
  citations: string[];
}

/** Cumulative CPI-U escalation table from the 2019 baseline. */
export interface CpiFactorTable {
  /** Baseline year; factor must be exactly 1 for baseYear. */
  baseYear: number;
  /** Cumulative multiplier for each calendar year >= baseYear. */
  factors: Record<number, number>;
}

function isoDay(d: Date | string): string {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

/** Classify a single row for eligibility; returns exclusion reason or null. */
export function classifyRow(
  row: ContractedRateRow,
  dimension: { serviceCode: string; market: InsuranceMarket; region: string; asOfDate: Date | string }
): RateExclusion["reason"] | null {
  if (
    row.serviceCode !== dimension.serviceCode ||
    row.market !== dimension.market ||
    row.region !== dimension.region
  ) {
    return "WRONG_DIMENSION";
  }
  if (isoDay(row.effectiveDate) > isoDay(dimension.asOfDate)) {
    return "NOT_EFFECTIVE";
  }
  // (a)(1): single case agreements / letters of agreement "do not constitute a contract".
  if (row.arrangementType === "SINGLE_CASE_AGREEMENT" || row.arrangementType === "LETTER_OF_AGREEMENT") {
    return "NOT_A_CONTRACT";
  }
  // (b)(2)(iv): exclude risk sharing, bonus, penalty, incentive/retrospective adjustments.
  if (row.arrangementType === "RISK_SHARING_ADJUSTMENT" || row.arrangementType === "BONUS_PENALTY_ADJUSTMENT") {
    return "ADJUSTMENT_ONLY";
  }
  // (b)(2)(iii): non-FFS arrangements must use underlying fee schedule or derived amount.
  if (
    (row.arrangementType === "NON_FFS_BUNDLED" || row.arrangementType === "NON_FFS_CAPITATION") &&
    row.underlyingFeeScheduleCents == null &&
    row.derivedAmountCents == null
  ) {
    return "NON_FFS_NO_UNDERLYING_RATE";
  }
  return null;
}

/** Rate value to use for the median after eligibility: (b)(2)(iii) substitution. */
export function effectiveRateCents(row: ContractedRateRow): number {
  if (row.arrangementType === "NON_FFS_BUNDLED" || row.arrangementType === "NON_FFS_CAPITATION") {
    return row.underlyingFeeScheduleCents ?? row.derivedAmountCents!;
  }
  return row.contractedRateCents;
}

/** (b)(1) median over sorted rates; average of middle two for even n. */
export function median(sortedAscending: number[]): number {
  const n = sortedAscending.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sortedAscending[mid] : (sortedAscending[mid - 1] + sortedAscending[mid]) / 2;
}

/**
 * Compute the median contracted rate for one (serviceCode, market, region)
 * dimension as of a date. Fail-closed: fewer than MIN_CONTRACTED_RATES
 * eligible rates => computable:false with the (c)(3) eligible-database
 * fallback marker. No defaults, no synthetic numbers.
 */
export function computeMedianContractedRate(
  rows: ContractedRateRow[],
  dimension: { serviceCode: string; market: InsuranceMarket; region: string; asOfDate: Date | string }
): MedianComputation {
  const exclusions: RateExclusion[] = [];
  const eligible: number[] = [];
  rows.forEach((row, i) => {
    const reason = classifyRow(row, dimension);
    if (reason) exclusions.push({ rowIndex: i, reason });
    else eligible.push(effectiveRateCents(row));
  });
  eligible.sort((a, b) => a - b);

  if (eligible.length < MIN_CONTRACTED_RATES) {
    return {
      computable: false,
      medianCents: null,
      ratesUsed: eligible.length,
      eligibleRatesCents: eligible,
      exclusions,
      reason:
        `Insufficient information under 45 CFR 149.140(a)(15): ${eligible.length} eligible ` +
        `contracted rate(s); at least ${MIN_CONTRACTED_RATES} are required. No QPA is computed ` +
        `from insufficient data.`,
      fallback: "ELIGIBLE_DATABASE_REQUIRED",
      citations: [...QPA_CITATIONS],
    };
  }

  const m = median(eligible);
  return {
    computable: true,
    // Median of integer cents may be a x.5 value; round half up to cents.
    medianCents: Math.round(m),
    ratesUsed: eligible.length,
    eligibleRatesCents: eligible,
    exclusions,
    citations: [...QPA_CITATIONS],
  };
}

export interface CpiResolution {
  ok: boolean;
  factor?: number;
  year?: number;
  reason?: string;
}

/**
 * Resolve the cumulative CPI-U escalation factor for a target year from an
 * injected table (149.140(c)(1)(i)/(ii)). Fail-closed when the year (or the
 * 2019 baseline chain) is absent — a missing index is never approximated.
 */
export function resolveCpiFactor(table: CpiFactorTable | null | undefined, targetYear: number): CpiResolution {
  if (!table) {
    return { ok: false, reason: "No CPI-U factor table loaded; escalation cannot be computed (fail-closed)." };
  }
  const base = table.factors[table.baseYear];
  if (base !== 1) {
    return { ok: false, reason: `Invalid CPI table: factor for base year ${table.baseYear} must be exactly 1.` };
  }
  const f = table.factors[targetYear];
  if (typeof f !== "number" || !Number.isFinite(f) || f <= 0) {
    return {
      ok: false,
      reason:
        `No published CPI-U factor for ${targetYear} in the loaded table. Per 45 CFR 149.140(c)(1)(i)/(ii) ` +
        `the increase must be the percentage increase published by Treasury/IRS; the engine does not estimate it.`,
    };
  }
  return { ok: true, factor: f, year: targetYear };
}

/** Environment variable carrying a JSON CPI factor table: {"baseYear":2019,"factors":{"2022":1.0649,...}}. */
export const CPI_FACTORS_ENV = "QPA_CPI_FACTORS_JSON";

/**
 * Load CPI factors from the environment override. Returns null (fail-closed)
 * when absent or malformed — callers must treat null as uncomputable, not as
 * "no escalation".
 */
export function loadCpiFactorsFromEnv(env: NodeJS.ProcessEnv = process.env): CpiFactorTable | null {
  const raw = env[CPI_FACTORS_ENV];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CpiFactorTable;
    if (typeof parsed?.baseYear !== "number" || typeof parsed?.factors !== "object" || !parsed.factors) {
      return null;
    }
    const factors: Record<number, number> = {};
    for (const [k, v] of Object.entries(parsed.factors)) {
      const y = Number(k);
      if (!Number.isInteger(y) || typeof v !== "number") return null;
      factors[y] = v;
    }
    return { baseYear: parsed.baseYear, factors };
  } catch {
    return null;
  }
}
