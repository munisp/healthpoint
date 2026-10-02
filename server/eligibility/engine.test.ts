/**
 * Eligibility engine rule matrix — EXECUTED-VERIFIED (pure functions).
 * Verdicts: QUALIFIES only when all required fields present AND all rules
 * pass; BLOCKED on rule failure; NEEDS_REVIEW on missing fields / bifurcated
 * jurisdiction. All rule outcomes carry CFR citations. Verdicts are
 * eligibility determinations — never an assurance of outcome.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { evaluateClaimEligibility, type EligibilityClaimInput } from "./engine";
import { seedStateRegistry } from "../idr/state-programs/seed";
import { evaluateContextCompleteness, REQUIRED_FIELDS } from "./required-fields";

const NOW = new Date("2026-09-05T12:00:00Z");

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86400_000).toISOString().slice(0, 10);
}

/** Fully-populated, federally-eligible claim (state NM: no registered state program → FEDERAL). */
function qualifyingClaim(): EligibilityClaimInput {
  return {
    claimId: "PCN-Q1",
    planType: "SELF_FUNDED",
    serviceCategory: "EMERGENCY",
    serviceState: "NM",
    serviceDate: daysAgo(15),
    cptCodes: ["99285"],
    billedCents: 420000,
    payerId: "60054",
    renderingNpi: "1234567893",
    networkStatus: "out_of_network",
    noticeConsentStatus: "none",
    initialPaymentDate: daysAgo(10), // inside ONP+4BD window
  };
}

beforeAll(() => {
  seedStateRegistry(); // registers TX (full), CA/FL/GA (partial), federal-path states
});

