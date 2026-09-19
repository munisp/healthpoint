/**
 * server/tests/discovery-cache.test.ts
 *
 * Wave-W3 Keycloak discovery cache:
 *   - fresh cache (<10 min TTL) avoids repeat network discovery
 *   - after TTL, refresh failure serves the stale document (up to 1h) with a
 *     warning instead of hard-failing the login flow
 *   - beyond the stale window the error propagates
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const discoveryMock = vi.fn();
vi.mock("openid-client", () => ({
  discovery: (...args: any[]) => discoveryMock(...args),
}));

import { discoverCached, _clearDiscoveryCache } from "../_core/discovery-cache";

const issuer = new URL("https://auth.example.com/realms/healthpoint");

beforeEach(() => {
  _clearDiscoveryCache();
  discoveryMock.mockReset();
  vi.setSystemTime(new Date("2026-09-05T00:00:00Z"));
});

describe("discoverCached", () => {
  it("caches discovery for 10 minutes", async () => {
    discoveryMock.mockResolvedValue({ issuer: "cached" });
    const a = await discoverCached(issuer, "client", "secret");
    vi.setSystemTime(new Date("2026-09-05T00:09:59Z"));
    const b = await discoverCached(issuer, "client", "secret");
    expect(a).toBe(b);
    expect(discoveryMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes after the TTL", async () => {
    discoveryMock.mockResolvedValue({ issuer: "v1" });
    await discoverCached(issuer, "client", "secret");
    vi.setSystemTime(new Date("2026-09-05T00:10:01Z"));
    discoveryMock.mockResolvedValue({ issuer: "v2" });
    const c = await discoverCached(issuer, "client", "secret");
    expect((c as any).issuer).toBe("v2");
    expect(discoveryMock).toHaveBeenCalledTimes(2);
  });

  it("serves stale cache on refresh failure (IdP blip) with a warning", async () => {
    discoveryMock.mockResolvedValue({ issuer: "v1" });
    const original = await discoverCached(issuer, "client", "secret");
    vi.setSystemTime(new Date("2026-09-05T00:20:00Z"));
    discoveryMock.mockRejectedValue(new Error("IdP unreachable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const served = await discoverCached(issuer, "client", "secret");
    expect(served).toBe(original);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("hard-fails once the stale window (1h) has passed", async () => {
    discoveryMock.mockResolvedValue({ issuer: "v1" });
    await discoverCached(issuer, "client", "secret");
    vi.setSystemTime(new Date("2026-09-05T01:00:01Z"));
    discoveryMock.mockRejectedValue(new Error("IdP still down"));
    await expect(discoverCached(issuer, "client", "secret")).rejects.toThrow("IdP still down");
  });

  it("propagates discovery errors when nothing is cached", async () => {
    discoveryMock.mockRejectedValue(new Error("boom"));
    await expect(discoverCached(issuer, "client", "secret")).rejects.toThrow("boom");
  });
});
