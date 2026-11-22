/**
 * server/tests/emr-url-guard.test.ts
 *
 * Phase 24 (F1): SSRF protection for EMR/FHIR outbound fetches
 * (emrConnections baseUrl, RFC 7009 revocationEndpoint, bulk-FHIR
 * statusUrl/file.url). Wraps webhook-url-guard's private-IP/DNS policy with
 * an EMR-specific HTTPS-only requirement in production.
 *
 * `node:dns`'s `lookup` is mocked so these tests never depend on real
 * network access or real DNS resolution (same pattern as
 * webhook-url-guard.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.fn();
vi.mock("node:dns", () => ({
  promises: { lookup: (...args: unknown[]) => lookupMock(...args) },
}));

import { assertEmrUrlSafe, emrFetch } from "../emr-url-guard";

/** RFC 5737 TEST-NET-3 — public (guard-allowed) but globally unroutable. */
const PUBLIC_IP = { address: "203.0.113.10", family: 4 as const };

function resolvesTo(...addresses: Array<{ address: string; family: 4 | 6 }>) {
  lookupMock.mockResolvedValueOnce(addresses);
}

beforeEach(() => {
  lookupMock.mockReset();
  lookupMock.mockResolvedValue([PUBLIC_IP]); // default: resolves publicly
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("assertEmrUrlSafe", () => {
  describe("rejects internal/private targets (literal IPs — no DNS lookup)", () => {
    const cases: Array<[string, string]> = [
      ["loopback", "https://127.0.0.1/fhir"],
      ["cloud metadata endpoint", "https://169.254.169.254/latest/meta-data/"],
      ["RFC 1918 10.x", "https://10.1.2.3/fhir"],
      ["RFC 1918 172.16.x", "https://172.16.0.5/fhir"],
      ["RFC 1918 192.168.x", "https://192.168.0.10/fhir"],
      ["CGNAT", "https://100.64.1.1/fhir"],
    ];
    for (const [label, url] of cases) {
      it(`rejects ${label} (${url})`, async () => {
        await expect(assertEmrUrlSafe(url)).rejects.toThrow(/internal, private, or restricted/);
        expect(lookupMock).not.toHaveBeenCalled();
      });
    }
    it("rejects IPv6 loopback ::1", async () => {
      await expect(assertEmrUrlSafe("https://[::1]/fhir")).rejects.toThrow(/internal, private, or restricted/);
    });
    it("rejects IPv4-mapped IPv6 loopback", async () => {
      await expect(assertEmrUrlSafe("https://[::ffff:127.0.0.1]/fhir")).rejects.toThrow(/internal, private, or restricted/);
    });
  });

  describe("rejects hostnames that resolve to private addresses (DNS)", () => {
    it("rejects a hostname resolving to 127.0.0.1", async () => {
      resolvesTo({ address: "127.0.0.1", family: 4 });
      await expect(assertEmrUrlSafe("https://emr.internal.example/fhir")).rejects.toThrow(/internal, private, or restricted/);
    });
    it("rejects when ANY resolved address is private", async () => {
      resolvesTo(PUBLIC_IP, { address: "10.0.0.9", family: 4 });
      await expect(assertEmrUrlSafe("https://emr.example.com/fhir")).rejects.toThrow(/internal, private, or restricted/);
    });
    it("rejects unresolvable hostnames (fail closed)", async () => {
      lookupMock.mockReset();
      lookupMock.mockRejectedValueOnce(new Error("ENOTFOUND"));
      await expect(assertEmrUrlSafe("https://no-such-host.invalid/fhir")).rejects.toThrow(/could not be resolved/);
    });
  });

  describe("scheme policy", () => {
    it("rejects non-http(s) schemes", async () => {
      await expect(assertEmrUrlSafe("file:///etc/passwd")).rejects.toThrow(/http or https/);
      await expect(assertEmrUrlSafe("gopher://x/")).rejects.toThrow(/http or https/);
    });
    it("rejects a malformed URL", async () => {
      await expect(assertEmrUrlSafe("not a url")).rejects.toThrow(/not a valid URL/);
    });
    it("allows plain http outside production (local EMR sandbox dev)", async () => {
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";
      try {
        resolvesTo(PUBLIC_IP);
        await expect(assertEmrUrlSafe("http://emr.example.com/fhir")).resolves.toBeUndefined();
      } finally {
        process.env.NODE_ENV = prev;
      }
    });
    it("requires https in production", async () => {
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        await expect(assertEmrUrlSafe("http://emr.example.com/fhir")).rejects.toThrow(/https in production/);
        expect(lookupMock).not.toHaveBeenCalled();
        resolvesTo(PUBLIC_IP);
        await expect(assertEmrUrlSafe("https://emr.example.com/fhir")).resolves.toBeUndefined();
      } finally {
        process.env.NODE_ENV = prev;
      }
    });
  });

  it("accepts a documented public HTTPS EMR URL", async () => {
    resolvesTo(PUBLIC_IP);
    await expect(assertEmrUrlSafe("https://fhir.epic.example.com/api/FHIR/R4")).resolves.toBeUndefined();
  });
});

describe("emrFetch", () => {
  it("validates first and sets redirect:'error' on the underlying fetch", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    resolvesTo(PUBLIC_IP);
    const res = await emrFetch("https://emr.example.com/fhir/metadata", { headers: { Accept: "application/fhir+json" } });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://emr.example.com/fhir/metadata");
    expect(init.redirect).toBe("error");
    expect((init.headers as Record<string, string>).Accept).toBe("application/fhir+json");
  });

  it("never reaches fetch for a private target", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(emrFetch("https://169.254.169.254/latest/meta-data")).rejects.toThrow(/internal, private, or restricted/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
