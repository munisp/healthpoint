/**
 * server/idr/qpa/engine.ts
 *
 * computeQPA(serviceCode, market, region, asOfDate) — the statutory QPA
 * entrypoint. Composition of methodology.ts (median + eligibility + CPI
 * indexing) over contracted rates supplied by a rate provider (Postgres via
 * drizzle/schema-qpa.ts, or any injected source in tests).
 *
 * FAIL-CLOSED GUARANTEES (45 CFR 149.140; eCFR accessed 2026-09-07):
 *  - No contracted rates / fewer than 3 eligible rates (a)(15):
 *    computable:false, qpaCents:null, fallback 'ELIGIBLE_DATABASE_REQUIRED'
 *    (the (c)(3) eligible-database path is the regulated fallback; this engine
 *    does not stand in for it and never fabricates a value).
 *  - No CPI-U factor for the requested year: computable:false,
 *    reason CPI_FACTOR_UNAVAILABLE ((c)(1)(i)/(ii) require the published
 *    Treasury/IRS increase).
 *  - No CPI table at all: computable:false, same reason family.
 */

import {
  airAmbulanceRegionKey,
  classifyAirAmbulanceCode,
  computeMedianContractedRate,
  computeNewServiceCodeStatus,
  loadCpiFactorsFromEnv,
  resolveCpiFactor,
  QPA_BASELINE_DATE,
  QPA_CITATIONS,
  type AirAmbulanceCodeKind,
  type CpiFactorTable,
  type ContractedRateRow,
  type InsuranceMarket,
  type NewServiceCodeStatus,
} from "./methodology";
import type { IngestionProvenance } from "./ingestion";

export interface QpaComputeInput {
  serviceCode: string;
  market: InsuranceMarket;
  region: string;
  /** Date the item or service was furnished; selects the CPI target year. */
  asOfDate: Date | string;
  /**
   * W1-F6: for air ambulance services, the point-of-pickup geography key.
   * When set (or when the service code is an air ambulance code), the QPA
   * region dimension is the point-of-pickup region
   * (45 CFR 149.140(a)(7)(iii)) and supersedes `region`.
   */
  pointOfPickup?: string;
}

export interface QpaComputeDeps {
  /** All contracted rates for the payer/dimension universe (pre-filtered or not). */
  rates: ContractedRateRow[];
  /** Injected CPI factor table; falls back to env JSON override. */
  cpiFactors?: CpiFactorTable | null;
  env?: NodeJS.ProcessEnv;
  /** Provenance summary of the ingested batches contributing rates. */
  provenance?: IngestionProvenance[];
  /**
   * W1-F8: ingestion-tracked first-seen dates by service code (ISO days),
   * making the 90-day new-service-code window computable.
   */
  serviceCodeFirstSeen?: Record<string, string>;
}

export interface QpaComputeResult {
  qpaCents: number | null;
  computable: boolean;
  methodology: string;
  ratesUsed: number;
  /** Cumulative CPI-U factor applied (2019 baseline -> service year), or null. */
  cpiFactor: number | null;
  /** Median of contracted rates at the 2019 baseline before indexing, cents. */
  medianContractedRateCents: number | null;
  serviceYear: number;
  reason?: string;
  fallback?: "ELIGIBLE_DATABASE_REQUIRED";
  /** W1-F8: structured detail when the code lacks a 2019 baseline. */
  newServiceCode?: NewServiceCodeStatus;
  /**
   * W1-F6: air ambulance detail. Present when the service code is an air
   * ambulance code — mileage-rated services are flagged and computed only
   * against mileage-code rates (never median-mixed with base rates).
   */
  airAmbulance?: {
    codeKind: AirAmbulanceCodeKind;
    mileageRated: boolean;
    regionBasis: "POINT_OF_PICKUP";
    region: string;
  };
  citations: string[];
  provenanceSummary: {
    batchCount: number;
    sourceTypes: string[];
    sourceRefs: string[];
  };
}

