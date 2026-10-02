/**
 * server/tests/smart-token-crypto.test.ts
 *
 * Wave-W3 SMART token encryption at rest:
 *   - AES-256-GCM envelope round-trip (encryptToken/decryptToken)
 *   - plaintext fallback read for legacy rows
 *   - envelope is distinguishable from legacy plaintext (isEncryptedToken)
 *   - tampering is rejected (GCM auth tag)
 */
import { beforeEach, describe, expect, it } from "vitest";

const KEY = "a".repeat(64); // 64-hex AES-256 test key

beforeEach(() => {
  process.env.EMR_CREDENTIALS_ENCRYPTION_KEY = KEY;
});

import { encryptToken, decryptToken, isEncryptedToken, encryptCredentials, decryptCredentials } from "../credential-crypto";

describe("token envelope", () => {
  it("round-trips an access token", () => {
    const token = "eyJhbGciOiJSUzI1NiJ9.smart-access-token.payload";
    const envelope = encryptToken(token);
    expect(envelope).not.toContain(token);
    expect(isEncryptedToken(envelope)).toBe(true);
    expect(decryptToken(envelope)).toBe(token);
  });

  it("round-trips a refresh token", () => {
    const token = "refresh-token-12345";
    expect(decryptToken(encryptToken(token))).toBe(token);
  });

  it("falls back to plaintext for legacy rows", () => {
    const legacy = "legacy-plaintext-token";
    expect(isEncryptedToken(legacy)).toBe(false);
    expect(decryptToken(legacy)).toBe(legacy);
  });

  it("rejects tampered envelopes", () => {
    const envelope = encryptToken("secret-token");
    const parts = envelope.split(".");
    parts[3] = parts[3].slice(0, -2) + "XX";
    expect(() => decryptToken(parts.join("."))).toThrow();
  });

  it("produces unique envelopes per encryption (random IV)", () => {
    expect(encryptToken("same")).not.toBe(encryptToken("same"));
  });
});

describe("credential helper unchanged", () => {
  it("still round-trips EMR credential JSON", () => {
    const creds = { clientId: "abc", clientSecret: "def", revocationEndpoint: "https://emr.example.com/oauth/revoke" };
    expect(decryptCredentials(encryptCredentials(creds))).toEqual(creds);
  });
});
