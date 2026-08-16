import { afterEach, describe, expect, it } from "vitest";
import {
  EmrSandboxSimulationError,
  simulateEncryptedEmrCredentialLifecycle,
} from "./emr-sandbox-simulator";

const originalEnv = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

describe("test-only EMR credential simulation", () => {
  it("validates encrypted credentials without contacting an external EMR", () => {
    process.env.NODE_ENV = "test";
    process.env.EMR_CREDENTIALS_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    const result = simulateEncryptedEmrCredentialLifecycle({
      clientId: "sandbox-client",
      clientSecret: "sandbox-secret",
    });

    expect(result.mode).toBe("test-only");
    expect(result.externalConnectionAttempted).toBe(false);
    expect(result.credentialKeysValidated).toEqual(["clientId", "clientSecret"]);
    expect(result.encryptedCredentialFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("refuses to simulate EMR credentials in production", () => {
    process.env.NODE_ENV = "production";
    process.env.EMR_CREDENTIALS_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    expect(() => simulateEncryptedEmrCredentialLifecycle({ clientId: "sandbox-client" }))
      .toThrow(EmrSandboxSimulationError);
  });
});
