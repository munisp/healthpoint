export const ACCEPTANCE_STATES = ["draft", "evidence_collected"] as const;
export const EVIDENCE_STATES = ["pending", "submitted", "verified_by_provider", "rejected"] as const;

type ProviderEvidenceInput = {
  sandboxBaseUrl?: string;
  providerReference?: string;
  mtlsEvidenceState: string;
  reconciliationEvidenceState: string;
  bilateralAttestationReference?: string;
  evidenceNotes?: string;
};

const PROHIBITED_SECRET_MATERIAL = [
  /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/i,
  /-----BEGIN(?: [A-Z]+)? CERTIFICATE-----/i,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i,
];

/**
 * Enforces that the evidence workspace stores attestations and references only.
 * It deliberately rejects credentials, local endpoints, and unverifiable claims.
 */
export function validateProviderEvidenceInput(input: ProviderEvidenceInput): void {
  const textFields = [input.sandboxBaseUrl, input.providerReference, input.bilateralAttestationReference, input.evidenceNotes]
    .filter((value): value is string => Boolean(value));
  if (textFields.some(value => PROHIBITED_SECRET_MATERIAL.some(pattern => pattern.test(value)))) {
    throw new Error("Acceptance evidence must not contain certificates, private keys, or bearer tokens");
  }

  if (input.sandboxBaseUrl) {
    const url = new URL(input.sandboxBaseUrl);
    if (url.protocol !== "https:" || !url.hostname || url.hostname === "localhost" || /^127\.|^0\.0\.0\.0$/.test(url.hostname)) {
      throw new Error("Sandbox endpoint must be an externally reachable HTTPS URL");
    }
  }

  const anyVerification = input.mtlsEvidenceState === "verified_by_provider" || input.reconciliationEvidenceState === "verified_by_provider";
  if (anyVerification && !input.providerReference?.trim()) {
    throw new Error("Provider-issued test reference is required for verified evidence");
  }
  if (input.mtlsEvidenceState === "verified_by_provider" && !input.sandboxBaseUrl?.trim()) {
    throw new Error("Externally reachable HTTPS sandbox URL is required for verified mTLS evidence");
  }
  if (input.mtlsEvidenceState === "verified_by_provider" && input.reconciliationEvidenceState === "verified_by_provider" && !input.bilateralAttestationReference?.trim()) {
    throw new Error("Bilateral attestation reference is required when both evidence tracks are verified");
  }
}

export function computeAcceptanceStatus(mtlsState: string, reconciliationState: string, attestationReference?: string | null) {
  // Bilateral acceptance cannot be self-certified in HealthPoint. A provider
  // record may become evidence-collected, but never verified/release-ready
  // until an external, independent review process supplies acceptance evidence.
  if (mtlsState === "verified_by_provider" && reconciliationState === "verified_by_provider" && attestationReference?.trim()) {
    return "evidence_collected" as const;
  }
  return "draft" as const;
}
