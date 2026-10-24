/**
 * server/eligibility/required-fields.ts
 *
 * CMS-required data dictionary per submission context (Phase 17 / E6).
 *
 * STANDALONE MODULE: no imports from the eligibility engine, routers, or the
 * DB — importable by any layer (engine, dispute-create guards, FSM
 * transition gates; the enforcement gates themselves are Phase 17-CE scope).
 *
 * Each field declares:
 *  - key: canonical camelCase key used across practice_claims / disputes.
 *  - label: human label for UI/checklists.
 *  - sources: ingestion paths that can supply the field
 *    ("fhir" = FHIR R4 single-pull or bulk $export, "835" = X12 remittance,
 *    "837" = X12 professional claim, "csv" = CSV import, "manual" = user
 *    entry). A field lists a source ONLY when that path can genuinely carry
 *    the data (e.g. an 837P has no plan-type segment — planType is fhir/
 *    csv/manual only).
 *  - citation: CFR / CMS form citation anchoring WHY the field is required.
 *  - requirement: "required" (always needed for the context) or
 *    "conditional" with a `when` predicate description.
 *
 * The eligibility engine computes missingFields[] FROM this dictionary
 * (evaluateContextCompleteness); it never hardcodes its own field list.
 */

export type SubmissionContext =
  | "claim_ingestion"
  | "open_negotiation_initiation"
  | "idr_initiation"
  | "batching"
  | "delegation_attestation";

export type FieldSource = "fhir" | "835" | "837" | "csv" | "manual";

export interface RequiredFieldSpec {
  key: string;
  label: string;
  sources: FieldSource[];
  citation: string;
  requirement: "required" | "conditional";
  /** For conditional fields: plain-language condition (evaluated by callers). */
  condition?: string;
}

export const REQUIRED_FIELDS: Record<SubmissionContext, RequiredFieldSpec[]> = {
  /** Minimum to accept a claim into the eligibility pipeline. */
  claim_ingestion: [
    { key: "claimId", label: "Payer-assigned claim number / patient control number", sources: ["fhir", "835", "837", "csv", "manual"], citation: "45 CFR 149.510(c)(2) (dispute must identify the item/service)", requirement: "required" },
    { key: "serviceDate", label: "Date of service", sources: ["fhir", "835", "837", "csv", "manual"], citation: "45 CFR 149.510(b)(2)(i) (initiation window anchored to service/payment dates)", requirement: "required" },
    { key: "cptCodes", label: "Service code(s) (CPT/HCPCS)", sources: ["fhir", "835", "837", "csv", "manual"], citation: "45 CFR 149.510(c)(2)(i)(B); CMS IDR initiation form item/service code", requirement: "required" },
    { key: "billedCents", label: "Billed charge", sources: ["fhir", "835", "837", "csv", "manual"], citation: "45 CFR 149.510(c)(2) (claim identification); CMS IDR form total billed charges", requirement: "required" },
    { key: "serviceState", label: "State where service was furnished (2-letter USPS)", sources: ["fhir", "837", "csv", "manual"], citation: "45 CFR 149.140(a) (specified State law determination)", requirement: "required" },
    { key: "payerId", label: "Payer / plan identifier", sources: ["fhir", "835", "837", "csv", "manual"], citation: "45 CFR 149.510(c)(4)(i)(B) (same-payer batching criterion)", requirement: "required" },
    { key: "renderingNpi", label: "Rendering or billing provider NPI", sources: ["fhir", "835", "837", "manual"], citation: "45 CFR 149.510(c)(4)(i)(A) (same-NPI/TIN batching criterion)", requirement: "required" },
    { key: "networkStatus", label: "Network/participation status at time of service", sources: ["fhir", "csv", "manual"], citation: "45 CFR 149.30/149.110 (NSA protections apply to non-participating providers); 149.510(b)(2)(ii)(A)(3)", requirement: "required" },
    { key: "planType", label: "Plan type (self-funded / fully-insured / FEHB)", sources: ["fhir", "csv", "manual"], citation: "45 CFR 149.140 (specified State law vs federal applicability)", requirement: "required" },
  ],

  /** Federal open negotiation notice (30 business days from initial payment/denial). */
  open_negotiation_initiation: [
    { key: "initialPaymentDate", label: "Date of initial payment or notice of denial", sources: ["835", "fhir", "manual"], citation: "45 CFR 149.510(a)(2)(viii)(B) (ONP starts on initial payment or denial)", requirement: "required" },
    { key: "openNegotiationNoticeDate", label: "Date open negotiation notice was initiated", sources: ["manual"], citation: "45 CFR 149.510(a)(2)(viii)(B) (30-business-day ONP)", requirement: "required" },
    { key: "noticeContentComplete", label: "Open negotiation notice contains all required elements (incl. nonparticipating status)", sources: ["manual"], citation: "45 CFR 149.510(a)(2)(viii) notice content requirements", requirement: "required" },
    { key: "qpaAmount", label: "Qualifying payment amount for the item/service", sources: ["835", "manual"], citation: "45 CFR 149.140(c) (QPA disclosure with initial payment/denial)", requirement: "conditional", condition: "Required when the payer disclosed a QPA; drives offer anchoring and IDR submissions." },
  ],

  /** Federal IDR initiation (4 business days after ONP ends). */
  idr_initiation: [
    { key: "initialPaymentDate", label: "Date of initial payment or notice of denial", sources: ["835", "fhir", "manual"], citation: "45 CFR 149.510(b)(2)(i) (4-business-day initiation window anchor)", requirement: "required" },
    { key: "openNegotiationEndDate", label: "Date the open negotiation period ended", sources: ["manual"], citation: "45 CFR 149.510(b)(2)(i)", requirement: "required" },
    { key: "planType", label: "Plan type (self-funded / fully-insured / FEHB)", sources: ["fhir", "csv", "manual"], citation: "45 CFR 149.140 (jurisdiction: federal vs specified State law)", requirement: "required" },
    { key: "serviceState", label: "State where service was furnished", sources: ["fhir", "837", "csv", "manual"], citation: "45 CFR 149.140(a)", requirement: "required" },
    { key: "serviceCategory", label: "Service category (emergency / non-emergency / post-stabilization / air ambulance)", sources: ["fhir", "837", "csv", "manual"], citation: "45 CFR 149.110-149.130 (scope of NSA protections)", requirement: "required" },
    { key: "noticeConsentStatus", label: "Notice-and-consent status (none / signed / waiver exception)", sources: ["manual"], citation: "45 CFR 149.410-149.430 (notice & consent exception waives NSA protections)", requirement: "required" },
    { key: "conflictCheck", label: "Certified IDR entity conflict-of-interest attestation", sources: ["manual"], citation: "45 CFR 149.510(c)(1)(iv)-(v)", requirement: "required" },
    { key: "priorPaymentDeterminationDate", label: "Payment determination date on the prior similar dispute", sources: ["manual"], citation: "45 CFR 149.510(c)(4)(vii)(B) (90-calendar-day cooling-off; 30 business days for batched under CMS-9897-F)", requirement: "conditional", condition: "Required when the same parties had a prior determination for the same/similar item or service." },
  ],

  /** Batched dispute (CMS-9897-F regime). */
  batching: [
    { key: "payerId", label: "Same group health plan / issuer across all line items", sources: ["fhir", "835", "837", "csv", "manual"], citation: "45 CFR 149.510(c)(4)(i)(B) (as amended by CMS-9897-F)", requirement: "required" },
    { key: "renderingNpi", label: "Same provider NPI or TIN across all line items", sources: ["fhir", "835", "837", "manual"], citation: "45 CFR 149.510(c)(4)(i)(A)", requirement: "required" },
    { key: "cptCodes", label: "Service codes for relatedness evaluation", sources: ["fhir", "835", "837", "csv", "manual"], citation: "45 CFR 149.510(c)(4)(i)(C) (CMS-9897-F relatedness criteria)", requirement: "required" },
    { key: "openNegotiationNoticeDate", label: "ONP start date (selects pre-/post-2026-11-01 batching regime)", sources: ["manual"], citation: "CMS-9897-F applicability date (91 FR 33900)", requirement: "required" },
  ],

  /** Delegated (third-party) submission attestation. */
  delegation_attestation: [
    { key: "representativeIdentity", label: "Name/identity of the third-party representative", sources: ["manual"], citation: "45 CFR 149.510(b)(2)(ii)(A)(3) (as amended by CMS-9897-F)", requirement: "required" },
    { key: "authorityAttestation", label: "Attestation of authority to act on behalf of the disputing party", sources: ["manual"], citation: "45 CFR 149.510(b)(2)(ii)(A)(3)", requirement: "required" },
    { key: "adminFeeDebtAllocation", label: "Whether the attestation allocates administrative-fee debt", sources: ["manual"], citation: "45 CFR 149.510(b)(2)(ii)(A)(3) (attestation may allocate admin-fee debt)", requirement: "conditional", condition: "Required when the representative assumes administrative-fee responsibility." },
  ],
};

