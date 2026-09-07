import { describe, expect, it } from "vitest";
import { validateWorkflowTransition } from "./idr-workflow";

describe("IDR workflow transition guards", () => {
  it("rejects skipped or terminal-step transitions", () => {
    expect(() => validateWorkflowTransition(
      "STEP_01_OPEN_NEGOTIATION_INITIATED",
      "STEP_03_OPEN_NEGOTIATION_FAILED",
      { billedAmount: "100", qpaAmount: "80", serviceDate: new Date() }
    )).toThrow("Invalid transition");
    expect(() => validateWorkflowTransition(
      "STEP_17_DISPUTE_CLOSED",
      "STEP_18_APPEAL_FILED",
      {}
    )).toThrow("terminal");
  });

  it("requires current-step statutory fields before an otherwise valid transition", () => {
    expect(() => validateWorkflowTransition(
      "STEP_01_OPEN_NEGOTIATION_INITIATED",
      "STEP_02_OPEN_NEGOTIATION_PERIOD",
      { billedAmount: "100", qpaAmount: "80" }
    )).toThrow("serviceDate");
    expect(() => validateWorkflowTransition(
      "STEP_01_OPEN_NEGOTIATION_INITIATED",
      "STEP_02_OPEN_NEGOTIATION_PERIOD",
      { billedAmount: "100", qpaAmount: "80", serviceDate: new Date() }
    )).not.toThrow();
  });

  it("appeal path is reachable: STEP_13 → STEP_18 → STEP_19 → STEP_17", () => {
    // STEP_18_APPEAL_FILED previously had no inbound transition, making the
    // appeal path unreachable.
    expect(() => validateWorkflowTransition(
      "STEP_13_DETERMINATION_ISSUED",
      "STEP_18_APPEAL_FILED",
      {}
    )).not.toThrow();
    expect(() => validateWorkflowTransition(
      "STEP_18_APPEAL_FILED",
      "STEP_19_APPEAL_RESOLVED",
      {}
    )).not.toThrow();
    expect(() => validateWorkflowTransition(
      "STEP_19_APPEAL_RESOLVED",
      "STEP_17_DISPUTE_CLOSED",
      {}
    )).not.toThrow();
  });
});