describe("eligibility engine rule matrix", () => {
  it("QUALIFIES: all fields present, federal jurisdiction, all rules pass", () => {
    const r = evaluateClaimEligibility(qualifyingClaim(), { now: NOW });
    expect(r.verdict).toBe("QUALIFIES");
    expect(r.jurisdiction).toBe("FEDERAL");
    expect(r.missingFields).toEqual([]);
    expect(r.completenessPct).toBe(100);
    // Citations on every fired rule.
    for (const f of r.rulesFired) expect(f.citation).toMatch(/45 CFR|CMS-9897-F/);
    expect(r.rulesFired.some(f => f.rule === "jurisdiction" && f.citation.includes("149.140"))).toBe(true);
    expect(r.rulesFired.some(f => f.rule === "idr_initiation_window" && f.citation.includes("149.510(b)(2)(i)"))).toBe(true);
  });

  it("NEEDS_REVIEW: missing eligibility-critical fields (E6) — never QUALIFIES", () => {
    const c = qualifyingClaim();
    c.planType = null;
    c.networkStatus = null;
    c.initialPaymentDate = null;
    const r = evaluateClaimEligibility(c, { now: NOW });
    expect(r.verdict).toBe("NEEDS_REVIEW");
    expect(r.missingFields).toContain("planType");
    expect(r.missingFields).toContain("networkStatus");
    expect(r.missingFields).toContain("initialPaymentDate");
    expect(r.completenessPct).toBeLessThan(100);
  });

  it("BLOCKED: in-network provider — NSA OON protections inapplicable", () => {
    const r = evaluateClaimEligibility({ ...qualifyingClaim(), networkStatus: "in_network" }, { now: NOW });
    expect(r.verdict).toBe("BLOCKED");
    expect(r.rulesFired.find(f => f.rule === "network_status")?.effect).toBe("block");
    expect(r.blockReasons[0]).toMatch(/IN-NETWORK/i);
  });

  it("BLOCKED: late IDR initiation (§149.510(b)(2)(i))", () => {
    const r = evaluateClaimEligibility({ ...qualifyingClaim(), initialPaymentDate: daysAgo(400) }, { now: NOW });
    expect(r.verdict).toBe("BLOCKED");
    expect(r.rulesFired.find(f => f.rule === "idr_initiation_window")?.effect).toBe("block");
    expect(r.blockReasons.join(" ")).toMatch(/lapsed/i);
  });

  it("BLOCKED: cooling-off in effect (§149.510(c)(4)(vii)(B))", () => {
    const r = evaluateClaimEligibility(
      { ...qualifyingClaim(), priorPaymentDeterminationDate: daysAgo(30) },
      { now: NOW },
    );
    expect(r.verdict).toBe("BLOCKED");
    expect(r.rulesFired.find(f => f.rule === "cooling_off")?.effect).toBe("block");
  });

  it("BLOCKED: valid notice-and-consent waiver (non-emergency, waivable)", () => {
    const r = evaluateClaimEligibility(
      { ...qualifyingClaim(), serviceCategory: "NON_EMERGENCY", noticeConsentStatus: "signed" },
      { now: NOW },
    );
    expect(r.verdict).toBe("BLOCKED");
    expect(r.rulesFired.find(f => f.rule === "notice_consent")?.effect).toBe("block");
  });

  it("QUALIFIES despite signed notice when category is non-waivable (emergency)", () => {
    const r = evaluateClaimEligibility(
      { ...qualifyingClaim(), noticeConsentStatus: "signed" },
      { now: NOW },
    );
    // Emergency services: waiver ineffective → protections stand.
    expect(r.verdict).toBe("QUALIFIES");
    expect(r.rulesFired.find(f => f.rule === "notice_consent")?.effect).toBe("pass");
  });

  it("BLOCKED: full-scope specified state law (TX SB 1264, fully-insured) → state process", () => {
    const r = evaluateClaimEligibility(
      { ...qualifyingClaim(), planType: "FULLY_INSURED", serviceState: "TX" },
      { now: NOW },
    );
    expect(r.verdict).toBe("BLOCKED");
    expect(r.jurisdiction).toBe("STATE");
    expect(r.rulesFired.find(f => f.rule === "jurisdiction")?.effect).toBe("block");
  });

  it("NEEDS_REVIEW: bifurcated (partial) state program (FL, fully-insured)", () => {
    const r = evaluateClaimEligibility(
      { ...qualifyingClaim(), planType: "FULLY_INSURED", serviceState: "FL" },
      { now: NOW },
    );
    expect(r.verdict).toBe("NEEDS_REVIEW");
    expect(r.jurisdiction).toBe("BIFURCATED_SPLIT");
  });

  it("NEEDS_REVIEW: prohibited basis in rationale (§149.510(c)(4)(ii))", () => {
    const r = evaluateClaimEligibility(
      { ...qualifyingClaim(), determinationRationale: "Determination based on usual and customary charges" },
      { now: NOW },
    );
    expect(r.verdict).toBe("NEEDS_REVIEW");
    expect(r.rulesFired.find(f => f.rule === "prohibited_basis")?.effect).toBe("review");
  });

  it("FEHB resolves FEDERAL (5 U.S.C. § 8902(p))", () => {
    const r = evaluateClaimEligibility({ ...qualifyingClaim(), planType: "FEHB", serviceState: "TX" }, { now: NOW });
    expect(r.jurisdiction).toBe("FEDERAL");
  });
});

describe("required-fields dictionary (standalone)", () => {
  it("declares required fields with citations and sources for all contexts", () => {
    for (const ctx of ["claim_ingestion", "open_negotiation_initiation", "idr_initiation", "batching", "delegation_attestation"] as const) {
      const specs = REQUIRED_FIELDS[ctx];
      expect(specs.length).toBeGreaterThan(0);
      for (const s of specs) {
        expect(s.citation).toMatch(/45 CFR|CMS-9897-F/);
        expect(s.sources.length).toBeGreaterThan(0);
      }
    }
  });

  it("evaluateContextCompleteness is fail-closed (missing = NEEDS_REVIEW driver)", () => {
    const r = evaluateContextCompleteness("claim_ingestion", { claimId: "X" });
    expect(r.missingFields.length).toBeGreaterThan(0);
    expect(r.completenessPct).toBeLessThan(100);
    const full = evaluateContextCompleteness("claim_ingestion", {
      claimId: "X", serviceDate: "2026-08-14", cptCodes: ["99285"], billedCents: 100,
      serviceState: "TX", payerId: "P", renderingNpi: "1234567893",
      networkStatus: "out_of_network", planType: "SELF_FUNDED",
    });
    expect(full.missingFields).toEqual([]);
    expect(full.completenessPct).toBe(100);
  });
});
