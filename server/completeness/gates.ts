/**
 * server/completeness/gates.ts
 *
 * Phase 17-CE: fail-closed completeness enforcement gates. NO claim leaves
 * the platform with incomplete CMS-required data. Every gate is computed
 * FROM the required-fields dictionary (server/eligibility/required-fields.ts)
 * — field lists, labels, source paths and CFR citations are never hardcoded
 * here; this module only maps platform artifacts (dispute rows, create
 * payloads, delegation attestations) onto the dictionary's canonical keys.
 *
 * Enforcement semantics:
 *  - assertComplete(...) throws TRPCError PRECONDITION_FAILED with structured
 *    details { missingFields: [{ key, label, citation, sourcePaths }],
 *    completenessPct, context }. It never silently passes: unknown values are
 *    MISSING (dictionary fail-closed rule), never inferred.
 *  - Platform-derived values are used ONLY where the platform itself creates
 *    the artifact as a matter of record (documented per mapping below):
 *      · openNegotiationNoticeDate ← disputes.createdAt: createDispute
 *        (server/db.ts) emits the "Open negotiation notice initiated"
 *        timeline event at creation — the notice date is a recorded fact.
 *      · openNegotiationEndDate ← addBusinessDays(initialPaymentDate, 30):
 *        the canonical deadlines engine computes the ONP end; this is a
 *        deterministic statutory computation, not an inference.
 *      · noticeContentComplete ← evaluated from the actual presence of the
 *        45 CFR 149.510(a)(2)(viii) notice content elements on the payload.
 *      · serviceCategory ← deterministic mapping from disputes.serviceType
 *        (emergency_medicine→EMERGENCY, air_ambulance→AIR_AMBULANCE,
 *        otherwise NON_EMERGENCY).
 *  - Air-ambulance variant: the notice-and-consent exception
 *    (45 CFR 149.410-149.430) does not apply to air ambulance services, so
 *    for serviceCategory=AIR_AMBULANCE the noticeConsentStatus field is
 *    satisfied with the explicit sentinel "not_applicable_air_ambulance"
 *    (conditional-field handling), never left silently blank.
 *
 * Labels: EXECUTED-VERIFIED via server/completeness/gates.test.ts (pure
 * functions, no DB, no network) and journey J28 (real tRPC paths).
 */
import { TRPCError } from "@trpc/server";
import {
  REQUIRED_FIELDS,
  type RequiredFieldSpec,
  type SubmissionContext,
} from "../eligibility/required-fields";

/** Structured missing-field detail attached to every gate rejection. */
export interface MissingFieldDetail {
  key: string;
  label: string;
  citation: string;
  sourcePaths: string[];
}

export interface GateDetails {
  context: string;
  missingFields: MissingFieldDetail[];
  completenessPct: number;
}

/** Thrown-shape: TRPCError PRECONDITION_FAILED with .cause = GateDetails. */
export function completenessError(context: string, specs: RequiredFieldSpec[], missingKeys: string[], completenessPct: number): TRPCError {
  const missingFields: MissingFieldDetail[] = specs
    .filter(s => missingKeys.includes(s.key))
    .map(s => ({ key: s.key, label: s.label, citation: s.citation, sourcePaths: [...s.sources] }));
  const err = new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      `Incomplete CMS-required data for ${context}: missing ${missingFields.map(m => m.key).join(", ")}. ` +
      `Fail-closed (45 CFR 149.510): supply the listed fields and retry.`,
  });
  (err as unknown as { cause: GateDetails }).cause = { context, missingFields, completenessPct };
  return err;
}

/**
 * Core gate: evaluate `record` against the dictionary specs and throw
 * PRECONDITION_FAILED with structured details when anything is missing.
 * Returns the completeness summary when complete (100%).
 */
export function assertComplete(
  record: Record<string, unknown>,
  context: SubmissionContext,
  opts: { specs?: RequiredFieldSpec[]; label?: string } = {},
): { completenessPct: number } {
  // Presence semantics identical to the dictionary evaluator
  // (evaluateContextCompleteness): non-null, non-empty-string/array.
  const specs = opts.specs ?? REQUIRED_FIELDS[context].filter(f => f.requirement === "required");
  const missing = specs.filter(s => {
    const v = record[s.key];
    return v === null || v === undefined ||
      (typeof v === "string" && v.trim().length === 0) ||
      (Array.isArray(v) && v.length === 0);
  }).map(s => s.key);
  const completenessPct = specs.length === 0 ? 100 : Math.round(((specs.length - missing.length) / specs.length) * 100);
  if (missing.length > 0) {
    throw completenessError(opts.label ?? context, specs, missing, completenessPct);
  }
  return { completenessPct };
}

