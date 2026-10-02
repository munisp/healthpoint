/**
 * server/idr/wave-fa-remediation.test.ts
 * Verification tests for assurance wave F-A statutory/regulatory fixes:
 *  S1   STEP_14 payment deadline = 30 CALENDAR days end-of-day (not business days)
 *  S1b  single canonical deadline engine (computeIDRDeadlines semantics)
 *  S2/S3 initialPaymentDate anchor + late IDR-initiation rejection
 *  S4   cooling-off screen math (90-day block + 30-BD post window)
 *  S5   IDRE conflict-of-interest screen
 *  S6   PPDR $400 threshold per provider/facility
 *  S7   QPA median dedupes by contractId (one rate per contract)
 *  S9   QPA ingestion content hash excludes import date
 *  S10  AIR_AMBIANCE typo accepted on read, never emitted
 */

import { describe, it, expect } from "vitest";
import {
  IDR_WORKFLOW_STEPS,
  computeStepDeadline,
} from "../workflow/idr-workflow";
import {
  addCalendarDays,
  addBusinessDays,
  computeIDRDeadlines,
  getDeadlinePolicy,
} from "./deadlines";
import { checkIdrInitiationWindow, validateConflictCheck, checkCoolingOffForNewDispute } from "./initiation-guards";
import { computeCoolingOff } from "./cooling-off/cooling-off";
import { evaluatePpdrEligibility } from "../gfe-ppdr/ppdr";
import { computeMedianContractedRate, type ContractedRateRow } from "./qpa/methodology";
import { ingestContractedRates, createInMemoryStore } from "./qpa/ingestion";
import { normalizeServiceCategory, resolveJurisdiction } from "./state-programs/resolver";

// ── S1: STEP_14 payment deadline is 30 CALENDAR days end-of-day ─────────────

describe("S1: STEP_14 payment deadline — 30 calendar days end-of-day", () => {
  it("STEP_14 uses deadlineCalendarDays=30, not business days", () => {
    const def = IDR_WORKFLOW_STEPS.STEP_14_PAYMENT_DETERMINATION;
    expect(def.deadlineBusinessDays).toBeNull();
    expect(def.deadlineCalendarDays).toBe(30);
  });

  it("computeStepDeadline returns exactly 30 calendar days at end-of-day UTC, spanning weekends", () => {
    // Friday start: 30 calendar days includes ~4 weekends; a business-day
    // computation would land much later. Assert the exact calendar result.
    const from = new Date("2026-09-04T10:30:00Z"); // Friday
    const d = computeStepDeadline(IDR_WORKFLOW_STEPS.STEP_14_PAYMENT_DETERMINATION, from)!;
    const expected = addCalendarDays(from, 30);
    expected.setUTCHours(23, 59, 59, 999);
    expect(d.toISOString()).toBe(expected.toISOString());
    expect(d.toISOString().slice(0, 10)).toBe("2026-10-04"); // Sunday — calendar, not business
    expect(d.getUTCHours()).toBe(23);
    expect(d.getUTCMinutes()).toBe(59);
  });

  it("canonical engine paymentDeadline is calendar-day based", () => {
    const det = new Date("2026-09-04T12:00:00Z");
    const { paymentDeadline } = computeIDRDeadlines({
      openNegotiationInitiatedAt: null,
      idrInitiatedAt: null,
      idreSelectedAt: null,
      determinationIssuedAt: det,
    });
    expect(paymentDeadline!.getTime()).toBe(addCalendarDays(det, 30).getTime());
  });
});

// ── S2/S3: initialPaymentDate anchor + late-initiation rejection ─────────────

