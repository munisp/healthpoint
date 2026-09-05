import { describe, expect, it } from "vitest";
import { planDeadlineTracking, deadlineAlertKey, type DisputeDeadlineSource, type DeadlineEventRow } from "./deadline-tracking";
import { STATUTORY_DEADLINE_DEFAULTS, type IDRDeadlinePolicy } from "./deadlines";

const POLICY: IDRDeadlinePolicy = { ...STATUTORY_DEADLINE_DEFAULTS, extraClosures: new Set(), useFederalHolidays: true };
const d = (iso: string) => new Date(iso + "T00:00:00Z");

function dispute(over: Partial<DisputeDeadlineSource> = {}): DisputeDeadlineSource {
  return {
    id: "disp-1",
    referenceNumber: "IDR-2026-0001",
    status: "open_negotiation",
    currentStep: "STEP_02_OPEN_NEGOTIATION_PERIOD",
    createdBy: "user-1",
    openNegotiationDeadline: null,
    idrInitiationDeadline: null,
    entitySelectionDeadline: null,
    offerSubmissionDeadline: null,
    determinationDeadline: null,
    paymentDeadline: null,
    closedAt: null,
    ...over,
  };
}

function row(over: Partial<DeadlineEventRow> = {}): DeadlineEventRow {
  return {
    id: "evt-1",
    disputeId: "disp-1",
    deadlineType: "open_negotiation_end",
    computedDeadline: d("2026-09-18"),
    status: "open",
    tMinus5SentAt: null,
    tMinus1SentAt: null,
    overdueSentAt: null,
    ...over,
  };
}

describe("planDeadlineTracking", () => {
  it("upserts one event row per present deadline column with CFR citations and the deadline date", () => {
    const plan = planDeadlineTracking([dispute({
      openNegotiationDeadline: d("2026-10-16"),
      paymentDeadline: d("2026-11-15"),
    })], [], d("2026-09-01"), POLICY);
    expect(plan.upserts).toHaveLength(2);
    expect(plan.upserts.map(u => u.deadlineType).sort()).toEqual(["open_negotiation_end", "payment_due"]);
    expect(plan.upserts.find(u => u.deadlineType === "open_negotiation_end")!.cfrReference).toContain("149.510(b)(1)");
    expect(plan.upserts.find(u => u.deadlineType === "open_negotiation_end")!.computedDeadline).toEqual(d("2026-10-16"));
    expect(plan.upserts.find(u => u.deadlineType === "payment_due")!.dayKind).toBe("calendar");
  });

  it("skips terminal disputes entirely", () => {
    const plan = planDeadlineTracking([dispute({ status: "closed", openNegotiationDeadline: d("2026-09-18") })], [], d("2026-09-01"), POLICY);
    expect(plan.upserts).toHaveLength(0);
    expect(plan.alerts).toHaveLength(0);
    expect(plan.skipped[0].reason).toContain("terminal");
  });

  it("emits no alert when more than 5 business days remain", () => {
    const plan = planDeadlineTracking([dispute({ openNegotiationDeadline: d("2026-10-16") })], [], d("2026-09-01"), POLICY);
    expect(plan.alerts).toHaveLength(0);
  });

  it("emits t_minus_5 with a deterministic dedupe key", () => {
    // Deadline Fri 2026-09-18; now Fri 2026-09-11 → exactly 5 BD remain
    const plan = planDeadlineTracking([dispute({ openNegotiationDeadline: d("2026-09-18") })], [], d("2026-09-11"), POLICY);
    expect(plan.alerts).toHaveLength(1);
    expect(plan.alerts[0].tier).toBe("t_minus_5");
    expect(plan.alerts[0].businessDaysRemaining).toBe(5);
    expect(plan.alerts[0].alertKey).toBe(deadlineAlertKey("disp-1", "open_negotiation_end", "t_minus_5"));
  });

  it("dedupes a tier already recorded on the event row", () => {
    const existing = [row({ tMinus5SentAt: d("2026-09-11") })];
    const plan = planDeadlineTracking([dispute({ openNegotiationDeadline: d("2026-09-18") })], existing, d("2026-09-11"), POLICY);
    expect(plan.alerts).toHaveLength(0); // t_minus_5 already sent
  });

  it("escalates to t_minus_1 even when t_minus_5 was sent earlier", () => {
    const existing = [row({ tMinus5SentAt: d("2026-09-11") })];
    const plan = planDeadlineTracking([dispute({ openNegotiationDeadline: d("2026-09-18") })], existing, d("2026-09-17"), POLICY);
    expect(plan.alerts).toHaveLength(1);
    expect(plan.alerts[0].tier).toBe("t_minus_1");
  });

  it("emits overdue after the deadline passes (and dedupes overdue too)", () => {
    const existing = [row({ tMinus5SentAt: d("2026-09-11"), tMinus1SentAt: d("2026-09-17") })];
    const plan1 = planDeadlineTracking([dispute({ openNegotiationDeadline: d("2026-09-18") })], existing, d("2026-09-21"), POLICY);
    expect(plan1.alerts).toHaveLength(1);
    expect(plan1.alerts[0].tier).toBe("overdue");
    const plan2 = planDeadlineTracking([dispute({ openNegotiationDeadline: d("2026-09-18") })],
      [row({ tMinus5SentAt: d("2026-09-11"), tMinus1SentAt: d("2026-09-17"), overdueSentAt: d("2026-09-21") })],
      d("2026-09-22"), POLICY);
    expect(plan2.alerts).toHaveLength(0);
  });

  it("suppresses alerts for deadlines already met or waived", () => {
    const existing = [row({ status: "met" })];
    const plan = planDeadlineTracking([dispute({ openNegotiationDeadline: d("2026-09-18") })], existing, d("2026-09-17"), POLICY);
    expect(plan.alerts).toHaveLength(0);
  });

  it("handles multiple disputes and deadlines independently", () => {
    const disputes = [
      dispute({ id: "disp-1", openNegotiationDeadline: d("2026-09-18") }),
      dispute({ id: "disp-2", referenceNumber: "IDR-2026-0002", determinationDeadline: d("2026-09-01") }),
    ];
    const plan = planDeadlineTracking(disputes, [], d("2026-09-11"), POLICY);
    expect(plan.alerts.map(a => `${a.disputeId}:${a.tier}`).sort()).toEqual(["disp-1:t_minus_5", "disp-2:overdue"]);
  });
});
