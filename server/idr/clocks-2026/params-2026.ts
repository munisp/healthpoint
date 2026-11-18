/**
 * server/idr/clocks-2026/params-2026.ts
 * Effective-dated 2026/2027 Federal IDR parameter configuration (CMS-9897-F,
 * Federal Independent Dispute Resolution Operations Final Rule, published
 * 91 FR 33900; rule effective 2026-08-03).
 *
 * Each parameter is effective-dated on its OWN statutory/applicability date,
 * verified 2026-09-07:
 *  - Administrative fee $15 per party per dispute for disputes INITIATED on or
 *    after 2026-06-11 (5 business days after publication; APA good-cause
 *    waiver). Prior tiers: $115 for disputes initiated 2024-01-22 through
 *    2026-06-10; $50 before 2024-01-22.
 *    Sources:
 *      https://www.cms.gov/newsroom/fact-sheets/federal-independent-dispute-resolution-operations-final-rule
 *      https://www.cms.gov/nosurprises/notices (December 21, 2023 fee notice)
 *      https://public-inspection.federalregister.gov/2026-11140.pdf
 *        ("(B) For disputes initiated on or after June 11, 2026, the
 *         administrative fee amount is $15 per party per dispute.")
 *  - Batched-dispute line-item cap 50 (legacy 25) for disputes whose open
 *    negotiation period begins on or after 2026-11-01.
 *    Source: https://www.cms.gov/files/document/federal-idr-operations-implementation-timeline.pdf
 *  - CARC/RARC usage requirements apply to items and services FURNISHED on or
 *    after 2027-01-01.
 *    Sources:
 *      https://www.aha.org/news/headline/2026-07-20-guidance-issued-new-claims-processing-codes-following-independent-dispute-resolution-updates
 *      https://www.cms.gov/files/document/federal-idr-operations-implementation-timeline.pdf
 *  - Federal IDR Registry: applicable 90 business days after the Departments
 *    announce registry functionality (expected ~2027; NOT yet live as of
 *    2026-09-07). Default false; env IDR_REGISTRY_LIVE=true may flip it on,
 *    but never to true before the rule effective date.
 *    Source: https://www.cms.gov/newsroom/fact-sheets/federal-independent-dispute-resolution-operations-final-rule
 *  - QPA enforcement discretion (2021 methodology) applies to items/services
 *    furnished BEFORE 2026-10-01 (FAQs Part 73).
 *    Source: https://www.dol.gov/agencies/ebsa/about-ebsa/our-activities/resource-center/faqs/aca-part-73
 *
 * FAIL-CLOSED: an unparseable `asOf` throws; an asOf before the rule
 * effective date (2026-08-03) yields pre-amendment parameters except where a
 * provision has its own earlier applicability date (the $15 fee from
 * 2026-06-11); unknown future provisions default to their most conservative
 * (pre-amendment / not-live) state.
 */

export interface EffectiveIDRParameters {
  adminFeeUsd: number;
  batchCap: number;
  carcRarcRequired: boolean;
  idrRegistryLive: boolean;
  batchedCoolingOffBusinessDays: number | null;
  qpaEnforcementDiscretion: boolean;
  effectiveDates: {
    ruleEffectiveDate: string;
    adminFee15Effective: string;
    batchCap50Effective: string;
    carcRarcEffective: string;
    qpaEnforcementDiscretionEndsBefore: string;
    registryExpected: string;
  };
  citations: string[];
}

export const IDR_PARAMS_CITATIONS = [
  "CMS-9897-F, 91 FR 33900 (eff. 2026-08-03)",
  "45 CFR 149.510(d)(2)(ii)(B) ($15 administrative fee, disputes initiated on/after 2026-06-11)",
  "45 CFR 149.510(c)(4) as amended (50-line-item batch cap, ONPs beginning on/after 2026-11-01)",
  "https://www.cms.gov/newsroom/fact-sheets/federal-independent-dispute-resolution-operations-final-rule",
  "https://www.cms.gov/files/document/federal-idr-operations-implementation-timeline.pdf",
  "https://www.cms.gov/nosurprises/notices",
  "https://www.dol.gov/agencies/ebsa/about-ebsa/our-activities/resource-center/faqs/aca-part-73",
] as const;

export const PARAM_EFFECTIVE_DATES = {
  ruleEffectiveDate: "2026-08-03",
  adminFee15Effective: "2026-06-11",
  batchCap50Effective: "2026-11-01",
  carcRarcEffective: "2027-01-01",
  qpaEnforcementDiscretionEndsBefore: "2026-10-01",
  registryExpected: "2027 (90 business days after Departments' availability announcement)",
} as const;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function getEffectiveIDRParameters(
  asOf: Date,
  env: NodeJS.ProcessEnv = process.env
): EffectiveIDRParameters {
  if (!(asOf instanceof Date) || Number.isNaN(asOf.getTime())) {
    throw new Error("[idr-params-2026] fail-closed: asOf must be a valid Date");
  }
  const day = isoDay(asOf);
  const preRule = day < PARAM_EFFECTIVE_DATES.ruleEffectiveDate;

  // Administrative fee — effective-dated on the dispute INITIATION date.
  const adminFeeUsd =
    day >= PARAM_EFFECTIVE_DATES.adminFee15Effective ? 15
    : day >= "2024-01-22" ? 115
    : 50;

  // Batch cap — effective-dated on the ONP start date; pre-rule always 25.
  const batchCap = !preRule && day >= PARAM_EFFECTIVE_DATES.batchCap50Effective ? 50 : 25;

  // CARC/RARC — required for items/services furnished on/after 2027-01-01.
  const carcRarcRequired = !preRule && day >= PARAM_EFFECTIVE_DATES.carcRarcEffective;

  // IDR Registry — flag only; default false. Env may enable, never pre-rule.
  const registryOverride = (env.IDR_REGISTRY_LIVE ?? "").toLowerCase() === "true";
  const idrRegistryLive = !preRule && registryOverride;

  // Batched cooling-off — 30 business days only in the post-amendment batching
  // regime; null (legacy 90-calendar-day suspension) before 2026-11-01.
  const batchedCoolingOffBusinessDays =
    !preRule && day >= PARAM_EFFECTIVE_DATES.batchCap50Effective ? 30 : null;

  // QPA enforcement discretion — applies to items/services furnished BEFORE
  // 2026-10-01 (FAQs Part 73).
  const qpaEnforcementDiscretion = day < PARAM_EFFECTIVE_DATES.qpaEnforcementDiscretionEndsBefore;

  return {
    adminFeeUsd,
    batchCap,
    carcRarcRequired,
    idrRegistryLive,
    batchedCoolingOffBusinessDays,
    qpaEnforcementDiscretion,
    effectiveDates: { ...PARAM_EFFECTIVE_DATES },
    citations: [...IDR_PARAMS_CITATIONS],
  };
}