function isoDay(d: Date | string): string {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

export function computeQPA(input: QpaComputeInput, deps: QpaComputeDeps): QpaComputeResult {
  const serviceYear = Number(isoDay(input.asOfDate).slice(0, 4));
  const provs = deps.provenance ?? [];
  const provenanceSummary = {
    batchCount: provs.length,
    sourceTypes: [...new Set(provs.map(p => p.sourceType))],
    sourceRefs: provs.map(p => p.sourceRef),
  };
  const methodology =
    "45 CFR 149.140: median of contracted rates (b)(1), per service code / insurance market (a)(8) / " +
    "geographic region (a)(7), single-case agreements excluded (a)(1), non-FFS via underlying fee schedule " +
    "or derived amount (b)(2)(iii), incentive/retrospective adjustments excluded (b)(2)(iv), indexed from the " +
    "Jan 31, 2019 baseline by published CPI-U increases (c)(1)(i)/(ii).";

  const base: Omit<QpaComputeResult, "qpaCents" | "computable" | "ratesUsed" | "cpiFactor" | "medianContractedRateCents"> = {
    methodology, serviceYear, citations: [...QPA_CITATIONS], provenanceSummary,
  };
  const fail = (reason: string, fallback?: "ELIGIBLE_DATABASE_REQUIRED", extra?: Partial<QpaComputeResult>): QpaComputeResult => ({
    ...base, qpaCents: null, computable: false, ratesUsed: 0, cpiFactor: null,
    medianContractedRateCents: null, reason, fallback, ...extra,
  });

  // W1-F6: air ambulance branch — point-of-pickup geography key; mileage
  // codes are flagged and remain a distinct median dimension from base rates.
  const aaKind = classifyAirAmbulanceCode(input.serviceCode);
  let region = input.region;
  let airAmbulance: QpaComputeResult["airAmbulance"];
  if (aaKind) {
    region = input.pointOfPickup
      ? airAmbulanceRegionKey(input.pointOfPickup)
      : (input.region.startsWith("AA_POP:") ? input.region : airAmbulanceRegionKey(input.region));
    airAmbulance = {
      codeKind: aaKind,
      mileageRated: aaKind === "MILEAGE",
      regionBasis: "POINT_OF_PICKUP",
      region,
    };
  }

  // W1-F8 (149.140(c)(3)): explicit per-code new-service-code recognition.
  const code = input.serviceCode.trim().toUpperCase();
  const newCode = computeNewServiceCodeStatus(deps.rates ?? [], code, {
    firstSeenDate: deps.serviceCodeFirstSeen?.[code] ?? null,
    asOfDate: input.asOfDate,
  });
  if (newCode.isNewServiceCode) {
    return fail(newCode.reason, "ELIGIBLE_DATABASE_REQUIRED", {
      newServiceCode: newCode,
      ...(airAmbulance ? { airAmbulance } : {}),
    });
  }

  if (!deps.rates || deps.rates.length === 0) {
    return fail(
      "No ingested contracted rates available. The engine computes only from validated ingested data " +
      "(ingestContractedRates); it returns no illustrative or default benchmark value.",
      "ELIGIBLE_DATABASE_REQUIRED",
      { newServiceCode: newCode, ...(airAmbulance ? { airAmbulance } : {}) }
    );
  }

  // Median at the statutory baseline date (Jan 31, 2019) — (c)(1)(i).
  const med = computeMedianContractedRate(deps.rates, {
    serviceCode: input.serviceCode,
    market: input.market,
    region,
    asOfDate: QPA_BASELINE_DATE,
  });
  if (!med.computable) {
    return {
      ...base, qpaCents: null, computable: false, ratesUsed: med.ratesUsed,
      cpiFactor: null, medianContractedRateCents: null,
      reason: med.reason!, fallback: med.fallback,
      newServiceCode: newCode,
      ...(airAmbulance ? { airAmbulance } : {}),
    };
  }

  const table = deps.cpiFactors ?? loadCpiFactorsFromEnv(deps.env ?? process.env);
  const cpi = resolveCpiFactor(table, serviceYear);
  if (!cpi.ok) {
    return fail(`CPI_FACTOR_UNAVAILABLE: ${cpi.reason}`, undefined, { ratesUsed: med.ratesUsed, medianContractedRateCents: med.medianCents });
  }

  // QPA = median(2019) × cumulative CPI-U factor to the service year.
  // Cents may become fractional under indexing; round to nearest cent.
  const qpaCents = Math.round(med.medianCents! * cpi.factor!);
  return {
    ...base,
    qpaCents,
    computable: true,
    ratesUsed: med.ratesUsed,
    cpiFactor: cpi.factor!,
    medianContractedRateCents: med.medianCents,
    newServiceCode: newCode,
    ...(airAmbulance ? { airAmbulance } : {}),
    ...(airAmbulance?.mileageRated
      ? {
          reason:
            "Mileage-rated air ambulance service: the median is computed over mileage-code contracted rates " +
            "only and is never median-mixed with base rates (45 CFR 149.140(a)(7)(iii) point-of-pickup geography).",
        }
      : {}),
  };
}
