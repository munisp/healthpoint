export const ACCEPTANCE_STATES = ["draft", "evidence_collected"] as const;
export const EVIDENCE_STATES = ["pending", "submitted", "verified_by_provider", "rejected"] as const;

export function computeAcceptanceStatus(mtlsState: string, reconciliationState: string, attestationReference?: string | null) {
  // Bilateral acceptance cannot be self-certified in HealthPoint. A provider
  // record may become evidence-collected, but never verified/release-ready
  // until an external, independent review process supplies acceptance evidence.
  if (mtlsState === "verified_by_provider" && reconciliationState === "verified_by_provider" && attestationReference?.trim()) {
    return "evidence_collected" as const;
  }
  return "draft" as const;
}
