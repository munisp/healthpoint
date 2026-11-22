/**
 * server/emr-url-guard.ts
 *
 * Phase 24 (F1 / identity+api audit §6): SSRF protection for EMR/FHIR
 * outbound fetches. `emrConnections.create` accepted an arbitrary `baseUrl`
 * which the server later fetched (`/metadata`, `/Patient?…`), the RFC 7009
 * revocation path POSTed access tokens to a stored `revocationEndpoint`,
 * and the bulk-FHIR worker fetched `statusUrl` / `file.url` straight out of
 * the EMR's $export response — all without the SSRF guard that webhook URLs
 * already get, and all following redirects by default.
 *
 * This module applies the existing webhook-url-guard policy (DNS
 * re-resolution at fetch time, private/loopback/link-local blocks) to every
 * EMR fetch path, with one EMR-specific tightening: in production the URL
 * must be HTTPS (plaintext http stays available outside production for
 * local EMR sandboxes, mirroring the repo's dev-vs-prod conventions).
 *
 * `emrFetch` is the drop-in `fetch` replacement: it re-validates the URL
 * immediately before the request (DNS rebinding window) and sets
 * `redirect: "error"` so a redirect to an internal target cannot bypass
 * the guard.
 */

import { TRPCError } from "@trpc/server";
import { assertWebhookUrlSafe } from "./webhook-url-guard";

const LABEL = "EMR URL";

/**
 * Validate an EMR base/endpoint URL. Throws TRPCError(BAD_REQUEST) unless
 * the URL is http(s) (https-only in production) and resolves exclusively to
 * public IP addresses.
 */
export async function assertEmrUrlSafe(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${LABEL} is not a valid URL` });
  }
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${LABEL} must use https in production` });
  }
  await assertWebhookUrlSafe(rawUrl, LABEL);
}

/**
 * Guarded fetch for EMR endpoints. Re-resolves and re-validates the URL at
 * fetch time, and refuses to follow redirects (a 3xx to an internal address
 * would otherwise bypass validation). Callers keep control of method,
 * headers, body, and AbortSignal via `init`.
 */
export async function emrFetch(rawUrl: string, init: RequestInit = {}): Promise<Response> {
  await assertEmrUrlSafe(rawUrl);
  return fetch(rawUrl, { ...init, redirect: "error" });
}