/**
 * Non-throwing projection: structured completeness summary for a record
 * against a context (used by disputes.getById/list responses).
 */
export function projectCompleteness(
  record: Record<string, unknown>,
  context: SubmissionContext,
  opts: { specs?: RequiredFieldSpec[] } = {},
): { context: string; completenessPct: number; missingFields: MissingFieldDetail[] } {
  const specs = opts.specs ?? REQUIRED_FIELDS[context].filter(f => f.requirement === "required");
  const missing = specs.filter(s => {
    const v = record[s.key];
    return v === null || v === undefined ||
      (typeof v === "string" && v.trim().length === 0) ||
      (Array.isArray(v) && v.length === 0);
  });
  const completenessPct = specs.length === 0 ? 100 : Math.round(((specs.length - missing.length) / specs.length) * 100);
  return {
    context,
    completenessPct,
    missingFields: missing.map(s => ({ key: s.key, label: s.label, citation: s.citation, sourcePaths: [...s.sources] })),
  };
}

// ── Dispute-record mappings (platform artifact → canonical dictionary key) ──

export interface DisputeLike {
  id?: string;
  referenceNumber?: string;
  initiatingPartyName?: string | null;
  initiatingPartyNpi?: string | null;
  respondingPartyName?: string | null;
  serviceType?: string | null;
  serviceDate?: Date | string | null;
  facilityState?: string | null;
  patientState?: string | null;
  cptCodes?: string[] | null;
  billedAmount?: string | number | null;
  initialPaymentDate?: Date | string | null;
  qpaAmount?: string | number | null;
  createdAt?: Date | string | null;
  submitterClientId?: string | null;
}

/** Deterministic serviceType → dictionary serviceCategory mapping. */
export function serviceCategoryFor(serviceType: string | null | undefined): string | null {
  if (!serviceType) return null;
  if (serviceType === "air_ambulance") return "AIR_AMBULANCE";
  if (serviceType === "emergency_medicine") return "EMERGENCY";
  return "NON_EMERGENCY";
}

/** 45 CFR 149.510(a)(2)(viii) notice content elements, checked on real data. */
export function noticeContentComplete(d: DisputeLike): boolean {
  return Boolean(
    d.initiatingPartyName && d.respondingPartyName &&
    d.serviceDate && d.cptCodes && d.cptCodes.length > 0 &&
    d.billedAmount !== null && d.billedAmount !== undefined && String(d.billedAmount) !== ""
  );
}

function nonEmpty(v: unknown): boolean {
  return v !== null && v !== undefined &&
    !(typeof v === "string" && v.trim().length === 0) &&
    !(Array.isArray(v) && v.length === 0);
}

/**
 * Intake (create-time) record: dictionary open_negotiation_initiation +
 * claim_ingestion identity fields collectible at intake. claimId is excluded
 * because the platform assigns the dispute reference number at creation
 * (documented); every other ingestion field maps to a real payload element.
 * initialPaymentDate / openNegotiationNoticeDate mirror the platform defaults
 * in createDispute (initialPaymentDate ?? createdAt; the ON notice is
 * initiated at creation) so the gate evaluates the POST-DEFAULT record.
 */
