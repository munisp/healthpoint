/**
 * HealthPoint NSA/IDR — Jurisdiction resolver.
 *
 * Decision tree (per verified federal framework):
 *  (a) SELF_FUNDED → FEDERAL, unless a registered state program has
 *      selfFundedOptIn === true AND the caller passes optedIn === true
 *      → STATE.
 *  (b) FULLY_INSURED with no registered state program → FEDERAL.
 *  (c) FULLY_INSURED with a registered PARTIAL program → BIFURCATED_SPLIT
 *      (state regime for in-scope items; federal IDR applies to
 *      out-of-scope items — the "bifurcated process").
 *  (d) FULLY_INSURED with a registered FULL program → STATE.
 *  Unregistered state → FEDERAL with note.
 *  scopeVsFederal === 'UNKNOWN' fails closed to FEDERAL with a warning.
 *
 * Fail-closed: unknown planType, malformed stateCode, unknown
 * serviceCategory, or malformed dateOfService → throw.
 */

import { getStateProgram, hasStateProgram } from './registry';
import type {
  JurisdictionInput,
  JurisdictionResult,
  PlanType,
  ServiceCategory,
} from './types';

const STATE_CODE_RE = /^[A-Z]{2}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const PLAN_TYPES: readonly PlanType[] = ['FULLY_INSURED', 'SELF_FUNDED'];
const SERVICE_CATEGORIES: readonly ServiceCategory[] = [
  'EMERGENCY',
  'NON_EMERGENCY',
  'AIR_AMBIANCE',
  'POST_STABILIZATION',
];

export class JurisdictionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JurisdictionInputError';
  }
}

function validateInput(input: JurisdictionInput): void {
  if (input === null || typeof input !== 'object') {
    throw new JurisdictionInputError('Input must be an object.');
  }
  if (!PLAN_TYPES.includes(input.planType)) {
    throw new JurisdictionInputError(
      `Unknown planType: ${JSON.stringify(input.planType)}. Expected one of ${PLAN_TYPES.join(', ')}.`,
    );
  }
  if (typeof input.stateCode !== 'string' || !STATE_CODE_RE.test(input.stateCode)) {
    throw new JurisdictionInputError(
      `Invalid stateCode: ${JSON.stringify(input.stateCode)}. Expected 2-letter uppercase USPS code.`,
    );
  }
  if (!SERVICE_CATEGORIES.includes(input.serviceCategory)) {
    throw new JurisdictionInputError(
      `Unknown serviceCategory: ${JSON.stringify(input.serviceCategory)}. Expected one of ${SERVICE_CATEGORIES.join(', ')}.`,
    );
  }
  if (typeof input.dateOfService !== 'string' || !ISO_DATE_RE.test(input.dateOfService)) {
    throw new JurisdictionInputError(
      `Invalid dateOfService: ${JSON.stringify(input.dateOfService)}. Expected ISO date YYYY-MM-DD.`,
    );
  }
}

const FEDERAL_FLOOR =
  'Federal floor (NSA / 45 CFR 149): federal IDR applies to self-funded plans everywhere and to fully-insured coverage where no specified state law applies.';

/**
 * Resolves which IDR regime governs a dispute. Never fabricates state law:
 * outcomes depend only on registered entries and verified aggregate facts.
 */
export function resolveJurisdiction(input: JurisdictionInput): JurisdictionResult {
  validateInput(input);
  const warnings: string[] = [];

  if (input.optedIn !== undefined && input.planType !== 'SELF_FUNDED') {
    warnings.push('optedIn flag is only meaningful for SELF_FUNDED plans and was ignored.');
  }

  const registered = hasStateProgram(input.stateCode);
  const program = registered ? getStateProgram(input.stateCode) : undefined;

  if (registered && program && program.verificationStatus === 'UNVERIFIED') {
    warnings.push(
      `State program ${input.stateCode} is registered but UNVERIFIED; treat the resolution as provisional pending legal research.`,
    );
  }

  // (a) Self-funded
  if (input.planType === 'SELF_FUNDED') {
    if (program && program.selfFundedOptIn === true && input.optedIn === true) {
      return {
        regime: 'STATE',
        stateProgramId: program.stateCode,
        rationale:
          `Self-funded plan in ${input.stateCode}: the registered state program permits self-funded opt-in and the plan has opted in, so the state process governs. ` +
          FEDERAL_FLOOR,
        verificationStatus: program.verificationStatus,
        warnings,
      };
    }
    if (program && program.selfFundedOptIn === true && input.optedIn !== true) {
      warnings.push(
        `State program ${input.stateCode} allows self-funded opt-in but optedIn was not set to true; defaulting to FEDERAL.`,
      );
    } else if (program && program.selfFundedOptIn === 'UNKNOWN' && input.optedIn === true) {
      warnings.push(
        `Caller asserted opt-in but whether ${input.stateCode} permits self-funded opt-in is UNKNOWN; failing closed to FEDERAL.`,
      );
    }
    return {
      regime: 'FEDERAL',
      rationale:
        `Self-funded plan in ${input.stateCode}: ERISA self-funded coverage is governed by the federal NSA process unless a verified state opt-in applies. ` +
        FEDERAL_FLOOR,
      verificationStatus: program?.verificationStatus ?? 'VERIFIED',
      warnings,
    };
  }

  // Fully-insured paths
  if (!program) {
    return {
      regime: 'FEDERAL',
      rationale:
        `Fully-insured plan in ${input.stateCode}: no state IDR program is registered for this state, so the federal NSA process applies by default. Note: absence of a registry entry is not proof that no state law applies; per-state legal research is pending. ` +
        FEDERAL_FLOOR,
      verificationStatus: 'VERIFIED',
      warnings: [
        ...warnings,
        `No registered state program for ${input.stateCode}; resolution relies on the federal floor only.`,
      ],
    };
  }

  switch (program.scopeVsFederal) {
    case 'FULL':
      // (d)
      return {
        regime: 'STATE',
        stateProgramId: program.stateCode,
        rationale:
          `Fully-insured plan in ${input.stateCode}: the registered state program covers the full federal surprise-billing scope, so the state process governs this ${input.serviceCategory} service.`,
        verificationStatus: program.verificationStatus,
        warnings,
      };
    case 'PARTIAL':
      // (c) bifurcated
      return {
        regime: 'BIFURCATED_SPLIT',
        stateProgramId: program.stateCode,
        rationale:
          `Fully-insured plan in ${input.stateCode}: the registered state program covers only a portion of federal surprise-billing protections (bifurcated process). The state regime governs items within state-law scope; the FEDERAL IDR process applies to out-of-scope items, including any ${input.serviceCategory} services not covered under state law. ` +
          FEDERAL_FLOOR,
        verificationStatus: program.verificationStatus,
        warnings: [
          ...warnings,
          'Bifurcated resolution: each disputed item must be classified as in-scope (STATE) or out-of-scope (FEDERAL) under state law before initiating IDR.',
        ],
      };
    case 'UNKNOWN':
    default:
      warnings.push(
        `scopeVsFederal for ${input.stateCode} is UNKNOWN; failing closed to FEDERAL pending verification.`,
      );
      return {
        regime: 'FEDERAL',
        stateProgramId: program.stateCode,
        rationale:
          `Fully-insured plan in ${input.stateCode}: a state program is registered but its scope relative to federal law is UNKNOWN, so the resolver fails closed to the federal NSA process. ` +
          FEDERAL_FLOOR,
        verificationStatus: 'UNVERIFIED',
        warnings,
      };
  }
}
