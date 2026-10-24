/**
 * server/tests/webhook-url-guard.test.ts
 *
 * DEFECT-008: webhook URLs were only syntax-validated (z.string().url()),
 * never checked against their actual network destination. Any
 * authenticated user could register a webhook pointing at an internal
 * service, a cloud metadata endpoint, or another pod's ClusterIP, and the
 * server would fetch it on their behalf, both on demand (webhooks.test)
 * and automatically on every matching dispute event
 * (webhook-dispatcher.ts). Confirmed live against the local dev server
 * before this fix (see .qa/defects.md).
 *
 * `node:dns`'s `lookup` is mocked so these tests never depend on real
 * network access or real DNS resolution.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.fn();
vi.mock("node:dns", () => ({
  promises: { lookup: (...args: unknown[]) => lookupMock(...args) },
}));

import { assertWebhookUrlSafe } from "../webhook-url-guard";

function resolvesTo(...addresses: Array<{ address: string; family: 4 | 6 }>) {
  lookupMock.mockResolvedValueOnce(addresses);
}

beforeEach(() => {
  lookupMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("assertWebhookUrlSafe", () => {
  describe("rejects malformed/unsupported input", () => {
    it("rejects a non-URL string", async () => {
      await expect(assertWebhookUrlSafe("not a url")).rejects.toThrow(/not a valid URL/);
    });
    it("rejects a non-http(s) scheme", async () => {
      await expect(assertWebhookUrlSafe("ftp://example.com/hook")).rejects.toThrow(/http or https/);
    });
    it("rejects file:// (classic SSRF-adjacent local-file read attempt)", async () => {
      await expect(assertWebhookUrlSafe("file:///etc/passwd")).rejects.toThrow(/http or https/);
    });
  });

  describe("rejects literal internal/private IPv4 addresses (no DNS lookup needed)", () => {
    const cases: Array<[string, string]> = [
      ["loopback", "http://127.0.0.1/hook"],
      ["link-local / cloud metadata", "http://169.254.169.254/metadata/v1/"],
      ["RFC 1918 10.x", "http://10.0.5.5/hook"],
      ["RFC 1918 172.16-31.x", "http://172.20.0.1/hook"],
      ["RFC 1918 192.168.x", "http://192.168.1.1/hook"],
      ["CGNAT / shared address space", "http://100.64.0.1/hook"],
      ["this-network 0.x", "http://0.0.0.1/hook"],
    ];
    for (const [label, url] of cases) {
      it(`rejects ${label} (${url})`, async () => {
        await expect(assertWebhookUrlSafe(url)).rejects.toThrow(/internal, private, or restricted/);
        expect(lookupMock).not.toHaveBeenCalled();
      });
    }
  });

  describe("rejects literal internal/private IPv6 addresses", () => {
    it("rejects ::1 (loopback)", async () => {
      await expect(assertWebhookUrlSafe("http://[::1]/hook")).rejects.toThrow(/internal, private, or restricted/);
    });
    it("rejects fe80::/10 (link-local)", async () => {
      await expect(assertWebhookUrlSafe("http://[fe80::1]/hook")).rejects.toThrow(/internal, private, or restricted/);
    });
    it("rejects fd00::/8 (unique local)", async () => {
      await expect(assertWebhookUrlSafe("http://[fd12:3456::1]/hook")).rejects.toThrow(/internal, private, or restricted/);
    });
    it("rejects an IPv4-mapped IPv6 loopback", async () => {
      await expect(assertWebhookUrlSafe("http://[::ffff:127.0.0.1]/hook")).rejects.toThrow(/internal, private, or restricted/);
    });
  });

  describe("resolves hostnames via DNS and checks the resolved address", () => {
    it("rejects a hostname that resolves to a private address (e.g. DNS rebinding)", async () => {
      resolvesTo({ address: "10.1.2.3", family: 4 });
      await expect(assertWebhookUrlSafe("http://attacker-controlled.example/hook")).rejects.toThrow(/internal, private, or restricted/);
      expect(lookupMock).toHaveBeenCalledWith("attacker-controlled.example", { all: true, verbatim: true });
    });
    it("rejects when ANY resolved address is private, even if another is public", async () => {
      resolvesTo({ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 });
      await expect(assertWebhookUrlSafe("http://multi-answer.example/hook")).rejects.toThrow(/internal, private, or restricted/);
    });
    it("rejects when DNS resolution fails outright", async () => {
      lookupMock.mockRejectedValueOnce(new Error("ENOTFOUND"));
      await expect(assertWebhookUrlSafe("http://does-not-exist.invalid/hook")).rejects.toThrow(/could not be resolved/);
    });
    it("allows a hostname that resolves only to public addresses", async () => {
      resolvesTo({ address: "93.184.216.34", family: 4 });
      await expect(assertWebhookUrlSafe("https://receiver.example.com/hook")).resolves.toBeUndefined();
    });
  });

  describe("allows legitimate public destinations", () => {
    it("allows a plain public IPv4 literal", async () => {
      await expect(assertWebhookUrlSafe("http://93.184.216.34/hook")).resolves.toBeUndefined();
      expect(lookupMock).not.toHaveBeenCalled(); // literal IP never needs DNS
    });
  });
});
