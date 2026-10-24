/**
 * server/completeness/gates.test.ts
 *
 * Phase 17-CE gate unit matrix (EXECUTED-VERIFIED, pure — no DB, no network):
 *  - per context: a complete record passes; EACH missing required field is
 *    blocked with PRECONDITION_FAILED and carries the field's CFR citation +
 *    source paths in structured details;
 *  - dispute intake gate (create) pass/block + structured cause;
 *  - STEP_04 IDR gate incl. air-ambulance notice-consent variant;
 *  - batching gate (same-payer / same-NPI, CMS-9897-F);
 *  - delegation-attestation gate;
 *  - repair-loop re-score: applying manual field values to an incomplete
 *    claim flips the engine verdict NEEDS_REVIEW → QUALIFIES.
 */
import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  assertComplete,
  assertDisputeCreateComplete,
  assertIdrInitiationComplete,
  assertOpenNegotiationComplete,
  assertBatchingComplete,
  assertDelegationAttestationComplete,
  projectDisputeCompleteness,
  createGateSpecs,
  type GateDetails,
} from "./gates";
import { REQUIRED_FIELDS, type SubmissionContext } from "../eligibility/required-fields";
import { evaluateClaimEligibility, type EligibilityClaimInput } from "../eligibility/engine";

const COMPLETE_RECORDS: Record<SubmissionContext, Record<string, unknown>> = {
  claim_ingestion: {
    claimId: "CLM-1", serviceDate: "2026-08-01", cptCodes: ["99285"], billedCents: 420000,
    serviceState: "NM", payerId: "AETNA", renderingNpi: "1234567893",
    networkStatus: "out_of_network", planType: "SELF_FUNDED",
  },
  open_negotiation_initiation: {
    initialPaymentDate: "2026-08-20", openNegotiationNoticeDate: "2026-08-21", noticeContentComplete: true,
  },
  idr_initiation: {
    initialPaymentDate: "2026-08-20", openNegotiationEndDate: "2026-10-02", planType: "SELF_FUNDED",
    serviceState: "NM", serviceCategory: "EMERGENCY", noticeConsentStatus: "none", conflictCheck: "attested",
  },
  batching: { payerId: "AETNA", renderingNpi: "1234567893", cptCodes: ["01996"], openNegotiationNoticeDate: "2026-11-15" },
  delegation_attestation: { representativeIdentity: "user-1", authorityAttestation: "Delegated authority…" },
};

function expectGateError(fn: () => void): GateDetails {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("PRECONDITION_FAILED");
    const cause = (err as unknown as { cause: GateDetails }).cause;
    expect(cause).toBeDefined();
    expect(cause.missingFields.length).toBeGreaterThan(0);
    for (const m of cause.missingFields) {
      expect(m.citation).toMatch(/45 CFR|CMS-9897-F/);
      expect(m.sourcePaths.length).toBeGreaterThan(0);
      expect(m.label.length).toBeGreaterThan(0);
    }
    return cause;
  }
  throw new Error("expected the gate to throw PRECONDITION_FAILED");
}

describe("gate matrix per context", () => {
  for (const [context, record] of Object.entries(COMPLETE_RECORDS) as Array<[SubmissionContext, Record<string, unknown>]>) {
    it(`${context}: complete record passes`, () => {
      expect(() => assertComplete({ ...record }, context)).not.toThrow();
    });
    const requiredKeys = REQUIRED_FIELDS[context].filter(f => f.requirement === "required").map(f => f.key);
    for (const key of requiredKeys) {
      it(`${context}: missing ${key} is blocked with citation`, () => {
        const rec = { ...record, [key]: null };
        const cause = expectGateError(() => assertComplete(rec, context));
        expect(cause.missingFields.map(m => m.key)).toContain(key);
        expect(cause.completenessPct).toBeLessThan(100);
      });
      it(`${context}: empty-string ${key} counts as missing (fail-closed)`, () => {
        const rec = { ...record, [key]: "" };
        expectGateError(() => assertComplete(rec, context));
      });
    }
  }
  it("conditional fields are not enforced as required", () => {
    // qpaAmount (open_negotiation_initiation) and priorPaymentDeterminationDate
    // (idr_initiation) are conditional — absence must not block.
    expect(() => assertComplete({ ...COMPLETE_RECORDS.open_negotiation_initiation }, "open_negotiation_initiation")).not.toThrow();
  });
});

