import { afterEach, describe, expect, it } from "vitest";
import {
  isTigerBeetleFinalityRequired,
  isTigerBeetleFinalityWorkerEnabled,
  runTigerBeetleFinalityWorkerOnce,
  tigerBeetleFinalityMappingSchema,
} from "./tigerbeetle-finality";
import { submitTigerBeetleFinalityTransfer } from "./tigerbeetle";

const FINALITY_ENV = [
  "TIGERBEETLE_FINALITY_REQUIRED",
  "TIGERBEETLE_FINALITY_WORKER_ENABLED",
  "TIGERBEETLE_FINALITY_EXECUTION",
  "TIGERBEETLE_ENABLED",
] as const;
const saved = new Map(FINALITY_ENV.map(name => [name, process.env[name]]));

afterEach(() => {
  for (const name of FINALITY_ENV) {
    const value = saved.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("TigerBeetle durable finality fail-closed boundaries", () => {
  it("requires an explicit finality-execution flag before importing or contacting a client", async () => {
    delete process.env.TIGERBEETLE_FINALITY_EXECUTION;
    delete process.env.TIGERBEETLE_ENABLED;
    await expect(submitTigerBeetleFinalityTransfer({
      id: 1001n,
      debitAccountId: 2001n,
      creditAccountId: 2002n,
      amountCents: 9007199254740993n,
      ledger: 1,
      code: 1,
    })).rejects.toThrow("finality submission is disabled");
  });

  it("does not run a worker or initialize PostgreSQL when the worker flag is absent", async () => {
    delete process.env.TIGERBEETLE_FINALITY_WORKER_ENABLED;
    expect(isTigerBeetleFinalityWorkerEnabled()).toBe(false);
    await expect(runTigerBeetleFinalityWorkerOnce()).resolves.toEqual({ claimed: 0, committed: 0, retryable: 0, exceptions: 0 });
  });

  it("rejects an enabled worker before database or network access when no specific approval ID is supplied", async () => {
    process.env.TIGERBEETLE_FINALITY_WORKER_ENABLED = "true";
    process.env.TIGERBEETLE_FINALITY_REQUIRED = "true";
    await expect(runTigerBeetleFinalityWorkerOnce()).rejects.toThrow("specific approved finality submission authorization");
  });

  it("requires canonical u128 mapping identifiers, a bounded ledger/code, and an opaque approval reference", () => {
    expect(() => tigerBeetleFinalityMappingSchema.parse({
      provider: "sandbox-provider",
      currency: "USD",
      debitAccountId: "0",
      creditAccountId: "2",
      ledger: 1,
      code: 1,
      mappingVersion: 1,
      approvalReference: "CHG-1001",
    })).toThrow();
    expect(() => tigerBeetleFinalityMappingSchema.parse({
      provider: "sandbox-provider",
      currency: "USD",
      debitAccountId: "1",
      creditAccountId: "2",
      ledger: 0,
      code: 1,
      mappingVersion: 1,
      approvalReference: "CHG-1001",
    })).toThrow();
    const parsed = tigerBeetleFinalityMappingSchema.parse({
      provider: "sandbox-provider",
      currency: "USD",
      debitAccountId: "9007199254740993",
      creditAccountId: "9007199254740994",
      ledger: 7,
      code: 42,
      mappingVersion: 1,
      approvalReference: "CHG-1001",
    });
    expect(parsed.debitAccountId).toBe(9007199254740993n);
    expect(parsed.creditAccountId).toBe(9007199254740994n);
    expect(isTigerBeetleFinalityRequired()).toBe(false);
  });
});
