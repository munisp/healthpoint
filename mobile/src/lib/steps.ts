/**
 * Mobile mirror of the server's 19-step NSA IDR workflow.
 *
 * Mirrors drizzle/schema.ts IDR_STEP and server/workflow/idr-workflow.ts
 * getStatusForStep so the app can build `disputes.advance` payloads
 * (newStep + newStatus) locally. Verified against branch
 * assurance/remediation-2026-09-05 — keep in sync if the server enum grows.
 */

export const IDR_STEPS = [
  "STEP_01_OPEN_NEGOTIATION_INITIATED",
  "STEP_02_OPEN_NEGOTIATION_PERIOD",
  "STEP_03_OPEN_NEGOTIATION_FAILED",
  "STEP_04_IDR_INITIATED",
  "STEP_05_IDR_NOTICE_SENT",
  "STEP_06_IDR_ENTITY_SELECTION",
  "STEP_07_IDR_ENTITY_SELECTED",
  "STEP_08_ELIGIBILITY_REVIEW",
  "STEP_09_OFFER_SUBMISSION",
  "STEP_10_QPA_DISCLOSURE",
  "STEP_11_ADDITIONAL_INFORMATION",
  "STEP_12_ARBITRATION_REVIEW",
  "STEP_13_DETERMINATION_ISSUED",
  "STEP_14_PAYMENT_DETERMINATION",
  "STEP_15_PAYMENT_MADE",
  "STEP_16_ADMINISTRATIVE_FEE_PAID",
  "STEP_17_DISPUTE_CLOSED",
  "STEP_18_APPEAL_FILED",
  "STEP_19_APPEAL_RESOLVED",
] as const;

export type IDRStepId = (typeof IDR_STEPS)[number];

/** "STEP_09_OFFER_SUBMISSION" → "Offer submission". */
export function stepLabel(step: string): string {
  const raw = step.replace(/^STEP_\d+_/, "").replace(/_/g, " ").toLowerCase();
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/**
 * Step → dispute status. Mirror of server/workflow/idr-workflow.ts
 * getStatusForStep().
 */
export function statusForStep(step: string): string {
  if (step === "STEP_17_DISPUTE_CLOSED") return "closed";
  if (step === "STEP_18_APPEAL_FILED" || step === "STEP_19_APPEAL_RESOLVED") {
    return "appealed";
  }
  if (step === "STEP_13_DETERMINATION_ISSUED") return "determination_issued";
  if (
    step === "STEP_14_PAYMENT_DETERMINATION" ||
    step === "STEP_15_PAYMENT_MADE" ||
    step === "STEP_16_ADMINISTRATIVE_FEE_PAID"
  ) {
    return "payment_pending";
  }
  if (
    step === "STEP_09_OFFER_SUBMISSION" ||
    step === "STEP_10_QPA_DISCLOSURE" ||
    step === "STEP_11_ADDITIONAL_INFORMATION" ||
    step === "STEP_12_ARBITRATION_REVIEW"
  ) {
    return "under_arbitration";
  }
  if (step === "STEP_08_ELIGIBILITY_REVIEW") return "eligibility_review";
  if (
    step === "STEP_06_IDR_ENTITY_SELECTION" ||
    step === "STEP_07_IDR_ENTITY_SELECTED"
  ) {
    return "idr_entity_selection";
  }
  if (step === "STEP_04_IDR_INITIATED" || step === "STEP_05_IDR_NOTICE_SENT") {
    return "idr_initiated";
  }
  return "open_negotiation";
}

/**
 * Main-path linear fallback for the "next step" when the workflow.progress
 * query is unavailable (offline): the next step on the main path, or null
 * for terminal/appeal steps. Server-side validateWorkflowTransition remains
 * the source of truth — it rejects invalid advances with a clear error.
 */
export function nextMainPathStep(currentStep: string | null | undefined): string | null {
  if (!currentStep) return null;
  const index = IDR_STEPS.indexOf(currentStep as IDRStepId);
  if (index < 0) return null;
  if (index >= 16) return null; // STEP_17..19 are terminal/appeal branches
  return IDR_STEPS[index + 1];
}
