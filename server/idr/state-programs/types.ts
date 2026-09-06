/**
 * HealthPoint NSA/IDR — State IDR Program Registry: schema types.
 *
 * Strategic expansion #1: multi-jurisdiction State IDR programs.
 *
 * Honesty note: this module ships the SCHEMA only. Per-state legal facts
 * are NOT verified in our source set (Peterson-KFF Health System Tracker
 * explainer + federal NSA framework). All per-state entries must be
 * registered via registerStateProgram() and default to UNVERIFIED.
 */

/** Tri-state for facts we cannot yet confirm for a given state. */
export type TriState = boolean | 'UNKNOWN';

export type ScopeVsFederal = 'FULL' | 'PARTIAL' | 'UNKNOWN';

export type PaymentDeterminationMethod =
  | 'ARBITRATION'
  | 'BENCHMARK'
  | 'HYBRID'
  | 'UNKNOWN';

export type VerificationStatus = 'VERIFIED' | 'UNVERIFIED';

/** A single statutory/regulatory deadline in the state process. */
export interface KeyDeadline {
  name: string;
  /** Exactly one of businessDays / calendarDays should be set when known. */
  businessDays?: number;
  calendarDays?: number;
  /** Statute/reg citation. Required for VERIFIED entries (enforced by registry). */
  citation: string;
}

/** An effective-dated rule change, supporting future rule evolution. */
export interface EffectiveDatedRule {
  rule: string;
  /** ISO-8601 date (YYYY-MM-DD). */
  effectiveDate: string;
}

/** One state's IDR / surprise-billing program registry entry. */
export interface StateProgramEntry {
  /** Two-letter USPS state code, uppercase (e.g. 'TX'). */
  stateCode: string;
  programName: string;
  /** Does the state process apply to fully-insured plans? */
  appliesToFullyInsured: TriState;
  /** May self-funded employer plans opt into the state process? */
  selfFundedOptIn: TriState;
  /** FULL = state law covers the federal surprise-billing scope; PARTIAL = bifurcated. */
  scopeVsFederal: ScopeVsFederal;
  paymentDeterminationMethod: PaymentDeterminationMethod;
  /** Free-form style note (e.g. 'baseball-style'); no fabricated detail. */
  arbitrationStyle?: string;
  keyDeadlines: KeyDeadline[];
  effectiveDates: EffectiveDatedRule[];
  /** Official statute/agency URL, or null if not yet sourced. */
  authorityUrl: string | null;
  verificationStatus: VerificationStatus;
  notes: string;
}

/** Registry-level metadata, derived from verified aggregate facts. */
export interface RegistryMetadata {
  /** States with some surprise-billing protections (fully-insured market). */
  statesWithSomeProtections: number;
  /** Of those, states where state law covers only part of federal scope. */
  bifurcatedOfThose: number;
  source: string;
  /** Currency of the aggregate facts (YYYY-MM). */
  asOf: string;
}

/** Jurisdiction resolution inputs. */
export type PlanType = 'FULLY_INSURED' | 'SELF_FUNDED';
export type ServiceCategory =
  | 'EMERGENCY'
  | 'NON_EMERGENCY'
  | 'AIR_AMBIANCE'
  | 'POST_STABILIZATION';

export interface JurisdictionInput {
  planType: PlanType;
  stateCode: string;
  serviceCategory: ServiceCategory;
  /** ISO-8601 date (YYYY-MM-DD). */
  dateOfService: string;
  /**
   * For SELF_FUNDED plans only: has the plan opted into the registered
   * state process? Ignored (and warned about) for fully-insured plans.
   */
  optedIn?: boolean;
}

export type Regime = 'FEDERAL' | 'STATE' | 'BIFURCATED_SPLIT';

export interface JurisdictionResult {
  regime: Regime;
  /** Present when a registered state program participates in the outcome. */
  stateProgramId?: string;
  rationale: string;
  verificationStatus: VerificationStatus;
  warnings: string[];
}