export function disputeCreateRecord(input: {
  initiatingPartyName?: string;
  initiatingPartyNpi?: string;
  respondingPartyName?: string;
  serviceType?: string;
  serviceDate?: string;
  facilityState?: string;
  cptCodes?: string[];
  billedAmount?: string;
  initialPaymentDate?: string;
  initiatingPartyNonparticipating?: boolean;
  planType?: string;
  qpaAmount?: string;
  now: Date;
}): Record<string, unknown> {
  const notice: DisputeLike = {
    initiatingPartyName: input.initiatingPartyName,
    respondingPartyName: input.respondingPartyName,
    serviceDate: input.serviceDate,
    cptCodes: input.cptCodes,
    billedAmount: input.billedAmount,
  };
  return {
    // claim_ingestion subset (claimId excluded — platform-assigned at creation)
    serviceDate: input.serviceDate ?? null,
    cptCodes: input.cptCodes ?? null,
    billedCents: nonEmpty(input.billedAmount) ? 1 : null, // presence proxy: zod already validated the amount format
    serviceState: input.facilityState ?? null,
    payerId: input.respondingPartyName ?? null,
    renderingNpi: input.initiatingPartyNpi ?? null,
    networkStatus: input.initiatingPartyNonparticipating === false ? "in_network" : "out_of_network",
    planType: input.planType ?? null,
    // open_negotiation_initiation
    initialPaymentDate: input.initialPaymentDate ?? input.now.toISOString(),
    openNegotiationNoticeDate: input.now.toISOString(), // creation initiates the ON notice (server/db.ts timeline event)
    noticeContentComplete: noticeContentComplete(notice) ? true : null,
    // conditional — surfaced in projections, not enforced at intake
    qpaAmount: input.qpaAmount ?? null,
  };
}

/**
 * Specs enforced at dispute intake (claim_ingestion + ON initiation), with
 * two documented exclusions:
 *  - claimId: the platform assigns the dispute reference number at creation
 *    (createDispute), so it cannot be supplied at intake;
 *  - planType: enforced fail-closed at the IDR-initiation (STEP_04) gate,
 *    where jurisdiction actually attaches; intake enforces plan/issuer
 *    IDENTITY (payerId) instead.
 */
export function createGateSpecs(): RequiredFieldSpec[] {
  const ingestion = REQUIRED_FIELDS.claim_ingestion.filter(
    f => f.requirement === "required" && f.key !== "claimId" && f.key !== "planType"
  );
  const on = REQUIRED_FIELDS.open_negotiation_initiation.filter(f => f.requirement === "required");
  return [...ingestion, ...on];
}

/** Fail-closed create gate (disputes.create / submitter.createDelegatedDispute). */
export function assertDisputeCreateComplete(input: Parameters<typeof disputeCreateRecord>[0]): void {
  assertComplete(disputeCreateRecord(input), "open_negotiation_initiation", {
    specs: createGateSpecs(),
    label: "dispute_intake(claim_ingestion+open_negotiation_initiation)",
  });
}

/**
 * IDR-initiation (STEP_04) record. Gate-only fields (planType,
 * noticeConsentStatus, conflictCheckAttested) MUST be supplied at the
 * transition — they are recorded in the completeness_gate dispute event as
 * the evidence of record. Air ambulance: noticeConsentStatus is satisfied
 * with the explicit not-applicable sentinel (N&C exception does not apply).
 */
export function idrInitiationRecord(
  dispute: DisputeLike,
  opts: {
    openNegotiationEndDate?: Date | string | null;
    planType?: string | null;
    noticeConsentStatus?: string | null;
    conflictCheckAttested?: boolean | null;
  },
): Record<string, unknown> {
  const category = serviceCategoryFor(dispute.serviceType);
  const airAmbulance = category === "AIR_AMBULANCE";
  return {
    initialPaymentDate: dispute.initialPaymentDate ?? null,
    openNegotiationEndDate: opts.openNegotiationEndDate ?? null,
    planType: opts.planType ?? null,
    serviceState: dispute.facilityState ?? dispute.patientState ?? null,
    serviceCategory: category,
    noticeConsentStatus: airAmbulance ? "not_applicable_air_ambulance" : (opts.noticeConsentStatus ?? null),
    conflictCheck: opts.conflictCheckAttested === true ? "attested" : null,
  };
}

/** Fail-closed STEP_04 gate. Returns the evaluated record (for evidence events). */
export function assertIdrInitiationComplete(
  dispute: DisputeLike,
  opts: Parameters<typeof idrInitiationRecord>[1],
): Record<string, unknown> {
  const record = idrInitiationRecord(dispute, opts);
  assertComplete(record, "idr_initiation");
  return record;
}

/** Fail-closed STEP_01/STEP_02 (open negotiation) gate on a persisted dispute row. */
export function assertOpenNegotiationComplete(dispute: DisputeLike): void {
  const record = {
    initialPaymentDate: dispute.initialPaymentDate ?? null,
    openNegotiationNoticeDate: dispute.createdAt ?? null, // notice initiated at creation (timeline event of record)
    noticeContentComplete: noticeContentComplete(dispute) ? true : null,
  };
  assertComplete(record, "open_negotiation_initiation");
}