describe("dispute intake gate (create)", () => {
  const base = {
    initiatingPartyName: "Provider", initiatingPartyNpi: "1234567893",
    respondingPartyName: "Payer", serviceType: "emergency_medicine",
    serviceDate: new Date().toISOString(), facilityState: "NM",
    cptCodes: ["99285"], billedAmount: "4200.00",
    initiatingPartyNonparticipating: true, now: new Date(),
  };
  it("passes a complete intake payload", () => {
    expect(() => assertDisputeCreateComplete(base)).not.toThrow();
  });
  it("blocks a missing rendering NPI with structured details", () => {
    const cause = expectGateError(() => assertDisputeCreateComplete({ ...base, initiatingPartyNpi: undefined }));
    expect(cause.missingFields.map(m => m.key)).toContain("renderingNpi");
    expect(cause.missingFields.find(m => m.key === "renderingNpi")!.citation).toContain("149.510(c)(4)(i)(A)");
  });
  it("blocks a missing plan/issuer identity", () => {
    const cause = expectGateError(() => assertDisputeCreateComplete({ ...base, respondingPartyName: undefined }));
    expect(cause.missingFields.map(m => m.key)).toContain("payerId");
  });
  it("gate specs exclude only the two documented keys (claimId, planType)", () => {
    const keys = createGateSpecs().map(s => s.key);
    expect(keys).not.toContain("claimId");
    expect(keys).not.toContain("planType");
    expect(keys).toContain("renderingNpi");
    expect(keys).toContain("noticeContentComplete");
  });
});

describe("STEP_04 IDR-initiation gate", () => {
  const dispute = {
    serviceType: "emergency_medicine", facilityState: "NM", patientState: "NM",
    initialPaymentDate: new Date(), cptCodes: ["99285"], billedAmount: "4200.00",
    initiatingPartyName: "P", respondingPartyName: "Q", serviceDate: new Date(),
  };
  it("blocks when gate-only fields are absent", () => {
    const cause = expectGateError(() =>
      assertIdrInitiationComplete(dispute, { openNegotiationEndDate: new Date() }));
    const keys = cause.missingFields.map(m => m.key);
    expect(keys).toEqual(expect.arrayContaining(["planType", "noticeConsentStatus", "conflictCheck"]));
  });
  it("passes with complete gate fields", () => {
    expect(() => assertIdrInitiationComplete(dispute, {
      openNegotiationEndDate: new Date(), planType: "SELF_FUNDED",
      noticeConsentStatus: "none", conflictCheckAttested: true,
    })).not.toThrow();
  });
  it("air-ambulance variant: noticeConsentStatus satisfied by the not-applicable sentinel", () => {
    expect(() => assertIdrInitiationComplete({ ...dispute, serviceType: "air_ambulance" }, {
      openNegotiationEndDate: new Date(), planType: "SELF_FUNDED", conflictCheckAttested: true,
    })).not.toThrow();
    // …but planType/conflictCheck still fail-closed for air ambulance.
    expectGateError(() => assertIdrInitiationComplete({ ...dispute, serviceType: "air_ambulance" }, {
      openNegotiationEndDate: new Date(),
    }));
  });
});

describe("open-negotiation (STEP_01→02) gate", () => {
  it("passes a row created through the platform defaults", () => {
    expect(() => assertOpenNegotiationComplete({
      initialPaymentDate: new Date(), createdAt: new Date(),
      initiatingPartyName: "P", respondingPartyName: "Q",
      serviceDate: new Date(), cptCodes: ["99285"], billedAmount: "100.00",
    })).not.toThrow();
  });
  it("blocks a legacy row missing the ON notice anchor", () => {
    expectGateError(() => assertOpenNegotiationComplete({
      initialPaymentDate: null, createdAt: null,
      initiatingPartyName: "P", respondingPartyName: "Q",
      serviceDate: new Date(), cptCodes: ["99285"], billedAmount: "100.00",
    }));
  });
});

