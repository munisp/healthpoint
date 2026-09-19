/**
 * server/idr/attestations.ts
 * Attestation flow for the federal IDR process — pure state logic.
 *
 * Regulatory grounding: 45 CFR § 149.510(b)(2)(ii) (IDR initiation must
 * include the information the Departments require) and § 149.510(c)(3)(i)
 * (offer submissions) obligate parties to submit complete and accurate
 * information. The attestation is the platform's evidentiary record that the
 * submitting party affirmed completeness/accuracy at that point in the
 * lifecycle. Attestation rows are append-only evidence: corrections create a
 * new attestation that supersedes the prior active one.
 */

export type AttestationType = "idr_initiation" | "offer_submission";
export type AttestationPartyRole = "initiating_party" | "responding_party";
export type AttestationStatus = "active" | "superseded" | "withdrawn";

/** The dispute steps at which each attestation type is required. */
export const ATTESTATION_REQUIRED_STEPS: Record<AttestationType, string[]> = {
  // Attestation at IDR initiation: from STEP_04 (initiated) onward it should exist.
  idr_initiation: [
    "STEP_04_IDR_INITIATED",
    "STEP_05_IDR_NOTICE_SENT",
    "STEP_06_IDR_ENTITY_SELECTION",
  ],
  // Attestation at offer submission: STEP_09 window.
  offer_submission: ["STEP_09_OFFER_SUBMISSION"],
};

/**
 * Canonical attestation language. The exact HHS portal attestation text may
 * differ and is presented by the portal itself; this text is the platform's
 * record of the affirmation made inside this system.
 */
export function attestationText(type: AttestationType): string {
  if (type === "idr_initiation") {
    return (
      "I attest that the information provided to initiate this Federal IDR dispute, " +
      "including the qualifying payment amount and item/service information, is complete " +
      "and accurate to the best of my knowledge (45 CFR § 149.510(b)(2))."
    );
  }
  return (
    "I attest that the offer amount and all supporting information submitted for this " +
    "Federal IDR dispute are complete and accurate to the best of my knowledge " +
    "(45 CFR § 149.510(c)(3))."
  );
}

export interface AttestationLike {
  id: string;
  disputeId: string;
  attestationType: AttestationType;
  partyRole: AttestationPartyRole;
  attestedBy: string;
  status: AttestationStatus;
}

/** Validation errors returned (not thrown) so routers can map them cleanly. */
export type AttestationValidationError =
  | "affirmations_required" // one of complete/accurate was not affirmed
  | "wrong_step" // dispute is not in a step where this attestation is accepted
  | "already_active"; // this party already has an active attestation of this type

/**
 * Validate a new attestation against the dispute's current step and the
 * party's existing attestations. Returns null when valid.
 */
export function validateNewAttestation(
  type: AttestationType,
  partyRole: AttestationPartyRole,
  currentStep: string,
  affirmations: { informationComplete: boolean; informationAccurate: boolean },
  existing: AttestationLike[]
): AttestationValidationError | null {
  if (!affirmations.informationComplete || !affirmations.informationAccurate) {
    return "affirmations_required";
  }
  if (!ATTESTATION_REQUIRED_STEPS[type].includes(currentStep)) {
    return "wrong_step";
  }
  const active = existing.some(
    a =>
      a.attestationType === type &&
      a.partyRole === partyRole &&
      a.status === "active"
  );
  if (active) return "already_active";
  return null;
}

/**
 * State transitions: an active attestation may be superseded (by a corrected
 * re-attestation recorded by the same party) or withdrawn (party retracts
 * before downstream reliance). superseded/withdrawn are terminal.
 */
const ATTESTATION_TRANSITIONS: Record<AttestationStatus, AttestationStatus[]> = {
  active: ["superseded", "withdrawn"],
  superseded: [],
  withdrawn: [],
};

export function canTransitionAttestation(from: AttestationStatus, to: AttestationStatus): boolean {
  return (ATTESTATION_TRANSITIONS[from] ?? []).includes(to);
}

export function assertAttestationTransition(from: AttestationStatus, to: AttestationStatus): void {
  if (!canTransitionAttestation(from, to)) {
    throw new Error(`Invalid attestation transition: ${from} → ${to}`);
  }
}

/**
 * Plan a re-attestation: the caller has collected corrected information and
 * wants to replace the party's active attestation. Returns the transition
 * actions (mark old superseded, insert new active) or null when there is no
 * active attestation to supersede.
 */
export function planReAttestation(
  existing: AttestationLike[],
  type: AttestationType,
  partyRole: AttestationPartyRole
): { supersedeId: string; insertType: AttestationType; partyRole: AttestationPartyRole } | null {
  const active = existing.find(
    a => a.attestationType === type && a.partyRole === partyRole && a.status === "active"
  );
  if (!active) return null;
  return { supersedeId: active.id, insertType: type, partyRole };
}