describe("S2/S3: ON window anchors on initialPaymentDate; late initiation rejected", () => {
  it("ON end and IDR initiation deadline anchor on initialPaymentDate", () => {
    const ipd = new Date("2026-09-01T00:00:00Z"); // Tuesday
    const check = checkIdrInitiationWindow({
      initialPaymentDate: ipd,
      now: new Date("2026-09-02T00:00:00Z"),
    });
    const policy = getDeadlinePolicy();
    const expectedEnd = addBusinessDays(ipd, policy.openNegotiationBusinessDays, policy);
    expect(check.openNegotiationEnd!.toISOString()).toBe(expectedEnd.toISOString());
    const expectedDeadline = addBusinessDays(expectedEnd, policy.idrInitiationWindowBusinessDays, policy);
    expect(check.idrInitiationDeadline!.toISOString()).toBe(expectedDeadline.toISOString());
    expect(check.late).toBe(false);
  });

  it("rejects initiation more than 4 business days past ON-period end", () => {
    const ipd = new Date("2026-06-01T00:00:00Z");
    const check = checkIdrInitiationWindow({
      initialPaymentDate: ipd,
      now: new Date("2026-09-05T00:00:00Z"),
    });
    expect(check.late).toBe(true);
    expect(check.businessDaysPastDeadline).toBeGreaterThan(0);
    expect(check.detail).toMatch(/4-business-day/);
    expect(check.detail).toMatch(/149\.510\(b\)\(2\)\(i\)/);
  });

  it("accepts initiation inside the 4-BD window", () => {
    const ipd = new Date("2026-09-01T00:00:00Z");
    const policy = getDeadlinePolicy();
    const onEnd = addBusinessDays(ipd, policy.openNegotiationBusinessDays, policy);
    const within = addBusinessDays(onEnd, 2, policy);
    const check = checkIdrInitiationWindow({ initialPaymentDate: ipd, now: within });
    expect(check.late).toBe(false);
  });
});

// ── S4: cooling-off math ─────────────────────────────────────────────────────

describe("S4: cooling-off (90-day suspension + 30-BD post window)", () => {
  it("blocks initiation inside the 90-calendar-day suspension window", () => {
    const det = new Date("2026-08-01T00:00:00Z");
    const r = computeCoolingOff({ paymentDeterminationDate: det, disputeType: "SINGLE" });
    expect(r.coolingOffEnd!.toISOString().slice(0, 10)).toBe("2026-10-30"); // 90 calendar days
    // A date before coolingOffEnd is inside the suspension period.
    expect(new Date("2026-09-05T00:00:00Z") < r.coolingOffEnd!).toBe(true);
    // 30-BD post-cooling-off initiation window end:
    const windowEnd = addBusinessDays(r.coolingOffEnd!, 30);
    expect(windowEnd > r.coolingOffEnd!).toBe(true);
    expect(r.earliestInitiationDate! > r.coolingOffEnd!).toBe(true);
  });

  it("batched disputes post CMS-9897-F use 30 business days", () => {
    const det = new Date("2026-11-02T00:00:00Z");
    const r = computeCoolingOff({
      paymentDeterminationDate: det,
      disputeType: "BATCHED",
      openNegotiationInitiatedOn: new Date("2026-11-10T00:00:00Z"),
    });
    // 30 business days from Mon 2026-11-02, skipping Thanksgiving (11/26).
    expect(r.coolingOffEnd!.toISOString().slice(0, 10)).toBe("2026-12-16");
  });
});

// ── S5: IDRE conflict-of-interest screen ─────────────────────────────────────

describe("S5: IDRE conflict-of-interest screen", () => {
  const good = {
    attestedBy: "user-1",
    checks: { noFinancialInterest: true, noPriorEngagement: true, noPartyAffiliation: true },
  };
  it("passes when all checks are true", () => {
    expect(validateConflictCheck(good)).toBeNull();
  });
  it("rejects when missing entirely", () => {
    expect(validateConflictCheck(undefined)).toMatch(/conflictCheck is required/);
  });
  it.each([
    { noFinancialInterest: false, noPriorEngagement: true, noPartyAffiliation: true },
    { noFinancialInterest: true, noPriorEngagement: false, noPartyAffiliation: true },
    { noFinancialInterest: true, noPriorEngagement: true, noPartyAffiliation: false },
  ])("rejects when any check is false: %o", (checks) => {
    expect(validateConflictCheck({ attestedBy: "user-1", checks })).toMatch(/conflict-of-interest screen failed/);
  });
});

