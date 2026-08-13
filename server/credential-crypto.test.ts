import { beforeEach, describe, expect, it } from "vitest";
import { decryptCredentials, encryptCredentials } from "./credential-crypto";

describe("EMR credential encryption", () => {
  beforeEach(() => {
    process.env.EMR_CREDENTIALS_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  });

  it("round-trips a versioned AES-GCM envelope without exposing plaintext", () => {
    const encrypted = encryptCredentials({ clientId: "client", clientSecret: "secret" });
    expect(encrypted).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(encrypted).not.toContain("clientSecret");
    expect(encrypted).not.toContain("secret");
    expect(decryptCredentials(encrypted)).toEqual({ clientId: "client", clientSecret: "secret" });
  });

  it("rejects a modified authenticated envelope", () => {
    const encrypted = encryptCredentials({ token: "sensitive" });
    expect(() => decryptCredentials(`${encrypted.slice(0, -1)}x`)).toThrow();
  });
});
