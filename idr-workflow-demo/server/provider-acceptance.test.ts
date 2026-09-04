import { describe, expect, it } from "vitest";
import { computeAcceptanceStatus, validateProviderEvidenceInput } from "./provider-acceptance";

describe("provider sandbox acceptance gate", () => {
  it("never self-certifies a provider acceptance as production-ready", () => {
    expect(computeAcceptanceStatus("verified_by_provider", "verified_by_provider", "FSP-SBX-2026-01")).toBe("evidence_collected");
    expect(computeAcceptanceStatus("submitted", "verified_by_provider", "FSP-SBX-2026-01")).toBe("draft");
  });

  it("requires provider-issued references and a real HTTPS sandbox endpoint before verified mTLS evidence is recorded", () => {
    expect(() => validateProviderEvidenceInput({
      mtlsEvidenceState: "verified_by_provider",
      reconciliationEvidenceState: "pending",
      sandboxBaseUrl: "http://localhost:8443",
    })).toThrow("Sandbox endpoint must be an externally reachable HTTPS URL");

    expect(() => validateProviderEvidenceInput({
      mtlsEvidenceState: "verified_by_provider",
      reconciliationEvidenceState: "verified_by_provider",
      sandboxBaseUrl: "https://sandbox.provider.example",
      providerReference: "FSP-TEST-42",
    })).toThrow("Bilateral attestation reference is required");
  });

  it("rejects credential material instead of storing it as acceptance evidence", () => {
    expect(() => validateProviderEvidenceInput({
      mtlsEvidenceState: "submitted",
      reconciliationEvidenceState: "pending",
      evidenceNotes: "-----BEGIN PRIVATE KEY----- unsafe",
    })).toThrow("must not contain certificates, private keys, or bearer tokens");
  });
});
