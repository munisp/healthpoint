import { randomUUID } from "crypto";
import {
  SETTLEMENT_EVENT_ID_HEADER,
  SETTLEMENT_KEY_ID_HEADER,
  SETTLEMENT_SIGNATURE_HEADER,
  SETTLEMENT_TIMESTAMP_HEADER,
  signSettlementCallback,
} from "./settlement-auth";
import type { SettlementCallbackInput } from "./settlement";
import type { ProviderSettlementReportInput } from "./settlement-lifecycle";

/**
 * Hermetic test fixture for exercising HealthPoint's inbound settlement protocol.
 * It never opens a network listener, cannot initiate a transfer, and is rejected
 * outside test/development runtimes or unless payment execution is explicitly disabled.
 */
export const HERMETIC_PROVIDER_SIMULATOR = "hermetic-provider-simulator";

export type SimulatorRuntime = "test" | "development" | "production";

export interface SignedProviderEnvelope<T> {
  simulator: typeof HERMETIC_PROVIDER_SIMULATOR;
  simulated: true;
  payload: T;
  rawBody: string;
  headers: Record<string, string>;
}

export interface HermeticProviderSandboxOptions {
  callbackSecret: string;
  provider?: string;
  keyId?: string;
  paymentExecutionMode?: string;
  runtime?: SimulatorRuntime;
  now?: () => Date;
}

export interface SimulatedCallbackInput {
  disputeId: string;
  transferId: string;
  amountCents: number;
  status?: "settled" | "failed";
  eventId?: string;
}

export interface SimulatedReportInput {
  transferId: string;
  providerTransferId: string;
  amountCents: number;
  status: "accepted" | "settled" | "failed" | "reversed";
  reportId?: string;
}

function assertHermeticOnly(options: HermeticProviderSandboxOptions): void {
  const runtime = options.runtime ?? (process.env.NODE_ENV === "production" ? "production" : "test");
  const paymentExecutionMode = options.paymentExecutionMode ?? process.env.PAYMENT_EXECUTION_MODE ?? "disabled";
  if (runtime === "production") {
    throw new Error("Hermetic provider simulator is unavailable in production");
  }
  if (paymentExecutionMode !== "disabled") {
    throw new Error("Hermetic provider simulator requires PAYMENT_EXECUTION_MODE=disabled");
  }
  if (options.callbackSecret.length < 32) {
    throw new Error("Hermetic provider simulator requires a callback secret of at least 32 characters");
  }
}

function signedEnvelope<T extends SettlementCallbackInput | ProviderSettlementReportInput>(
  options: Required<Pick<HermeticProviderSandboxOptions, "callbackSecret" | "keyId">> & { now: () => Date },
  eventId: string,
  payload: T,
): SignedProviderEnvelope<T> {
  const rawBody = JSON.stringify(payload);
  const timestamp = String(options.now().getTime());
  return {
    simulator: HERMETIC_PROVIDER_SIMULATOR,
    simulated: true,
    payload,
    rawBody,
    headers: {
      "content-type": "application/json",
      [SETTLEMENT_EVENT_ID_HEADER]: eventId,
      [SETTLEMENT_KEY_ID_HEADER]: options.keyId,
      [SETTLEMENT_TIMESTAMP_HEADER]: timestamp,
      [SETTLEMENT_SIGNATURE_HEADER]: signSettlementCallback(options.callbackSecret, timestamp, rawBody),
    },
  };
}

export function createHermeticProviderSandbox(options: HermeticProviderSandboxOptions) {
  assertHermeticOnly(options);
  const provider = options.provider ?? "mojaloop";
  const keyId = options.keyId ?? "hermetic-simulator-v1";
  const now = options.now ?? (() => new Date());
  const signing = { callbackSecret: options.callbackSecret, keyId, now };

  return {
    provider,
    simulator: HERMETIC_PROVIDER_SIMULATOR,
    simulated: true as const,
    emitCallback(input: SimulatedCallbackInput): SignedProviderEnvelope<SettlementCallbackInput> {
      const eventId = input.eventId ?? `sim-callback-${randomUUID()}`;
      const payload: SettlementCallbackInput = {
        provider,
        eventId,
        transferId: input.transferId,
        disputeId: input.disputeId,
        status: input.status ?? "settled",
        amountCents: input.amountCents,
        currency: "USD",
        occurredAt: now().toISOString(),
        signatureVersion: "v1",
      };
      return signedEnvelope(signing, eventId, payload);
    },
    emitReport(input: SimulatedReportInput): SignedProviderEnvelope<ProviderSettlementReportInput> {
      const reportId = input.reportId ?? `sim-report-${randomUUID()}`;
      const payload: ProviderSettlementReportInput = {
        provider,
        reportId,
        transferId: input.transferId,
        providerTransferId: input.providerTransferId,
        status: input.status,
        amountCents: input.amountCents,
        currency: "USD",
        reportedAt: now().toISOString(),
      };
      return signedEnvelope(signing, reportId, payload);
    },
  };
}
