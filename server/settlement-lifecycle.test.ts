import { describe, expect, it } from "vitest";
import { assertMakerChecker, canTransitionSettlementTransfer, providerSettlementReportSchema } from "./settlement-lifecycle";

describe("settlement lifecycle controls", () => {
  it("permits only the fail-closed lifecycle transitions", () => {
    expect(canTransitionSettlementTransfer("requested", "authorized")).toBe(true);
    expect(canTransitionSettlementTransfer("authorized", "submitted")).toBe(true);
    expect(canTransitionSettlementTransfer("submitted", "settled")).toBe(true);
    expect(canTransitionSettlementTransfer("settled", "reversed")).toBe(true);
    expect(canTransitionSettlementTransfer("requested", "submitted")).toBe(false);
    expect(canTransitionSettlementTransfer("failed", "submitted")).toBe(false);
  });

  it("rejects self-approval while allowing a distinct checker", () => {
    expect(() => assertMakerChecker("maker-1", "maker-1")).toThrow(/distinct/);
    expect(() => assertMakerChecker("maker-1", "checker-1")).not.toThrow();
  });

  it("accepts only provider-report statuses that can be independently reconciled", () => {
    expect(providerSettlementReportSchema.safeParse({
      provider: "mojaloop", reportId: "report-0001", transferId: "11111111-1111-4111-8111-111111111111",
      providerTransferId: "provider-transfer-1", status: "settled", amountCents: 10_000, currency: "USD", reportedAt: new Date().toISOString(),
    }).success).toBe(true);
    expect(providerSettlementReportSchema.safeParse({
      provider: "mojaloop", reportId: "report-0001", transferId: "11111111-1111-4111-8111-111111111111",
      providerTransferId: "provider-transfer-1", status: "requested", amountCents: 10_000, currency: "USD", reportedAt: new Date().toISOString(),
    }).success).toBe(false);
  });
});
