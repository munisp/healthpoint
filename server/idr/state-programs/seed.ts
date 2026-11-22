/**
 * server/idr/state-programs/seed.ts
 *
 * W1-F7: data seed for the jurisdiction registry. NOT wired into resolver
 * logic — resolution still depends only on registered entries; this module
 * simply provides an idempotent bootstrap (`seedStateRegistry()`) callable
 * from scripts/seed-all or deployment bootstrap.
 *
 * DATA VINTAGE + SOURCE (honesty):
 *   Vintage: 2026-09. Sources: Peterson-KFF Health System Tracker explainer
 *   (2024-07, aggregate counts), CMS "specified state law" determination
 *   letters, and the cited state statutes/agency pages below. Per-state
 *   specifics MUST be re-verified against current statute/agency guidance
 *   before reliance; entries whose details we have not independently
 *   re-verified are marked UNVERIFIED and the resolver treats them as
 *   provisional.
 *
 * Contents:
 *  - TX: full specified-state-law entry (SB 1264, Tex. Ins. Code ch. 1467).
 *  - CA, FL, GA: specified-state-law entries (PARTIAL/ bifurcated where
 *    applicable) with statutory citations.
 *  - FEDERAL_PATH_STATES: documented states with no specified state law
 *    identified as of the vintage — the federal NSA process applies.
 *  - All-payer-model-agreement representation: `allPayerModelAgreement`
 *    { type, note } on every entry (IN_EFFECT only where documented).
 */

import { registerStateProgram } from './registry';
import type { StateProgramEntry } from './types';

export const SEED_DATA_VINTAGE = '2026-09';
export const SEED_SOURCE_NOTE =
  'Seed data vintage 2026-09. Sources: Peterson-KFF Health System Tracker (2024-07); ' +
  'CMS specified-state-law determination letters; cited state statutes/agency pages. ' +
  'Re-verify against current state law before reliance.';

export const STATE_PROGRAM_SEED: readonly StateProgramEntry[] = [
  {
    stateCode: 'TX',
    programName: 'Texas surprise-billing arbitration (SB 1264)',
    appliesToFullyInsured: true,
    selfFundedOptIn: true,
    scopeVsFederal: 'FULL',
    paymentDeterminationMethod: 'ARBITRATION',
    arbitrationStyle: 'baseball-style',
    keyDeadlines: [
      {
        name: 'Request arbitration after mediation/negotiation failure',
        calendarDays: 45,
        citation: 'Tex. Ins. Code § 1467.056 (SB 1264, 2019)',
      },
    ],
    effectiveDates: [
      { rule: 'SB 1264 balance-billing protections and arbitration take effect', effectiveDate: '2020-01-01' },
    ],
    authorityUrl: 'https://www.tdi.texas.gov/consumer/surprise-balance-billing.html',
    verificationStatus: 'VERIFIED',
    notes:
      'CMS recognizes Texas law as specified state law for fully-insured coverage; ' +
      'self-funded plans may elect (opt in) to the Texas process. ' + SEED_SOURCE_NOTE,
    allPayerModelAgreement: {
      type: 'NONE',
      note: 'No CMS all-payer model agreement identified for Texas as of 2026-09.',
    },
  },
  {
    stateCode: 'CA',
    programName: 'California out-of-network billing protections (AB 72)',
    appliesToFullyInsured: true,
    selfFundedOptIn: false,
    scopeVsFederal: 'PARTIAL',
    paymentDeterminationMethod: 'HYBRID',
    arbitrationStyle: 'benchmark default with IDR backstop (DMHC/CDI)',
    keyDeadlines: [
      {
        name: 'Non-contracted provider dispute-resolution request',
        calendarDays: 365,
        citation: 'Cal. Health & Safety Code § 1371.31; Cal. Ins. Code § 10112.8 (AB 72, 2016)',
      },
    ],
    effectiveDates: [
      { rule: 'AB 72 protections take effect', effectiveDate: '2017-07-01' },
    ],
    authorityUrl: 'https://dmhc.ca.gov/',
    verificationStatus: 'VERIFIED',
    notes:
      'Bifurcated: state process governs in-scope fully-insured items; federal IDR applies ' +
      'out of scope. ' + SEED_SOURCE_NOTE,
    allPayerModelAgreement: {
      type: 'NONE',
      note: 'No CMS all-payer model agreement identified for California as of 2026-09.',
    },
  },
  {
    stateCode: 'FL',
    programName: 'Florida balance-billing protections (HB 221)',
    appliesToFullyInsured: true,
    selfFundedOptIn: 'UNKNOWN',
    scopeVsFederal: 'PARTIAL',
    paymentDeterminationMethod: 'UNKNOWN',
    keyDeadlines: [],
    effectiveDates: [
      { rule: 'HB 221 protections take effect', effectiveDate: '2016-07-01' },
    ],
    authorityUrl: 'https://www.floir.com/',
    verificationStatus: 'UNVERIFIED',
    notes:
      'Fla. Stat. §§ 627.64194, 627.6471, 641.513 (HB 221, 2016). Payment-dispute mechanics ' +
      'not independently re-verified in this seed; treat as provisional. ' + SEED_SOURCE_NOTE,
    allPayerModelAgreement: {
      type: 'UNKNOWN',
      note: 'All-payer-model-agreement status not verified for Florida as of 2026-09.',
    },
  },
  {
    stateCode: 'GA',
    programName: 'Georgia Surprise Billing Consumer Protection Act (HB 888)',
    appliesToFullyInsured: true,
    selfFundedOptIn: 'UNKNOWN',
    scopeVsFederal: 'PARTIAL',
    paymentDeterminationMethod: 'ARBITRATION',
    arbitrationStyle: 'baseball-style',
    keyDeadlines: [
      {
        name: 'Arbitration request after payer payment/denial',
        calendarDays: 90,
        citation: 'Ga. Code Ann. § 33-20E-11 (HB 888, 2020)',
      },
    ],
    effectiveDates: [
      { rule: 'HB 888 protections take effect', effectiveDate: '2021-01-01' },
    ],
    authorityUrl: 'https://oci.georgia.gov/',
    verificationStatus: 'VERIFIED',
    notes:
      'Bifurcated: state arbitration governs in-scope fully-insured items; federal IDR ' +
      'applies out of scope. ' + SEED_SOURCE_NOTE,
    allPayerModelAgreement: {
      type: 'NONE',
      note: 'No CMS all-payer model agreement identified for Georgia as of 2026-09.',
    },
  },
];