// ── S6: PPDR $400 threshold per provider/facility ────────────────────────────

describe("S6: PPDR substantially-in-excess threshold is per provider", () => {
  const billedAt = new Date("2026-08-01T00:00:00Z");
  const asOf = new Date("2026-09-05T00:00:00Z");

  it("eligible when ANY single provider exceeds its GFE by >= $400, even if aggregate < $400", () => {
    // Aggregate excess = 500 - 250 = 250 (<400) but provider A alone is +500.
    const r = evaluatePpdrEligibility({
      gfeTotalUsd: 1250,
      billedTotalUsd: 1500,
      billedAt,
      insuranceBilled: false,
      asOf,
      providerTotals: [
        { providerRef: "npi-A", billedUsd: 1000, gfeUsd: 500 },
        { providerRef: "npi-B", billedUsd: 500, gfeUsd: 750 },
      ],
    });
    expect(r.eligible).toBe(true);
    expect(r.qualifyingProviders).toEqual(["npi-A"]);
  });

  it("ineligible when no single provider crosses $400 despite aggregate >= $400", () => {
    const r = evaluatePpdrEligibility({
      gfeTotalUsd: 1000,
      billedTotalUsd: 1500,
      billedAt,
      insuranceBilled: false,
      asOf,
      providerTotals: [
        { providerRef: "npi-A", billedUsd: 750, gfeUsd: 500 },
        { providerRef: "npi-B", billedUsd: 750, gfeUsd: 500 },
      ],
    });
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/per provider\/facility/);
  });

  it("backward compatible: single aggregate totals map to one implicit provider", () => {
    const r = evaluatePpdrEligibility({
      gfeTotalUsd: 1000,
      billedTotalUsd: 1500,
      billedAt,
      insuranceBilled: false,
      asOf,
    });
    expect(r.eligible).toBe(true);
    expect(r.providerExcesses).toEqual([{ providerRef: "aggregate", excessUsd: 500 }]);
  });
});

// ── S7: QPA median dedupes by contractId ─────────────────────────────────────

describe("S7: one rate per contract in the QPA median", () => {
  const base = {
    payerId: "payer-1",
    serviceCode: "99285",
    market: "SELF_INSURED",
    region: "MSA-11100",
    arrangementType: "FEE_FOR_SERVICE",
    effectiveDate: "2019-01-01",
  } as const;

  it("collapses multiple rows of one contract to the contract median", () => {
    // Contract A has 3 rows (median 100), contracts B and C one row each.
    // Without dedup the population [100,100,100,300,500] → median 100 with
    // 5 rates; with contract dedup the population is [100,300,500] → median 300.
    const rows: ContractedRateRow[] = [
      { ...base, contractedRateCents: 9000, contractId: "contract-A" },
      { ...base, contractedRateCents: 10000, contractId: "contract-A" },
      { ...base, contractedRateCents: 11000, contractId: "contract-A" },
      { ...base, contractedRateCents: 30000, contractId: "contract-B" },
      { ...base, contractedRateCents: 50000, contractId: "contract-C" },
    ];
    const m = computeMedianContractedRate(rows, {
      serviceCode: "99285",
      market: "SELF_INSURED",
      region: "MSA-11100",
      asOfDate: "2019-01-31",
    });
    expect(m.computable).toBe(true);
    expect(m.ratesUsed).toBe(3); // one rate per contract
    expect(m.eligibleRatesCents).toEqual([10000, 30000, 50000]);
    expect(m.medianCents).toBe(30000);
  });

  it("rows without contractId count individually (implicit one-per-row contract)", () => {
    const rows: ContractedRateRow[] = [
      { ...base, contractedRateCents: 10000 },
      { ...base, contractedRateCents: 30000 },
      { ...base, contractedRateCents: 50000 },
    ];
    const m = computeMedianContractedRate(rows, {
      serviceCode: "99285",
      market: "SELF_INSURED",
      region: "MSA-11100",
      asOfDate: "2019-01-31",
    });
    expect(m.computable).toBe(true);
    expect(m.ratesUsed).toBe(3);
    expect(m.medianCents).toBe(30000);
  });
});

