import { describe, expect, it } from "vitest";
import {
  assertAttestationTransition,
  attestationText,
  canTransitionAttestation,
  planReAttestation,
  validateNewAttestation,
  type AttestationLike,
} from "./attestations";

const att = (over: Partial<AttestationLike> = {}): AttestationLike => ({
  id: "att-1",
  disputeId: "disp-1",
  attestationType: "idr_initiation",
  partyRole: "initiating_party",
  attestedBy: "user-1",
  status: "active",
  ...over,
});

describe("validateNewAttestation", () => {
  it("accepts a valid IDR-initiation attestation at STEP_04", () => {
    expect(validateNewAttestation("idr_initiation", "initiating_party", "STEP_04_IDR_INITIATED",
      { informationComplete: true, informationAccurate: true }, [])).toBeNull();
  });

  it("requires both completeness and accuracy affirmations", () => {
    expect(validateNewAttestation("idr_initiation", "initiating_party", "STEP_04_IDR_INITIATED",
      { informationComplete: false, informationAccurate: true }, [])).toBe("affirmations_required");
    expect(validateNewAttestation("idr_initiation", "initiating_party", "STEP_04_IDR_INITIATED",
      { informationComplete: true, informationAccurate: false }, [])).toBe("affirmations_required");
  });

  it("rejects attestations made at the wrong lifecycle step", () => {
    // Offer-submission attestation is only accepted during the offer window
    expect(validateNewAttestation("offer_submission", "initiating_party", "STEP_04_IDR_INITIATED",
      { informationComplete: true, informationAccurate: true }, [])).toBe("wrong_step");
    expect(validateNewAttestation("offer_submission", "responding_party", "STEP_09_OFFER_SUBMISSION",
      { informationComplete: true, informationAccurate: true }, [])).toBeNull();
    // Initiation attestation is too late once arbitration has started
    expect(validateNewAttestation("idr_initiation", "initiating_party", "STEP_12_ARBITRATION_REVIEW",
      { informationComplete: true, informationAccurate: true }, [])).toBe("wrong_step");
  });

  it("rejects a duplicate active attestation for the same party and type", () => {
    expect(validateNewAttestation("idr_initiation", "initiating_party", "STEP_05_IDR_NOTICE_SENT",
      { informationComplete: true, informationAccurate: true }, [att()])).toBe("already_active");
    // ...but the OTHER party may still attest
    expect(validateNewAttestation("idr_initiation", "responding_party", "STEP_05_IDR_NOTICE_SENT",
      { informationComplete: true, informationAccurate: true }, [att()])).toBeNull();
    // ...and a superseded attestation does not block re-attestation
    expect(validateNewAttestation("idr_initiation", "initiating_party", "STEP_05_IDR_NOTICE_SENT",
      { informationComplete: true, informationAccurate: true }, [att({ status: "superseded" })])).toBeNull();
  });
});

describe("attestation state transitions", () => {
  it("active → superseded / withdrawn; terminal states reject further moves", () => {
    expect(canTransitionAttestation("active", "superseded")).toBe(true);
    expect(canTransitionAttestation("active", "withdrawn")).toBe(true);
    expect(canTransitionAttestation("active", "active")).toBe(false);
    expect(canTransitionAttestation("superseded", "active")).toBe(false);
    expect(canTransitionAttestation("withdrawn", "superseded")).toBe(false);
    expect(() => assertAttestationTransition("withdrawn", "active")).toThrow("Invalid attestation transition");
  });
});

describe("planReAttestation", () => {
  it("supersedes the party's active attestation of the same type", () => {
    const plan = planReAttestation([att(), att({ id: "att-2", partyRole: "responding_party" })], "idr_initiation", "initiating_party");
    expect(plan).toEqual({ supersedeId: "att-1", insertType: "idr_initiation", partyRole: "initiating_party" });
  });

  it("returns null when there is no active attestation to supersede", () => {
    expect(planReAttestation([att({ status: "withdrawn" })], "idr_initiation", "initiating_party")).toBeNull();
    expect(planReAttestation([], "idr_initiation", "initiating_party")).toBeNull();
  });
});

describe("attestationText", () => {
  it("cites the governing CFR sections", () => {
    expect(attestationText("idr_initiation")).toContain("149.510(b)(2)");
    expect(attestationText("offer_submission")).toContain("149.510(c)(3)");
  });
});
