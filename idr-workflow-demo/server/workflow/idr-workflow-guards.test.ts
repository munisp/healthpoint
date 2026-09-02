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
});
