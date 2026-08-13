import { describe, expect, it } from "vitest";
import { deriveProofStatus } from "./settlement-proof";

describe("settlement balance proof status", () => {
  it("passes only when there are no unresolved exceptions or ledger mismatches", () => {
    expect(deriveProofStatus(0, 0)).toBe("passed");
    expect(deriveProofStatus(1, 0)).toBe("failed");
    expect(deriveProofStatus(0, 1)).toBe("failed");
  });
});
