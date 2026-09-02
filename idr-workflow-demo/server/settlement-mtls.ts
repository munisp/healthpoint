import { timingSafeEqual } from "crypto";

export const SETTLEMENT_MTLS_VERIFIED_HEADER = "x-settlement-mtls-verified";
export const SETTLEMENT_MTLS_FINGERPRINT_HEADER = "x-settlement-mtls-fingerprint";
export const SETTLEMENT_MTLS_INGRESS_TOKEN_HEADER = "x-settlement-ingress-token";

export interface SettlementMtlsVerification {
  valid: boolean;
  reason?: string;
}

export function parseSettlementMtlsFingerprints(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map(value => value.replace(/[^A-Fa-f0-9]/g, "").toUpperCase())
    .filter(value => /^[A-F0-9]{64}$/.test(value));
}

/**
 * The public TLS proxy terminates the provider's mutual-TLS connection. It strips
 * inbound spoofed headers and supplies these values only after certificate-chain
 * validation. The application still validates an internal high-entropy ingress
 * token and an explicit certificate fingerprint allowlist before reconciliation.
 */
export function verifySettlementMtls(input: {
  required: boolean;
  verifiedHeader: string | undefined;
  fingerprintHeader: string | undefined;
  ingressTokenHeader: string | undefined;
  expectedIngressToken: string | undefined;
  allowedFingerprints: string[];
}): SettlementMtlsVerification {
  if (!input.required) return { valid: true };
  if (!input.expectedIngressToken || input.expectedIngressToken.length < 32) {
    return { valid: false, reason: "settlement mTLS ingress token is not configured" };
  }
  if (input.verifiedHeader !== "true") {
    return { valid: false, reason: "provider mTLS was not verified by the trusted ingress" };
  }
  const suppliedToken = input.ingressTokenHeader ?? "";
  const expectedToken = input.expectedIngressToken;
  const suppliedTokenBuffer = Buffer.from(suppliedToken);
  const expectedTokenBuffer = Buffer.from(expectedToken);
  if (suppliedTokenBuffer.length !== expectedTokenBuffer.length || !timingSafeEqual(suppliedTokenBuffer, expectedTokenBuffer)) {
    return { valid: false, reason: "untrusted settlement ingress" };
  }
  const fingerprint = (input.fingerprintHeader ?? "").replace(/[^A-Fa-f0-9]/g, "").toUpperCase();
  if (!input.allowedFingerprints.includes(fingerprint)) {
    return { valid: false, reason: "provider client certificate fingerprint is not allowed" };
  }
  return { valid: true };
}
