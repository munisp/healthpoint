/**
 * Wave auditfix (A): PKCE state store fail-closed proof.
 *
 * In production the per-process in-memory PKCE shadow is never consulted and
 * the login flow errors when Redis is unavailable (multi-instance/restart
 * safety). In non-production the in-memory shadow still round-trips.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ORIG = { ...process.env };
const HEX64 = "a".repeat(64);

async function importFreshKeycloak(nodeEnv: string, withRedis: boolean) {
  vi.resetModules();
  process.env.NODE_ENV = nodeEnv;
  process.env.JWT_SECRET = "test-secret";
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://localhost:1/test";
  process.env.EMR_CREDENTIALS_ENCRYPTION_KEY = HEX64;
  if (withRedis) {
    process.env.REDIS_URL = "redis://127.0.0.1:6390"; // unreachable-but-configured: client object exists
  } else {
    delete process.env.REDIS_URL;
    delete process.env.REDIS_SENTINELS;
  }
  return import("./keycloak");
}

describe("PKCE state store fail-closed (auditfix A)", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    process.env.NODE_ENV = ORIG.NODE_ENV;
    if (ORIG.REDIS_URL === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = ORIG.REDIS_URL;
    if (ORIG.REDIS_SENTINELS === undefined) delete process.env.REDIS_SENTINELS; else process.env.REDIS_SENTINELS = ORIG.REDIS_SENTINELS;
    delete process.env.EMR_CREDENTIALS_ENCRYPTION_KEY;
    vi.resetModules();
  });

  it("production + no Redis: pkceSet throws and pkceGet returns null (fail closed)", async () => {
    const kc = await importFreshKeycloak("production", false);
    await expect(kc.pkceSet("st-1", { codeVerifier: "v", redirectTo: "/" }))
      .rejects.toThrow(/PKCE state store unavailable/);
    await expect(kc.pkceGet("st-1")).resolves.toBeNull();
  }, 20000); // cold import of ./_core/keycloak in production mode exceeds the 5s default

  it("non-production + no Redis: in-memory shadow round-trips (dev convenience)", async () => {
    const kc = await importFreshKeycloak("test", false);
    await kc.pkceSet("st-2", { codeVerifier: "verifier-x", redirectTo: "/dash" });
    await expect(kc.pkceGet("st-2")).resolves.toEqual({ codeVerifier: "verifier-x", redirectTo: "/dash" });
  }, 20000);

  it("production + Redis configured: pkceGet never consults the per-process shadow", async () => {
    // Seed the shadow via a non-prod import, then re-import as production with
    // a configured Redis and prove the shadow value is invisible.
    const dev = await importFreshKeycloak("test", false);
    await dev.pkceSet("st-3", { codeVerifier: "shadow-only", redirectTo: "/" });
    const prod = await importFreshKeycloak("production", true);
    // Redis at 127.0.0.1:6390 is unreachable, so cacheGet fails/returns null;
    // the critical assertion is that the shadow entry is NOT returned.
    await expect(prod.pkceGet("st-3")).resolves.toBeNull();
  }, 20000);
});
