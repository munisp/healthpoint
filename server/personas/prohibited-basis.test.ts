import { describe, expect, it } from "vitest";
import { screenProhibitedBasis } from "./prohibited-basis";

describe("screenProhibitedBasis (45 CFR 149.510(c)(4)(ii))", () => {
  it("rejects UCR as stated basis", () => {
    expect(screenProhibitedBasis("Set at 80% of UCR for the region.")).toBeTruthy();
  });
  it("rejects 'usual and customary'", () => {
    expect(screenProhibitedBasis("Based on usual and customary charges.")).toBeTruthy();
  });
  it("rejects billed charges", () => {
    expect(screenProhibitedBasis("A discount off the billed charge.")).toBeTruthy();
  });
  it("rejects Medicare / Medicaid rates", () => {
    expect(screenProhibitedBasis("150% of Medicare rates.")).toBeTruthy();
    expect(screenProhibitedBasis("Pegged to Medicaid fee schedule.")).toBeTruthy();
  });
  it("passes a QPA-based rationale", () => {
    expect(screenProhibitedBasis(
      "After reviewing the qualifying payment amount and credible market circumstances submitted by both parties, the initiating party's offer most closely reflects the market-based rate."
    )).toBeNull();
  });
});
