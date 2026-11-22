/**
 * Phase 21 (S1) unit tests: PHI denylist stripping and context-hash
 * determinism. DB-backed idempotent-replay coverage lives in
 * server/routers/wave-p21.test.ts.
 */
import { describe, it, expect } from "vitest";
import { stripPhiMetadata, contextHash, sha256Hex } from "./intelligence";

describe("stripPhiMetadata (PHI denylist)", () => {
  it("strips PHI-shaped keys, keeps segment keys", () => {
    const out = stripPhiMetadata({
      serviceType: "EMERGENCY",
      patientName: "Jane Doe",
      mrn: "12345",
      dob: "1980-01-01",
      notes: "free text",
      claimNotes: "x",
      segment: "aetna-er",
    });
    expect(out).toEqual({ serviceType: "EMERGENCY", segment: "aetna-er" });
  });
  it("strips denylisted keys nested one level and drops deeper objects", () => {
    const out = stripPhiMetadata({
      extra: { ssn: "999", kind: "k", deep: { nope: true } },
    });
    expect(out).toEqual({ extra: { kind: "k" } });
  });
  it("passes through undefined and empty metadata", () => {
    expect(stripPhiMetadata(undefined)).toBeUndefined();
    expect(stripPhiMetadata({})).toEqual({});
  });
});

describe("contextHash", () => {
  it("is deterministic and key-order independent", () => {
    const a = contextHash("org1", "offer_recommendation", { b: "2", a: "1" });
    const b = contextHash("org1", "offer_recommendation", { a: "1", b: "2" });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
  it("differs across orgs and surfaces", () => {
    const base = contextHash("org1", "s1", { k: "v" });
    expect(contextHash("org2", "s1", { k: "v" })).not.toBe(base);
    expect(contextHash("org1", "s2", { k: "v" })).not.toBe(base);
  });
  it("sha256Hex never returns the raw value", () => {
    const h = sha256Hex("secret-value");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("secret");
  });
});
