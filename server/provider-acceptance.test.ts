import { describe, expect, it } from "vitest";
import { computeAcceptanceStatus } from "./provider-acceptance";

describe("provider sandbox acceptance gate", () => {
  it("never self-certifies a provider acceptance as production-ready", () => {
    expect(computeAcceptanceStatus("verified_by_provider", "verified_by_provider", "FSP-SBX-2026-01")).toBe("evidence_collected");
    expect(computeAcceptanceStatus("submitted", "verified_by_provider", "FSP-SBX-2026-01")).toBe("draft");
  });
});