// ── S9: content hash excludes import date ────────────────────────────────────

describe("S9: ingestion content hash is import-date independent", () => {
  const rate = () => ({
    payerId: "payer-1",
    serviceCode: "99285",
    market: "SELF_INSURED" as const,
    region: "MSA-11100",
    contractedRateCents: 25000,
    arrangementType: "FEE_FOR_SERVICE" as const,
    effectiveDate: "2019-01-15",
  });

  it("same content on different days yields the same contentHash and dedupes", async () => {
    const store = createInMemoryStore();
    const day1 = await ingestContractedRates(
      [rate()],
      { sourceType: "TIC_MRF", sourceRef: "s3://mrf/payer-a.json", importedAt: "2026-09-01" },
      store
    );
    const day2 = await ingestContractedRates(
      [rate()],
      { sourceType: "TIC_MRF", sourceRef: "s3://mrf/payer-a.json", importedAt: "2026-09-05" },
      store
    );
    expect(day2.contentHash).toBe(day1.contentHash);
    expect(day2.batchId).toBe(day1.batchId);
    expect(day2.idempotentReplay).toBe(true);
    expect(store.batches.size).toBe(1); // no duplicate batch across days
  });

  it("different content still hashes differently", async () => {
    const store = createInMemoryStore();
    const a = await ingestContractedRates(
      [rate()],
      { sourceType: "TIC_MRF", sourceRef: "s3://mrf/payer-a.json", importedAt: "2026-09-01" },
      store
    );
    const b = await ingestContractedRates(
      [{ ...rate(), contractedRateCents: 26000 }],
      { sourceType: "TIC_MRF", sourceRef: "s3://mrf/payer-a.json", importedAt: "2026-09-01" },
      store
    );
    expect(b.contentHash).not.toBe(a.contentHash);
  });
});

// ── S10: AIR_AMBIANCE accepted on read, never emitted ───────────────────────

describe("S10: AIR_AMBIANCE typo alias normalized to AIR_AMBULANCE", () => {
  it("normalizes the typo", () => {
    expect(normalizeServiceCategory("AIR_AMBIANCE" as never)).toBe("AIR_AMBULANCE");
    expect(normalizeServiceCategory("AIR_AMBULANCE")).toBe("AIR_AMBULANCE");
  });

  it("accepts the typo on read but never emits it", () => {
    const r = resolveJurisdiction({
      planType: "SELF_FUNDED",
      stateCode: "TX",
      serviceCategory: "AIR_AMBIANCE" as never,
      dateOfService: "2026-09-01",
    });
    const emitted = [r.rationale, ...r.warnings.filter(w => !w.includes("normalized"))].join(" ");
    expect(emitted).not.toContain("AIR_AMBIANCE");
    expect(r.warnings.some(w => w.includes("normalized to 'AIR_AMBULANCE'"))).toBe(true);
  });
});

// ── S4 (DB): cooling-off check against prior determined disputes ────────────

