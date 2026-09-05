import { describe, expect, it } from "vitest";
import {
  buildDeterminationRecord,
  buildVolumeSummary,
  csvCell,
  median,
  toCsv,
  volumeSummaryToCsv,
  type VolumeSummaryInput,
} from "./federal-reporting";

const d = (iso: string) => new Date(iso + "T00:00:00Z");

describe("CSV shaping", () => {
  it("emits header + rows with CRLF line endings", () => {
    const csv = toCsv(["a", "b"], [[1, "x"], [2, "y"]]);
    expect(csv).toBe("a,b\r\n1,x\r\n2,y\r\n");
  });

  it("quotes cells containing commas, quotes, and newlines", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell(null)).toBe("");
  });
});

describe("median", () => {
  it("handles odd, even, empty, and single-element inputs", () => {
    expect(median([1, 3, 5])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(median([7])).toBe(7);
  });
});

function volumeInput(over: Partial<VolumeSummaryInput> = {}): VolumeSummaryInput {
  return {
    periodStart: d("2026-01-01"),
    periodEnd: d("2026-03-31"),
    disputes: [
      { id: "d1", status: "closed", serviceType: "radiology", createdAt: d("2026-01-05"), determinedAt: d("2026-02-04"), determinationAmount: "500.00", determinationWinner: "initiating_party" },
      { id: "d2", status: "under_arbitration", serviceType: "radiology", createdAt: d("2026-02-01"), determinedAt: null, determinationAmount: null, determinationWinner: null },
      { id: "d3", status: "closed", serviceType: "anesthesiology", createdAt: d("2026-01-10"), determinedAt: d("2026-02-19"), determinationAmount: "900.00", determinationWinner: "responding_party" },
    ],
    feeTotals: [{ feeType: "administrative", status: "paid", totalCents: 46000, count: 4 }],
    ...over,
  };
}

describe("buildVolumeSummary", () => {
  it("aggregates counts by status and service type", () => {
    const s = buildVolumeSummary(volumeInput());
    expect(s.totalDisputes).toBe(3);
    expect(s.byStatus).toEqual({ closed: 2, under_arbitration: 1 });
    expect(s.byServiceType).toEqual({ radiology: 2, anesthesiology: 1 });
  });

  it("computes median days-to-determination from determination timestamps only", () => {
    const s = buildVolumeSummary(volumeInput());
    // d1: 30 days, d3: 40 days → median 35; d2 excluded (not determined)
    expect(s.determinationCount).toBe(2);
    expect(s.medianDaysToDetermination).toBe(35);
    expect(s.prevailingOfferBreakdown).toEqual({ initiating_party: 1, responding_party: 1 });
  });

  it("returns null median when nothing was determined", () => {
    const s = buildVolumeSummary(volumeInput({ disputes: [] }));
    expect(s.medianDaysToDetermination).toBeNull();
    expect(s.totalDisputes).toBe(0);
  });

  it("renders a sectioned CSV with fee totals", () => {
    const csv = volumeSummaryToCsv(buildVolumeSummary(volumeInput()));
    expect(csv).toContain("federal_idr_volume_summary,2026-01-01,2026-03-31");
    expect(csv).toContain("total_disputes,3");
    expect(csv).toContain("median_days_to_determination,35");
    expect(csv).toContain("closed,2");
    expect(csv).toContain("administrative,paid,46000,4");
  });
});

describe("buildDeterminationRecord", () => {
  const record = buildDeterminationRecord({
    dispute: {
      id: "disp-1",
      referenceNumber: "IDR-2026-0001",
      status: "closed",
      currentStep: "STEP_17_DISPUTE_CLOSED",
      serviceType: "emergency_medicine",
      serviceDate: d("2025-12-20"),
      patientState: "TX",
      facilityState: "TX",
      cptCodes: ["99285"],
      billedAmount: "1200.00",
      qpaAmount: "350.00",
      initiatingPartyOffer: "800.00",
      respondingPartyOffer: "400.00",
      determinationAmount: "800.00",
      determinationWinner: "initiating_party",
      determinationBasis: "QPA proximity and clinical complexity",
      idrEntityId: "idre-9",
      idrEntityName: "Lone Star IDRE",
      createdAt: d("2026-01-02"),
      closedAt: d("2026-03-01"),
    },
    stepEnteredAt: {
      STEP_04_IDR_INITIATED: d("2026-01-05"),
      STEP_07_IDR_ENTITY_SELECTED: d("2026-01-09"),
      STEP_13_DETERMINATION_ISSUED: d("2026-02-06"),
    },
    fees: [{ feeType: "administrative", partyRole: "initiating_party", amountCents: 11500, status: "paid" }],
  });

  it("includes offers, QPA, determination, IDRE, and lifecycle dates", () => {
    const amounts = record.amounts as Record<string, unknown>;
    expect(amounts.qpa).toBe("350.00");
    expect(amounts.determination_amount).toBe("800.00");
    expect(amounts.prevailing_offer).toBe("initiating_party");
    const dates = record.dates as Record<string, unknown>;
    expect(dates.idre_selected).toBe("2026-01-09T00:00:00.000Z");
    expect(dates.determination_issued).toBe("2026-02-06T00:00:00.000Z");
    expect((record.certified_idr_entity as Record<string, unknown>).name).toBe("Lone Star IDRE");
    expect((record.fees as unknown[])[0]).toMatchObject({ fee_type: "administrative", amount_cents: 11500 });
  });

  it("marks uncollected HHS fields as null and lists them in _not_collected", () => {
    expect((record.dispute as Record<string, unknown>).batched).toBeNull();
    expect((record.items_services as Record<string, unknown>).diagnosis_codes).toBeNull();
    const gaps = record._not_collected as string[];
    expect(gaps.some(g => g.startsWith("batched"))).toBe(true);
    expect(gaps.some(g => g.includes("plan_coverage_type"))).toBe(true);
  });
});
