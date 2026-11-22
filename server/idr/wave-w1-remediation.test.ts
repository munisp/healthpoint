/**
 * server/idr/wave-w1-remediation.test.ts
 * Verification tests for assurance wave W1 statutory P1 fixes:
 *  F1  dispute withdrawal: 'withdrawn' status, terminal STEP_20 from STEP_01..STEP_12
 *  F2  backward transitions STEP_08→STEP_06 (IDRE re-selection) / STEP_08→STEP_01 (ON restart)
 *  F3  determination correction STEP_13→STEP_12 (§ 149.510(c)(4)(viii))
 *  F4  admin-fee timing: STEP_16 recast as reconciliation checkpoint
 *  F6  air ambulance: QPA code classification, point-of-pickup geography,
 *      mileage flag; emergency air ambulance never waivable
 *  F7  state registry seed (TX/CA/FL/GA + federal-path), FEHB → FEDERAL
 *  F8  new service code: ELIGIBLE_DATABASE_REQUIRED + firstSeenDate window
 *  F9  prohibited determination basis screen shared with personas module
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  IDR_WORKFLOW_STEPS,
  WITHDRAWABLE_STEPS,
  getStatusForStep,
  validateWorkflowTransition,
  type IDRStep,
} from "../workflow/idr-workflow";
import { DISPUTE_STATUS } from "../../drizzle/schema";
import { evaluateWaiverEligibility } from "../notice-consent/waiver";
import {
  airAmbulanceRegionKey,
  classifyAirAmbulanceCode,
  computeNewServiceCodeStatus,
  isAirAmbulanceCode,
  NEW_SERVICE_CODE_WINDOW_DAYS,
  QPA_BASELINE_DATE,
  type ContractedRateRow,
} from "./qpa/methodology";
import { computeQPA } from "./qpa/engine";
import { ingestContractedRates, createInMemoryStore } from "./qpa/ingestion";
import { seedStateRegistry, FEDERAL_PATH_STATES } from "./state-programs/seed";
import { clearRegistry, getStateProgram, listRegisteredStates } from "./state-programs/registry";
import { resolveJurisdiction } from "./state-programs/resolver";
import { screenProhibitedBasis } from "../personas/prohibited-basis";

// ── F1: withdrawal ───────────────────────────────────────────────────────────

describe("F1: dispute withdrawal", () => {
  it("'withdrawn' is a dispute_status enum label", () => {
    expect(DISPUTE_STATUS).toContain("withdrawn");
  });

  it("STEP_20_DISPUTE_WITHDRAWN is terminal with no onward transitions", () => {
    const def = IDR_WORKFLOW_STEPS.STEP_20_DISPUTE_WITHDRAWN;
    expect(def.isTerminal).toBe(true);
    expect(def.allowedTransitions).toEqual([]);
    expect(getStatusForStep("STEP_20_DISPUTE_WITHDRAWN")).toBe("withdrawn");
  });

  it("every pre-determination step (STEP_01..STEP_12) can transition to STEP_20", () => {
    const stepFields: Record<string, Record<string, unknown>> = {
      STEP_01_OPEN_NEGOTIATION_INITIATED: { billedAmount: "100", qpaAmount: "80", serviceDate: new Date() },
      STEP_04_IDR_INITIATED: { serviceType: "emergency_medicine" },
      STEP_07_IDR_ENTITY_SELECTED: { idrEntityId: "e1" },
    };
    for (const step of WITHDRAWABLE_STEPS) {
      expect(() =>
        validateWorkflowTransition(step, "STEP_20_DISPUTE_WITHDRAWN", stepFields[step] ?? {})
      ).not.toThrow();
    }
    expect(WITHDRAWABLE_STEPS).toHaveLength(12);
  });

  it("post-determination steps cannot withdraw via the FSM", () => {
    const post: IDRStep[] = [
      "STEP_13_DETERMINATION_ISSUED",
      "STEP_14_PAYMENT_DETERMINATION",
      "STEP_15_PAYMENT_MADE",
      "STEP_16_ADMINISTRATIVE_FEE_PAID",
      "STEP_18_APPEAL_FILED",
    ];
    for (const step of post) {
      expect(() =>
        validateWorkflowTransition(step, "STEP_20_DISPUTE_WITHDRAWN", {})
      ).toThrow("Invalid transition");
    }
  });
});

// ── F2: backward transitions out of STEP_08 ─────────────────────────────────

describe("F2: STEP_08 backward transitions (IDRE re-selection / ON restart)", () => {
  it("STEP_08 → STEP_06 and STEP_08 → STEP_01 are structurally allowed", () => {
    expect(() =>
      validateWorkflowTransition("STEP_08_ELIGIBILITY_REVIEW", "STEP_06_IDR_ENTITY_SELECTION", {})
    ).not.toThrow();
    expect(() =>
      validateWorkflowTransition("STEP_08_ELIGIBILITY_REVIEW", "STEP_01_OPEN_NEGOTIATION_INITIATED", {})
    ).not.toThrow();
  });

  it("other steps cannot jump backward to STEP_06 or STEP_01", () => {
    expect(() =>
      validateWorkflowTransition("STEP_09_OFFER_SUBMISSION", "STEP_06_IDR_ENTITY_SELECTION", {})
    ).toThrow("Invalid transition");
    expect(() =>
      validateWorkflowTransition("STEP_07_IDR_ENTITY_SELECTED", "STEP_01_OPEN_NEGOTIATION_INITIATED", { idrEntityId: "e1" })
    ).toThrow("Invalid transition");
  });
});

// ── F3: determination correction ────────────────────────────────────────────

describe("F3: determination correction (§ 149.510(c)(4)(viii))", () => {
  it("STEP_13 → STEP_12 is structurally allowed", () => {
    expect(() =>
      validateWorkflowTransition("STEP_13_DETERMINATION_ISSUED", "STEP_12_ARBITRATION_REVIEW", {})
    ).not.toThrow();
  });

  it("STEP_12 re-entry re-triggers the 30-business-day determination deadline", () => {
    expect(IDR_WORKFLOW_STEPS.STEP_12_ARBITRATION_REVIEW.deadlineBusinessDays).toBe(30);
  });
});

// ── F4: admin-fee timing ─────────────────────────────────────────────────────

describe("F4: admin fee due at IDR initiation; STEP_16 is reconciliation", () => {
  it("STEP_16 no longer claims a fresh 30-business-day payment deadline", () => {
    const def = IDR_WORKFLOW_STEPS.STEP_16_ADMINISTRATIVE_FEE_PAID;
    expect(def.deadlineBusinessDays).toBeNull();
    expect(def.nsaReference).toContain("due at IDR initiation");
    expect(def.description.toLowerCase()).toContain("initiation");
  });
});

// ── F6: air ambulance ────────────────────────────────────────────────────────

describe("F6: air ambulance", () => {
  it("classifies base-rate vs mileage codes", () => {
    expect(classifyAirAmbulanceCode("A0428")).toBe("BASE_RATE");
    expect(classifyAirAmbulanceCode("A0430")).toBe("BASE_RATE");
    expect(classifyAirAmbulanceCode("A0435")).toBe("MILEAGE");
    expect(classifyAirAmbulanceCode("A0436")).toBe("MILEAGE");
    expect(classifyAirAmbulanceCode("99285")).toBeNull();
    expect(isAirAmbulanceCode("a0436")).toBe(true);
  });

  it("point-of-pickup geography key is namespaced and required", () => {
    expect(airAmbulanceRegionKey("TX-MSA-Dallas")).toBe("AA_POP:TX-MSA-Dallas");
    expect(() => airAmbulanceRegionKey("  ")).toThrow("pointOfPickup");
  });

  it("engine flags mileage-rated services and uses point-of-pickup region", () => {
    const mk = (serviceCode: string, region: string, cents: number, contractId: string): ContractedRateRow => ({
      payerId: "p1", serviceCode, market: "SELF_INSURED", region,
      contractedRateCents: cents, arrangementType: "FEE_FOR_SERVICE",
      effectiveDate: "2018-06-01", contractId,
    });
    const popRegion = airAmbulanceRegionKey("TX-NONMSA");
    const rates = [
      mk("A0435", popRegion, 1000, "c1"),
      mk("A0435", popRegion, 1100, "c2"),
      mk("A0435", popRegion, 1200, "c3"),
      // base-rate rates in the same geography must NOT mix into the mileage median
      mk("A0430", popRegion, 900000, "c4"),
      mk("A0430", popRegion, 950000, "c5"),
      mk("A0430", popRegion, 990000, "c6"),
    ];
    const res = computeQPA(
      { serviceCode: "A0435", market: "SELF_INSURED", region: "TX-NONMSA", pointOfPickup: "TX-NONMSA", asOfDate: "2026-03-01" },
      { rates, cpiFactors: { baseYear: 2019, factors: { 2019: 1, 2026: 1.2 } } }
    );
    expect(res.computable).toBe(true);
    expect(res.airAmbulance?.mileageRated).toBe(true);
    expect(res.airAmbulance?.regionBasis).toBe("POINT_OF_PICKUP");
    expect(res.airAmbulance?.region).toBe(popRegion);
    // median of mileage rates only (1100) × 1.2
    expect(res.medianContractedRateCents).toBe(1100);
    expect(res.qpaCents).toBe(1320);
  });

  it("notice-consent: emergency air ambulance is NEVER waivable", () => {
    const r = evaluateWaiverEligibility({ serviceCategory: "AIR_AMBULANCE", emergencyAirAmbulance: true });
    expect(r.waivable).toBe(false);
    expect(r.eligibility).toBe("NON_WAIVABLE_AIR_AMBULANCE_EMERGENCY");
    // fail-closed when emergency status unresolved
    const r2 = evaluateWaiverEligibility({ serviceCategory: "AIR_AMBULANCE" });
    expect(r2.waivable).toBe(false);
    // explicitly non-emergency air ambulance may proceed to normal evaluation
    const r3 = evaluateWaiverEligibility({ serviceCategory: "AIR_AMBULANCE", emergencyAirAmbulance: false });
    expect(r3.eligibility).toBe("WAIVABLE");
  });
});

// ── F7: state registry seed + FEHB ──────────────────────────────────────────

describe("F7: state registry seed", () => {
  beforeEach(() => clearRegistry());

  it("seeds TX/CA/FL/GA plus documented federal-path states, idempotently", () => {
    const first = seedStateRegistry();
    expect(first.seeded).toEqual(expect.arrayContaining(["TX", "CA", "FL", "GA", ...FEDERAL_PATH_STATES]));
    const second = seedStateRegistry();
    expect(second).toEqual(first);
    expect(listRegisteredStates()).toEqual([...listRegisteredStates()].sort());
    expect(getStateProgram("TX")?.scopeVsFederal).toBe("FULL");
    expect(getStateProgram("TX")?.allPayerModelAgreement?.type).toBe("NONE");
    expect(getStateProgram("CA")?.notes).toContain("vintage");
  });

  it("TX fully-insured resolves STATE after seeding", () => {
    seedStateRegistry();
    const res = resolveJurisdiction({
      planType: "FULLY_INSURED", stateCode: "TX",
      serviceCategory: "NON_EMERGENCY", dateOfService: "2026-05-01",
    });
    expect(res.regime).toBe("STATE");
    expect(res.stateProgramId).toBe("TX");
  });

  it("FEHB plans always resolve FEDERAL, even in a specified-state-law state", () => {
    seedStateRegistry();
    const res = resolveJurisdiction({
      planType: "FEHB", stateCode: "TX",
      serviceCategory: "EMERGENCY", dateOfService: "2026-05-01",
    });
    expect(res.regime).toBe("FEDERAL");
    expect(res.rationale).toContain("FEHB");
  });
});

// ── F8: new service code (§ 149.140(c)(3)) ──────────────────────────────────

describe("F8: new service code recognition", () => {
  const baselineRow = (serviceCode: string): ContractedRateRow => ({
    payerId: "p1", serviceCode, market: "SELF_INSURED", region: "R1",
    contractedRateCents: 50000, arrangementType: "FEE_FOR_SERVICE",
    effectiveDate: "2018-01-01",
  });

  it("detects codes without a 2019 baseline", () => {
    const rows = [baselineRow("99285")];
    const s = computeNewServiceCodeStatus(rows, "A0436", { firstSeenDate: "2026-06-01", asOfDate: "2026-07-01" });
    expect(s.isNewServiceCode).toBe(true);
    expect(s.daysSinceFirstSeen).toBe(30);
    expect(s.withinWindow).toBe(true);
    expect(s.windowDays).toBe(NEW_SERVICE_CODE_WINDOW_DAYS);
    const s2 = computeNewServiceCodeStatus(rows, "99285");
    expect(s2.isNewServiceCode).toBe(false);
  });

  it("engine returns ELIGIBLE_DATABASE_REQUIRED with structured reason per code", () => {
    const res = computeQPA(
      { serviceCode: "A0436", market: "SELF_INSURED", region: "R1", asOfDate: "2026-07-01" },
      { rates: [baselineRow("99285")], serviceCodeFirstSeen: { A0436: "2026-06-01" } }
    );
    expect(res.computable).toBe(false);
    expect(res.fallback).toBe("ELIGIBLE_DATABASE_REQUIRED");
    expect(res.reason).toContain("NEW_SERVICE_CODE");
    expect(res.newServiceCode?.firstSeenDate).toBe("2026-06-01");
    expect(res.newServiceCode?.windowEndDate).toBe("2026-08-30");
  });

  it("ingestion records per-code firstSeenDate so the 90-day window is computable", async () => {
    const store = createInMemoryStore();
    const row = (serviceCode: string) => ({
      payerId: "p1", serviceCode, market: "SELF_INSURED", region: "R1",
      contractedRateCents: 50000, arrangementType: "FEE_FOR_SERVICE", effectiveDate: "2019-01-01",
    });
    const prov = { sourceType: "PAYER_FILE" as const, sourceRef: "file-1", importedAt: "2026-05-01" };
    const b1 = await ingestContractedRates([row("A0436")], prov, store);
    const fs = b1.firstSeen!.find(f => f.serviceCode === "A0436")!;
    expect(fs.isNew).toBe(true);
    expect(fs.firstSeenDate).toBe("2026-05-01");
    // later import of a different batch with the same code keeps the earliest date
    const b2 = await ingestContractedRates(
      [{ ...row("A0436"), contractedRateCents: 60000 }],
      { ...prov, sourceRef: "file-2", importedAt: "2026-07-15" },
      store
    );
    const fs2 = b2.firstSeen!.find(f => f.serviceCode === "A0436")!;
    expect(fs2.isNew).toBe(false);
    expect(fs2.firstSeenDate).toBe("2026-05-01");
    expect(store.firstSeenByCode.get("A0436")).toBe("2026-05-01");
  });
});

// ── F9: prohibited determination basis ──────────────────────────────────────

describe("F9: determination-factors keyword guard", () => {
  it("screens UCR / usual and customary / billed charge / Medicare / Medicaid", () => {
    expect(screenProhibitedBasis("Set at 80% of UCR")).toBeTruthy();
    expect(screenProhibitedBasis("usual and customary charges")).toBeTruthy();
    expect(screenProhibitedBasis("based on billed charges")).toBeTruthy();
    expect(screenProhibitedBasis("150% of Medicare")).toBeTruthy();
    expect(screenProhibitedBasis("Medicaid fee schedule")).toBeTruthy();
    expect(screenProhibitedBasis("QPA plus credible circumstances under 45 CFR 149.510(c)(4)(ii)")).toBeNull();
  });
});
