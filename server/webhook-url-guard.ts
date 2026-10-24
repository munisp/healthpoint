/**
 * server/webhook-url-guard.ts
 *
 * SSRF protection for user-supplied webhook URLs (DEFECT-008).
 * `z.string().url()` only validates syntax; it never checks a URL's
 * actual network destination. Without this guard, any authenticated
 * user could register a webhook pointing at an internal service, a
 * cloud metadata endpoint, or another pod's ClusterIP, and the server
 * would fetch it on their behalf — both on demand (webhooks.test) and
 * automatically on every matching dispute event (webhook-dispatcher.ts).
 *
 * Called twice by design, not once:
 *   1. At create/update time, for fast, friendly feedback.
 *   2. Immediately before every actual fetch (webhooks.test and the
 *      real dispatcher), re-resolving DNS each time — a hostname that
 *      resolved to a public IP at creation time could be repointed at
 *      an internal address later (DNS rebinding). Only the fetch-time
 *      check is a real security boundary; the create-time check is UX.
 */

import { promises as dns } from "node:dns";
import net from "node:net";
import { TRPCError } from "@trpc/server";

type Ipv4Range = { base: string; bits: number };

const BLOCKED_IPV4_RANGES: Ipv4Range[] = [
  { base: "0.0.0.0", bits: 8 }, // "this network"
  { base: "10.0.0.0", bits: 8 }, // RFC 1918
  { base: "100.64.0.0", bits: 10 }, // shared address space / CGNAT
  { base: "127.0.0.0", bits: 8 }, // loopback
  { base: "169.254.0.0", bits: 16 }, // link-local -- covers 169.254.169.254 cloud metadata
  { base: "172.16.0.0", bits: 12 }, // RFC 1918
  { base: "192.0.0.0", bits: 24 }, // IETF protocol assignments
  { base: "192.168.0.0", bits: 16 }, // RFC 1918
  { base: "198.18.0.0", bits: 15 }, // benchmarking
  { base: "224.0.0.0", bits: 4 }, // multicast and above (includes 240.0.0.0/4 reserved + 255.255.255.255)
];

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function isIpv4InRange(ip: string, range: Ipv4Range): boolean {
  const mask = range.bits === 0 ? 0 : (~0 << (32 - range.bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(range.base) & mask);
}

function isBlockedIpv4(ip: string): boolean {
  return BLOCKED_IPV4_RANGES.some(range => isIpv4InRange(ip, range));
}

function isBlockedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true; // loopback / unspecified
  if (/^fe[89ab][0-9a-f]:/.test(normalized)) return true; // link-local fe80::/10
  if (/^f[cd][0-9a-f]{2}:/.test(normalized)) return true; // unique local fc00::/7

  // IPv4-mapped IPv6 (::ffff:a.b.c.d) appears in two equivalent forms: the
  // dotted-decimal form, and the pure-hex-group form Node's URL parser
  // actually normalizes it to (e.g. ::ffff:127.0.0.1 -> ::ffff:7f00:1).
  const dotted = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return isBlockedIpv4(dotted[1]);
  const hexGroups = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexGroups) {
    const hi = Number.parseInt(hexGroups[1], 16);
    const lo = Number.parseInt(hexGroups[2], 16);
    const asIpv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return isBlockedIpv4(asIpv4);
  }
  return false;
}

function isBlockedAddress(address: string): boolean {
  if (net.isIPv4(address)) return isBlockedIpv4(address);
  if (net.isIPv6(address)) return isBlockedIpv6(address);
  return true; // unrecognized address shape -- fail closed
}

/**
 * Throws BAD_REQUEST when `rawUrl` is not an http(s) URL, or resolves
 * (by literal IP or DNS) to any internal/private/link-local/loopback
 * address. Safe to call on both user input and immediately before a
 * real fetch.
 */
export async function assertWebhookUrlSafe(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Webhook URL is not a valid URL" });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Webhook URL must use http or https" });
  }

  const hostname = parsed.hostname.replace(/^\[/, "").replace(/\]$/, ""); // strip IPv6 brackets
  const literalIpVersion = net.isIP(hostname);

  let addresses: string[];
  if (literalIpVersion) {
    addresses = [hostname];
  } else {
    try {
      addresses = (await dns.lookup(hostname, { all: true, verbatim: true })).map(r => r.address);
    } catch {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Webhook URL hostname could not be resolved" });
    }
  }

  if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Webhook URL must not point to an internal, private, or restricted network address",
    });
  }
}
