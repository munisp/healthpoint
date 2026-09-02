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
    const [version, iv, tag, ciphertext] = encrypted.split(".");
    const bytes = Buffer.from(ciphertext, "base64url");
    bytes[0] ^= 0x01;
    const tampered = [version, iv, tag, bytes.toString("base64url")].join(".");
    expect(() => decryptCredentials(tampered)).toThrow();
  });
});
