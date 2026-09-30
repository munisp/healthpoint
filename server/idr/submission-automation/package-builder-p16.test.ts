/**
 * Phase 16: representative block in the CMS portal submission package
 * (45 CFR 149.510(b)(2)(ii)(A)(3) as amended by CMS-9897-F). Fail-closed:
 * a partial representative block renders the package incomplete.
 */
import { describe, expect, it } from "vitest";
import { buildSubmissionPackage, type DisputeInput } from "./package-builder";

const NOW = new Date("2026-09-05T12:00:00Z");

const complete: DisputeInput = {
  initiatingPartyName: "Lakeshore Emergency Physicians",
  initiatingPartyContactEmail: "idr@lakeshore.example",
  initiatingPartyContactPhone: "555-0140",
  initiatingPartyNpi: "1234567893",
  initiatingPartyTin: "461234567",
  respondingPartyName: "Aetna Health",
  respondingPartyContactEmail: "idr@aetna.example",
  respondingPartyContactPhone: "555-0199",
  respondingPartyTin: "061234567",
  claimNumber: "CLM-1001",
  serviceCode: "99285",
  dateOfService: "2026-08-10",
  billedCharge: 4200,
  qualifyingPaymentAmount: 1800,
  initialPlanPayment: 900,
  openNegotiationInitiationDate: "2026-08-20",
  openNegotiationNoticeProofRef: "proof://on-notice/1",
  certificationAttestedAt: "2026-09-05",
  certificationAttestorName: "Pat Admin",
  supportingDocuments: ["era.pdf"],
  strictMode: false,
  now: NOW,
};

describe("buildSubmissionPackage — representative block (Phase 16)", () => {
  it("omits representative fields when no delegation exists", () => {
    const p = buildSubmissionPackage(complete);
    expect(p.portalFields.representativeLegalBusinessName).toBeUndefined();
    expect(p.checklist.some(c => c.key.startsWith("representative"))).toBe(false);
  });

  it("includes the complete representative block in portalFields", () => {
    const p = buildSubmissionPackage({
      ...complete,
      representative: {
        legalBusinessName: "Meridian RCM Partners LLC",
        contactName: "Rae Filer",
        email: "filings@meridian.example",
        phone: "555-0100",
        mailingAddress: "1 Filing Way, Hartford, CT 06103",
        attestationRef: "a".repeat(64),
        adminFeeDebtAccepted: true,
      },
    });
    expect(p.portalFields.representativeLegalBusinessName).toBe("Meridian RCM Partners LLC");
    expect(p.portalFields.representativeAttestationRef).toBe("a".repeat(64));
    expect(p.portalFields.representativeAdminFeeDebtAccepted).toBe("true");
  });

  it("fails closed (incomplete) on a partial representative block", () => {
    const p = buildSubmissionPackage({
      ...complete,
      representative: { legalBusinessName: "Meridian RCM Partners LLC" },
    });
    expect(p.complete).toBe(false);
    expect(p.missing).toContain("Representative authority attestation reference");
    expect(p.missing).toContain("Representative email");
  });
});
