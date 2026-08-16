import { describe, expect, it } from "vitest";
import { createHermeticProviderSandbox, HERMETIC_PROVIDER_SIMULATOR } from "./provider-sandbox-simulator";
import { settlementCallbackSchema } from "./settlement";
import { providerSettlementReportSchema } from "./settlement-lifecycle";
import {
  SETTLEMENT_EVENT_ID_HEADER,
  SETTLEMENT_KEY_ID_HEADER,
  SETTLEMENT_SIGNATURE_HEADER,
  SETTLEMENT_TIMESTAMP_HEADER,
  verifySettlementCallbackSignature,
} from "./settlement-auth";

const secret = "simulator-settlement-secret-with-at-least-thirty-two-characters";
const now = new Date("2026-08-16T12:00:00.000Z");

describe("hermetic provider/FSP sandbox simulator", () => {
  it("emits valid signed callbacks and reports without a network or payment rail", () => {
    const simulator = createHermeticProviderSandbox({ callbackSecret: secret, runtime: "test", paymentExecutionMode: "disabled", now: () => now });
    const callback = simulator.emitCallback({
      disputeId: "11111111-1111-4111-8111-111111111111",
      transferId: "sandbox-transfer-001",
      amountCents: 10_000,
      eventId: "sandbox-event-001",
    });
    const report = simulator.emitReport({
      transferId: "11111111-1111-4111-8111-111111111111",
      providerTransferId: "sandbox-transfer-001",
      amountCents: 10_000,
      status: "settled",
      reportId: "sandbox-report-001",
    });

    expect(callback.simulator).toBe(HERMETIC_PROVIDER_SIMULATOR);
    expect(callback.simulated).toBe(true);
    expect(settlementCallbackSchema.safeParse(callback.payload).success).toBe(true);
    expect(providerSettlementReportSchema.safeParse(report.payload).success).toBe(true);
    expect(callback.headers[SETTLEMENT_EVENT_ID_HEADER]).toBe(callback.payload.eventId);
    expect(report.headers[SETTLEMENT_EVENT_ID_HEADER]).toBe(report.payload.reportId);
    expect(verifySettlementCallbackSignature({
      secret,
      keyId: callback.headers[SETTLEMENT_KEY_ID_HEADER],
      timestamp: callback.headers[SETTLEMENT_TIMESTAMP_HEADER],
      signature: callback.headers[SETTLEMENT_SIGNATURE_HEADER],
      rawBody: callback.rawBody,
      now,
    })).toEqual({ valid: true });
  });

  it("rejects production or non-disabled payment modes", () => {
    expect(() => createHermeticProviderSandbox({ callbackSecret: secret, runtime: "production", paymentExecutionMode: "disabled" }))
      .toThrow(/unavailable in production/);
    expect(() => createHermeticProviderSandbox({ callbackSecret: secret, runtime: "test", paymentExecutionMode: "sandbox" }))
      .toThrow(/PAYMENT_EXECUTION_MODE=disabled/);
  });
});
