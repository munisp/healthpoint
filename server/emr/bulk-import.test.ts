/**
 * FHIR bulk ndjson parsing + normalization — EXECUTED-VERIFIED (fixtures).
 * extractEmrData is MOCK-VERIFIED (mocked fetch; needs DATABASE_URL for the
 * connection row — skipped without embedded PG).
 */
import { describe, it, expect } from "vitest";
import {
  parseNdjson,
  normalizeFhirResources,
  claimContentHash,
  BulkImportError,
} from "./bulk-import";

const PATIENT = {
  resourceType: "Patient",
  id: "pat-1",
  address: [{ state: "tx" }],
};
const COVERAGE = {
  resourceType: "Coverage",
  id: "cov-1",
  status: "active",
  class: [{ type: { coding: [{ code: "group" }] }, value: "GRP-991" }],
  payor: [{ reference: "Organization/payer-org" }],
};
const PAYER_ORG = {
  resourceType: "Organization",
  id: "payer-org",
  name: "AETNA HEALTH",
  identifier: [{ system: "http://example.org/payer-id", value: "60054" }],
};
const PRACTITIONER = {
  resourceType: "Practitioner",
  id: "prac-1",
  identifier: [{ system: "http://hl7.org/fhir/sid/us-npi", value: "1234567893" }],
};
const CLAIM = {
  resourceType: "Claim",
  id: "clm-1",
  identifier: [{ value: "PCN-0001" }],
  status: "active",
  type: { coding: [{ code: "professional" }] },
  patient: { reference: "Patient/pat-1" },
  billablePeriod: { start: "2026-08-14", end: "2026-08-14" },
  insurer: { reference: "Organization/payer-org", display: "AETNA HEALTH" },
  provider: { reference: "Practitioner/prac-1" },
  insurance: [{ sequence: 1, focal: true, coverage: { reference: "Coverage/cov-1" } }],
  diagnosis: [
    { sequence: 1, diagnosisCodeableConcept: { coding: [{ system: "http://hl7.org/fhir/sid/icd-10-cm", code: "R07.9" }] } },
  ],
  item: [
    {
      sequence: 1,
      productOrService: { coding: [{ system: "http://www.ama-assn.org/go/cpt", code: "99285" }] },
      servicedDate: "2026-08-14",
      locationCodeableConcept: { coding: [{ code: "23" }] },
    },
  ],
  total: { value: 4200.0, currency: "USD" },
};
const EOB = {
  resourceType: "ExplanationOfBenefit",
  id: "eob-1",
  status: "active",
  patient: { reference: "Patient/pat-1" },
  claim: { reference: "Claim/clm-1" },
  insurer: { reference: "Organization/payer-org" },
  outcome: "complete",
  created: "2026-09-01T00:00:00Z",
  payment: { date: "2026-09-01", amount: { value: 900.0, currency: "USD" } },
  total: [
    { category: { coding: [{ code: "submitted" }] }, amount: { value: 4200.0 } },
    { category: { coding: [{ code: "payment" }] }, amount: { value: 900.0 } },
  ],
};

function fixtureNdjson(): string {
  return [PATIENT, COVERAGE, PAYER_ORG, PRACTITIONER, CLAIM, EOB].map(r => JSON.stringify(r)).join("\n");
}

describe("bulk-import parsing/normalization (EXECUTED-VERIFIED)", () => {
  it("parses ndjson lines into resources; rejects bad JSON with line number", () => {
    const resources = parseNdjson(fixtureNdjson());
    expect(resources).toHaveLength(6);
    expect(() => parseNdjson("{\"resourceType\":\"Patient\"}\n{bad")).toThrow(BulkImportError);
    expect(() => parseNdjson("{\"noType\":1}")).toThrow(/resourceType/);
  });

  it("normalizes Claim+EOB+Coverage+Patient into a staged claim (E3/E6)", () => {
    const { claims, stats } = normalizeFhirResources(parseNdjson(fixtureNdjson()));
    expect(stats.claims).toBe(1);
    expect(stats.eobsJoined).toBe(1);
    const c = claims[0];
    expect(c.claimId).toBe("PCN-0001");
    expect(c.patientState).toBe("TX"); // uppercased
    expect(c.serviceDate).toBe("2026-08-14");
    expect(c.placeOfService).toBe("23");
    expect(c.cptCodes).toEqual(["99285"]);
    expect(c.diagnoses).toEqual(["R07.9"]);
    expect(c.payerName).toBe("AETNA HEALTH");
    expect(c.payerId).toBe("60054");
    expect(c.billingNpi).toBe("1234567893");
    expect(c.planIdentifier).toBe("GRP-991");
    expect(c.billedCents).toBe(420000);
    expect(c.paidCents).toBe(90000);
    // EOB join supplies the §149.510 clock anchor.
    expect(c.initialPaymentDate).toBe("2026-09-01");
    // Honest nulls: not derivable from FHIR R4 core.
    expect(c.planType).toBeNull();
    expect(c.networkStatus).toBeNull();
    expect(c.noticeConsentStatus).toBeNull();
    expect(c.serviceCategory).toBeNull();
    // Provenance populated for filled fields.
    expect(c.sourceProvenance.serviceDate?.source).toBe("emr");
    expect(c.sourceResourceRefs).toContain("ExplanationOfBenefit/eob-1");
  });

  it("content hash is deterministic and sensitive to content (idempotency key)", () => {
    const { claims } = normalizeFhirResources(parseNdjson(fixtureNdjson()));
    const h1 = claimContentHash("fhir_bulk", claims[0]);
    const h2 = claimContentHash("fhir_bulk", { ...claims[0] });
    expect(h1).toBe(h2);
    const h3 = claimContentHash("fhir_bulk", { ...claims[0], billedCents: 1 });
    expect(h3).not.toBe(h1);
  });

  it("claims without EOB leave payment fields null (no fabrication)", () => {
    const ndjson = [PATIENT, CLAIM].map(r => JSON.stringify(r)).join("\n");
    const { claims } = normalizeFhirResources(parseNdjson(ndjson));
    expect(claims[0].initialPaymentDate).toBeNull();
    expect(claims[0].paidCents).toBeNull();
  });
});