describe("S4 (DB): checkCoolingOffForNewDispute against embedded Postgres", () => {
  const itDb = process.env.DATABASE_URL ? it : it.skip;

  itDb("blocks creation keyed by (payer + serviceType + initiating party) inside 90 days", async () => {
    const { getDb } = await import("../db");
    const { disputes, disputeEvents } = await import("../../drizzle/schema");
    const db = await getDb();
    if (!db) throw new Error("no db");

    const suffix = Math.random().toString(36).slice(2, 8);
    const priorId = `test-prior-${suffix}`;
    await db.insert(disputes).values({
      id: priorId,
      referenceNumber: `IDR-2026-${suffix}`,
      initiatingPartyId: "u1",
      initiatingPartyType: "provider",
      initiatingPartyName: `WaveFA Clinic ${suffix}`,
      respondingPartyName: `WaveFA Payer ${suffix}`,
      serviceType: "emergency_medicine",
      serviceDate: new Date("2026-06-01T00:00:00Z"),
      patientState: "TX",
      facilityState: "TX",
      cptCodes: ["99285"],
      billedAmount: "1000.00",
      determinationAmount: "700.00",
      currentStep: "STEP_13_DETERMINATION_ISSUED",
      status: "determination_issued",
      createdAt: new Date("2026-06-01T00:00:00Z"),
      updatedAt: new Date("2026-08-20T00:00:00Z"),
    });
    await db.insert(disputeEvents).values({
      id: `test-ev-${suffix}`,
      disputeId: priorId,
      step: "STEP_13_DETERMINATION_ISSUED",
      eventType: "step_advanced",
      description: "determination",
      createdAt: new Date("2026-08-20T00:00:00Z"),
    });

    const blocked = await checkCoolingOffForNewDispute(db, {
      initiatingPartyName: `WaveFA Clinic ${suffix}`,
      respondingPartyName: `WaveFA Payer ${suffix}`,
      serviceType: "emergency_medicine",
      cptCodes: ["99285"],
      now: new Date("2026-09-05T00:00:00Z"),
    });
    expect(blocked.blocked).toBe(true);
    expect(blocked.priorDisputeId).toBe(priorId);
    expect(blocked.detail).toMatch(/90-calendar-day/);
    // Determination 2026-08-20 + 90 calendar days = 2026-11-18.
    expect(blocked.coolingOffEnd!.toISOString().slice(0, 10)).toBe("2026-11-18");
    // 30-BD post-cooling-off window end computed and exposed.
    expect(blocked.postCoolingOffWindowEnd! > blocked.coolingOffEnd!).toBe(true);

    // Different service key → not blocked.
    const clear = await checkCoolingOffForNewDispute(db, {
      initiatingPartyName: `WaveFA Clinic ${suffix}`,
      respondingPartyName: `WaveFA Payer ${suffix}`,
      serviceType: "radiology",
      cptCodes: ["70010"],
      now: new Date("2026-09-05T00:00:00Z"),
    });
    expect(clear.blocked).toBe(false);

    // After the cooling-off end → permitted with window detail.
    const after = await checkCoolingOffForNewDispute(db, {
      initiatingPartyName: `WaveFA Clinic ${suffix}`,
      respondingPartyName: `WaveFA Payer ${suffix}`,
      serviceType: "emergency_medicine",
      cptCodes: ["99285"],
      now: new Date("2026-12-01T00:00:00Z"),
    });
    expect(after.blocked).toBe(false);
    expect(after.coolingOffEnd).not.toBeNull();
  });
});

// ── S2 (DB): createDispute defaults initialPaymentDate and anchors ON window ─