/** Flat lookup: context -> required field keys (conditional fields excluded). */
export function requiredFieldKeys(context: SubmissionContext): string[] {
  return REQUIRED_FIELDS[context].filter(f => f.requirement === "required").map(f => f.key);
}

export interface ContextCompleteness {
  context: SubmissionContext;
  /** Required field keys absent from the supplied record. */
  missingFields: string[];
  /** Checklist entries for every required field (present flag + citation). */
  checklist: Array<{ key: string; label: string; present: boolean; citation: string }>;
  /** Percent of required fields present (0-100, integer). */
  completenessPct: number;
}

/**
 * Evaluate a record (arbitrary key→value map) against the dictionary for a
 * submission context. A field counts as present when the value is non-null,
 * non-empty-string, and non-empty-array. Fail-closed: unknown values are
 * MISSING (never inferred).
 */
export function evaluateContextCompleteness(
  context: SubmissionContext,
  record: Record<string, unknown>,
): ContextCompleteness {
  const specs = REQUIRED_FIELDS[context].filter(f => f.requirement === "required");
  const checklist = specs.map(f => {
    const v = record[f.key];
    const present =
      v !== null && v !== undefined &&
      (typeof v !== "string" || v.trim().length > 0) &&
      (!Array.isArray(v) || v.length > 0);
    return { key: f.key, label: f.label, present, citation: f.citation };
  });
  const missingFields = checklist.filter(c => !c.present).map(c => c.key);
  const completenessPct = specs.length === 0 ? 100 : Math.round(((specs.length - missingFields.length) / specs.length) * 100);
  return { context, missingFields, checklist, completenessPct };
}

/** Which ingestion sources can supply a given field key in a context. */
export function fieldSources(context: SubmissionContext, key: string): FieldSource[] {
  return REQUIRED_FIELDS[context].find(f => f.key === key)?.sources ?? [];
}
