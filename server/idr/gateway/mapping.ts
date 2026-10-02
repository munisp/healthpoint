/**
 * server/idr/gateway/mapping.ts — Phase 20-B.
 *
 * Pure mapping from SubmissionPackage.portalFields (the 45 CFR 149.510(b)
 * initiation elements that server/idr/submission-automation/package-builder.ts
 * already validates fail-closed) to the internal GatewayIntakeSchema carried
 * by GatewaySubmissionRequest.initiation.
 *
 * ASSUMPTION label: CMS has published NO Gateway intake schema as of
 * 2026-09 — this is a 1:1 carry of the statutory elements, keyed by the same
 * names package-builder produces, and must be revised when CMS publishes
 * technical specifications. No network, no side effects.
 */

/** Statutory initiation element keys (45 CFR 149.510(b)) carried 1:1. */
export const GATEWAY_INTAKE_KEYS = [
  "initiatingPartyName",
  "initiatingPartyContactEmail",
  "initiatingPartyContactPhone",
  "respondingPartyName",
  "respondingPartyContactEmail",
  "respondingPartyContactPhone",
  "initiatingPartyTin",
  "respondingPartyTin",
  "claimNumber",
  "serviceCode",
  "dateOfService",
  "billedCharge",
  "qualifyingPaymentAmount",
  "initialPlanPayment",
  "openNegotiationInitiationDate",
  "openNegotiationNoticeProofRef",
  "certificationAttestedAt",
  "certificationAttestorName",
  "initiatingOffer",
] as const;

/**
 * Carry every recognized portal field into the gateway intake payload. Keys
 * not in the statutory allow-list are preserved verbatim under the same key
 * (forward compatibility) EXCEPT empty strings, which are dropped (the
 * package builder never emits empty values; this is defense in depth).
 */
export function portalFieldsToGatewayIntake(
  portalFields: Record<string, string>,
): Record<string, string> {
  const intake: Record<string, string> = {};
  for (const [k, v] of Object.entries(portalFields)) {
    if (typeof v !== "string" || v.trim().length === 0) continue;
    intake[k] = v;
  }
  return intake;
}