describe("S2 (DB): createDispute initialPaymentDate anchoring", () => {
  const itDb = process.env.DATABASE_URL ? it : it.skip;

  itDb("defaults initialPaymentDate to createdAt and anchors the 30-BD ON window on it", async () => {
    const { createDispute } = await import("../db");
    const suffix = Math.random().toString(36).slice(2, 8);
    const d = await createDispute({
      initiatingPartyId: "u1",
      initiatingPartyType: "provider",
      initiatingPartyName: `WaveFA Create ${suffix}`,
      respondingPartyName: `WaveFA Payer B ${suffix}`,
      serviceType: "radiology",
      serviceDate: new Date("2026-09-01T00:00:00Z"),
      patientState: "TX",
      facilityState: "TX",
      cptCodes: ["70010"],
      billedAmount: "500.00",
    } as never);
    expect(d.initialPaymentDate).not.toBeNull();
    const policy = getDeadlinePolicy();
    const expected = addBusinessDays(d.initialPaymentDate as Date, policy.openNegotiationBusinessDays, policy);
    expect((d.openNegotiationDeadline as Date).toISOString()).toBe(expected.toISOString());
  });

  itDb("explicit initialPaymentDate anchors the ON window", async () => {
    const { createDispute } = await import("../db");
    const suffix = Math.random().toString(36).slice(2, 8);
    const ipd = new Date("2026-08-03T00:00:00Z");
    const d = await createDispute({
      initiatingPartyId: "u1",
      initiatingPartyType: "provider",
      initiatingPartyName: `WaveFA Create ${suffix}`,
      serviceType: "radiology",
      serviceDate: new Date("2026-07-01T00:00:00Z"),
      patientState: "TX",
      facilityState: "TX",
      cptCodes: ["70010"],
      billedAmount: "500.00",
      initialPaymentDate: ipd,
    } as never);
    expect((d.initialPaymentDate as Date).toISOString()).toBe(ipd.toISOString());
    const policy = getDeadlinePolicy();
    const expected = addBusinessDays(ipd, policy.openNegotiationBusinessDays, policy);
    expect((d.openNegotiationDeadline as Date).toISOString()).toBe(expected.toISOString());
  });
});

// ── S1b (DB): advanceDisputeStep delegates to the canonical engine ──────────

describe("S1b (DB): advanceDisputeStep deadlines sourced from canonical engine", () => {
  const itDb = process.env.DATABASE_URL ? it : it.skip;

  itDb("STEP_14 payment deadline is 30 calendar days end-of-day; STEP_04 window anchors on initialPaymentDate", async () => {
    const { createDispute, advanceDisputeStep } = await import("../db");
    const suffix = Math.random().toString(36).slice(2, 8);
    const ipd = new Date("2026-09-01T00:00:00Z");
    const d = await createDispute({
      initiatingPartyId: "u1",
      initiatingPartyType: "provider",
      initiatingPartyName: `WaveFA Adv ${suffix}`,
      serviceType: "radiology",
      serviceDate: new Date("2026-08-01T00:00:00Z"),
      patientState: "TX",
      facilityState: "TX",
      cptCodes: ["70010"],
      billedAmount: "500.00",
      initialPaymentDate: ipd,
    } as never);

    const s4 = await advanceDisputeStep(
      d.id, "STEP_04_IDR_INITIATED", "idr_initiated", "u1", "U One", "test", {}
    );
    const policy = getDeadlinePolicy();
    const onEnd = addBusinessDays(ipd, policy.openNegotiationBusinessDays, policy);
    const expectedInitDeadline = addBusinessDays(onEnd, policy.idrInitiationWindowBusinessDays, policy);
    expect((s4.idrInitiationDeadline as Date).toISOString()).toBe(expectedInitDeadline.toISOString());

    const s14 = await advanceDisputeStep(
      d.id, "STEP_14_PAYMENT_DETERMINATION", "payment_pending", "u1", "U One", "test", {}
    );
    const pay = s14.paymentDeadline as Date;
    // 30 calendar days, end-of-day UTC — matches the canonical engine value.
    // Exact comparison against the canonical engine value (same construction
    // as db.ts): addCalendarDays(now, 30) snapped to end-of-day UTC. The `now`
    // inside advanceDisputeStep is captured milliseconds apart, so allow a
    // small tolerance.
    const expectedRaw = addCalendarDays(new Date(), policy.paymentCalendarDays);
    const expectedPay = new Date(expectedRaw.getTime());
    expectedPay.setUTCHours(23, 59, 59, 999);
    expect(pay.getUTCHours()).toBe(23);
    expect(pay.getUTCMinutes()).toBe(59);
    expect(Math.abs(pay.getTime() - expectedPay.getTime())).toBeLessThan(5_000);
  });
});