/**
 * Documented federal-path states: no specified state law identified as of the
 * seed vintage, so the federal NSA IDR process applies to fully-insured and
 * self-funded coverage alike. Registered as UNVERIFIED 'UNKNOWN'-scope
 * entries — the resolver fails closed to FEDERAL, which IS the documented
 * correct outcome for these states; the entries exist so the registry can
 * distinguish "researched, federal path" from "never researched".
 */
export const FEDERAL_PATH_STATES = ['PA', 'OH', 'WI', 'AR', 'TN', 'SC'] as const;

export const FEDERAL_PATH_SEED: readonly StateProgramEntry[] = FEDERAL_PATH_STATES.map(
  (stateCode) => ({
    stateCode,
    programName: `No specified state law identified — federal NSA process applies (${stateCode})`,
    appliesToFullyInsured: false,
    selfFundedOptIn: false,
    scopeVsFederal: 'UNKNOWN',
    paymentDeterminationMethod: 'UNKNOWN',
    keyDeadlines: [],
    effectiveDates: [],
    authorityUrl: 'https://www.cms.gov/medical-bill-rights',
    verificationStatus: 'UNVERIFIED',
    notes:
      `Documented federal-path state as of ${SEED_DATA_VINTAGE}: no state surprise-billing ` +
      'law displacing the federal process was identified. The resolver fails closed to the ' +
      'federal NSA process, which is the documented outcome. ' + SEED_SOURCE_NOTE,
    allPayerModelAgreement: {
      type: 'UNKNOWN',
      note: `All-payer-model-agreement status not verified for ${stateCode} as of ${SEED_DATA_VINTAGE}.`,
    },
  }),
);

/**
 * Idempotent registry bootstrap: registerStateProgram replaces existing
 * entries by stateCode, so repeated calls converge to the same registry
 * contents. Safe to call from scripts/seed-all on every deploy.
 */
export function seedStateRegistry(): { seeded: string[] } {
  const seeded: string[] = [];
  for (const entry of [...STATE_PROGRAM_SEED, ...FEDERAL_PATH_SEED]) {
    registerStateProgram(entry);
    seeded.push(entry.stateCode);
  }
  return { seeded };
}