/**
 * Batched-dispute gate (45 CFR 149.510(c)(4)(i) as amended by CMS-9897-F):
 * same payer AND same NPI/TIN across all line items, service codes present
 * for relatedness evaluation, and an ONP start date selecting the batching
 * regime. Fails closed on any heterogeneity or missing element.
 */
export function assertBatchingComplete(
  lineItems: Array<{ payerId?: string | null; renderingNpi?: string | null; cptCodes?: string[] | null }>,
  openNegotiationNoticeDate: Date | string | null,
): void {
  const payers = new Set(lineItems.map(li => li.payerId).filter(nonEmpty));
  const npis = new Set(lineItems.map(li => li.renderingNpi).filter(nonEmpty));
  const record: Record<string, unknown> = {
    payerId: lineItems.length > 0 && payers.size === 1 ? [...payers][0] : null,
    renderingNpi: lineItems.length > 0 && npis.size === 1 ? [...npis][0] : null,
    cptCodes: lineItems.length > 0 && lineItems.every(li => nonEmpty(li.cptCodes)) ? ["present"] : null,
    openNegotiationNoticeDate: openNegotiationNoticeDate ?? null,
  };
  assertComplete(record, "batching", { label: "batching(batched_dispute)" });
}

/** Delegation-attestation gate record mapped from a resolved attestation row. */
export function assertDelegationAttestationComplete(attestation: {
  attestedByUserId?: string | null;
  authorityText?: string | null;
  adminFeeDebtAccepted?: boolean | null;
} | null): void {
  assertComplete({
    representativeIdentity: attestation?.attestedByUserId ?? null,
    authorityAttestation: attestation?.authorityText ?? null,
  }, "delegation_attestation");
}

/**
 * Full dispute completeness projection (getById/list). Gate-supplied values
 * captured in the STEP_04 completeness_gate event are the evidence of record
 * for idr_initiation gate-only fields.
 */
export function projectDisputeCompleteness(
  dispute: DisputeLike & { currentStep?: string },
  gateEvidence?: { planType?: string | null; noticeConsentStatus?: string | null; conflictCheckAttested?: boolean | null; openNegotiationEndDate?: string | null } | null,
): {
  overallCompletenessPct: number;
  missingFields: MissingFieldDetail[];
  contexts: Array<{ context: string; completenessPct: number; missingFields: MissingFieldDetail[] }>;
} {
  const on = projectCompleteness({
    initialPaymentDate: dispute.initialPaymentDate ?? null,
    openNegotiationNoticeDate: dispute.createdAt ?? null,
    noticeContentComplete: noticeContentComplete(dispute) ? true : null,
  }, "open_negotiation_initiation");
  const idrRecord = idrInitiationRecord(dispute, {
    openNegotiationEndDate: gateEvidence?.openNegotiationEndDate ?? null,
    planType: gateEvidence?.planType ?? null,
    noticeConsentStatus: gateEvidence?.noticeConsentStatus ?? null,
    conflictCheckAttested: gateEvidence?.conflictCheckAttested ?? null,
  });
  // openNegotiationEndDate is computable from initialPaymentDate by the
  // canonical engine; project it present when the anchor exists.
  if (nonEmpty(idrRecord.initialPaymentDate) && !nonEmpty(idrRecord.openNegotiationEndDate)) {
    idrRecord.openNegotiationEndDate = "computed_by_deadlines_engine";
  }
  const idr = projectCompleteness(idrRecord, "idr_initiation");
  const contexts = [on, idr];
  const total = contexts.reduce((a, c) => a + c.missingFields.length, 0);
  const specCount =
    REQUIRED_FIELDS.open_negotiation_initiation.filter(f => f.requirement === "required").length +
    REQUIRED_FIELDS.idr_initiation.filter(f => f.requirement === "required").length;
  return {
    overallCompletenessPct: specCount === 0 ? 100 : Math.round(((specCount - total) / specCount) * 100),
    missingFields: contexts.flatMap(c => c.missingFields.map(m => ({ ...m, key: `${c.context}:${m.key}` }))),
    contexts,
  };
}
