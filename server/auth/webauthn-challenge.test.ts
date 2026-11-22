/**
 * Unit tests: server/auth/webauthn-challenge.ts (Phase 25, design §8.1).
 *
 *  - challenge store sets the repo-standard TTL and session: prefix;
 *  - consume is atomic GETDEL — single-use holds under replay;
 *  - Redis-down fails CLOSED in production, warn-and-allow outside;
 *  - webauthnRateLimit: null backend → fail-closed prod / allow non-prod;
 *    count > max → TOO_MANY_REQUESTS.
 *
 * No network: Redis is replaced by an injected double via the module's test
 * seams (ratelimit.ts IncrementFn convention). EXECUTED-VERIFIED.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const redisState = vi.hoisted(() => ({
  store: new Map<string, { value: string; ttl?: number }>(),
  clientAvailable: true,
}));

vi.mock("../redis", () => ({
  getRedisClient: () => (redisState.clientAvailable ? { fake: true } : null),
  sessionSet: async (key: string, value: string, ttlSeconds: number) => {
    redisState.store.set(key, { value, ttl: ttlSeconds });
  },
  sessionGet: async (key: string) => redisState.store.get(key)?.value ?? null,
  sessionDel: async (key: string) => { redisState.store.delete(key); },
}));

import {
  storeChallenge,
  consumeChallenge,
  webauthnRateLimit,
  clientIpOf,
} from "./webauthn-challenge";

const ORIGINAL_ENV = process.env.NODE_ENV;

beforeEach(() => {
  redisState.store.clear();
  redisState.clientAvailable = true;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_ENV;
  vi.restoreAllMocks();
});

describe("challenge store/consume", () => {
  it("stores with the default 300s TTL at the webauthn-chal key", async () => {
    await storeChallenge("cer-1", { challenge: "abc", userId: "u1", mode: "mfa" });
    const entry = redisState.store.get("webauthn-chal:cer-1");
    expect(entry).toBeTruthy();
    expect(entry!.ttl).toBe(300);
    expect(JSON.parse(entry!.value)).toEqual({ challenge: "abc", userId: "u1", mode: "mfa" });
  });

  it("consume is single-use: a replayed ceremonyId returns null", async () => {
    await storeChallenge("cer-2", { challenge: "xyz", userId: null, mode: "discoverable" });
    // Injected GETDEL double: atomic get+delete over the same map (with the
    // session: prefix the real implementation adds).
    const getdel = async (key: string) => {
      // Atomic get+delete over the same map the sessionSet mock wrote to.
      const entry = redisState.store.get(key);
      redisState.store.delete(key);
      return entry?.value ?? null;
    };
    const first = await consumeChallenge("cer-2", getdel);
    expect(first).toEqual({ challenge: "xyz", userId: null, mode: "discoverable" });
    const replay = await consumeChallenge("cer-2", getdel);
    expect(replay).toBeNull();
  });

  it("returns null for expired/unknown ceremonies", async () => {
    expect(await consumeChallenge("never-existed", async () => null)).toBeNull();
  });

  it("fails closed in production when Redis is unavailable (store)", async () => {
    process.env.NODE_ENV = "production";
    redisState.clientAvailable = false;
    await expect(storeChallenge("cer-3", { challenge: "c", userId: null, mode: "mfa" }))
      .rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("warns and degrades outside production when Redis is unavailable (store)", async () => {
    process.env.NODE_ENV = "test";
    redisState.clientAvailable = false;
    await expect(storeChallenge("cer-4", { challenge: "c", userId: null, mode: "mfa" }))
      .resolves.toBeUndefined();
    // And consume of a non-stored challenge is simply null → caller rejects.
    expect(await consumeChallenge("cer-4", async () => null)).toBeNull();
  });
});

describe("webauthnRateLimit", () => {
  it("allows at/below the limit", async () => {
    await expect(webauthnRateLimit("opts-ip:1.2.3.4", 10, 60, async () => 10)).resolves.toBeUndefined();
  });

  it("rejects above the limit with a generic TOO_MANY_REQUESTS", async () => {
    await expect(webauthnRateLimit("opts-ip:1.2.3.4", 10, 60, async () => 11))
      .rejects.toMatchObject({ code: "TOO_MANY_REQUESTS", message: "rate_limited" });
  });

  it("fails closed in production when the backend is unavailable", async () => {
    process.env.NODE_ENV = "production";
    await expect(webauthnRateLimit("verify-user:u", 5, 900, async () => null))
      .rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("warns and allows outside production when the backend is unavailable", async () => {
    process.env.NODE_ENV = "test";
    await expect(webauthnRateLimit("verify-user:u", 5, 900, async () => null)).resolves.toBeUndefined();
  });
});

describe("clientIpOf", () => {
  it("prefers the first x-forwarded-for entry", () => {
    expect(clientIpOf({ headers: { "x-forwarded-for": " 9.9.9.9 , 10.0.0.1" }, ip: "127.0.0.1" })).toBe("9.9.9.9");
  });
  it("falls back to req.ip then 'unknown'", () => {
    expect(clientIpOf({ headers: {}, ip: "8.8.8.8" })).toBe("8.8.8.8");
    expect(clientIpOf({ headers: {} })).toBe("unknown");
  });
});