describe("batching gate (CMS-9897-F)", () => {
  const items = [
    { payerId: "AETNA", renderingNpi: "1234567893", cptCodes: ["01996"] },
    { payerId: "AETNA", renderingNpi: "1234567893", cptCodes: ["01402"] },
  ];
  it("passes homogeneous batches", () => {
    expect(() => assertBatchingComplete(items, new Date())).not.toThrow();
  });
  it("blocks mixed payers", () => {
    const cause = expectGateError(() =>
      assertBatchingComplete([items[0], { ...items[1], payerId: "CIGNA" }], new Date()));
    expect(cause.missingFields.map(m => m.key)).toContain("payerId");
  });
  it("blocks mixed NPIs and empty line items", () => {
    expectGateError(() => assertBatchingComplete([items[0], { ...items[1], renderingNpi: "1099999999" }], new Date()));
    expectGateError(() => assertBatchingComplete([], new Date()));
  });
});

describe("delegation-attestation gate", () => {
  it("passes a complete attestation", () => {
    expect(() => assertDelegationAttestationComplete({ attestedByUserId: "u1", authorityText: "authority…" })).not.toThrow();
  });
  it("blocks a null attestation or missing authority text", () => {
    expectGateError(() => assertDelegationAttestationComplete(null));
    const cause = expectGateError(() => assertDelegationAttestationComplete({ attestedByUserId: "u1", authorityText: "" }));
    expect(cause.missingFields.map(m => m.key)).toContain("authorityAttestation");
  });
});

describe("completeness projection", () => {
  it("reaches 100% only with gate evidence; honestly incomplete otherwise", () => {
    const dispute = {
      currentStep: "STEP_01_OPEN_NEGOTIATION_INITIATED",
      serviceType: "emergency_medicine", facilityState: "NM",
      initialPaymentDate: new Date(), createdAt: new Date(),
      initiatingPartyName: "P", respondingPartyName: "Q",
      serviceDate: new Date(), cptCodes: ["99285"], billedAmount: "100.00",
    };
    const before = projectDisputeCompleteness(dispute, null);
    expect(before.overallCompletenessPct).toBeLessThan(100);
    expect(before.missingFields.some(m => m.key === "idr_initiation:planType")).toBe(true);
    const after = projectDisputeCompleteness(dispute, {
      planType: "SELF_FUNDED", noticeConsentStatus: "none", conflictCheckAttested: true,
    });
    expect(after.overallCompletenessPct).toBe(100);
  });
});

describe("repair-loop re-score (engine verdict transition)", () => {
  const incomplete: EligibilityClaimInput = {
    claimId: "CLM-9", serviceDate: null, cptCodes: ["99285"], billedCents: 180000,
    serviceState: "NM", payerId: "AETNA", renderingNpi: "1234567893",
    networkStatus: "out_of_network", planType: null, // missing plan type + DOS
    serviceCategory: "EMERGENCY", noticeConsentStatus: "none",
    initialPaymentDate: new Date(Date.now() - 5 * 86400_000).toISOString().slice(0, 10),
  };
  it("incomplete claim is NEEDS_REVIEW with exact missingFields", () => {
    const r = evaluateClaimEligibility(incomplete);
    expect(r.verdict).toBe("NEEDS_REVIEW");
    expect(r.missingFields).toEqual(expect.arrayContaining(["planType", "serviceDate"]));
  });
  it("applying manual values transitions NEEDS_REVIEW → QUALIFIES", () => {
    const completed: EligibilityClaimInput = {
      ...incomplete,
      planType: "SELF_FUNDED",
      serviceDate: new Date(Date.now() - 15 * 86400_000).toISOString().slice(0, 10),
    };
    const r = evaluateClaimEligibility(completed);
    expect(r.verdict).toBe("QUALIFIES");
    expect(r.missingFields).toHaveLength(0);
    expect(r.completenessPct).toBe(100);
  });
});
