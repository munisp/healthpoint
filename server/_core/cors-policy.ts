/**
 * CORS origin policy.
 *
 * - No Origin header (curl, server-to-server, mobile apps): allowed.
 * - Development: every origin is allowed.
 * - Production: the configured origins (VITE_APP_URL + ALLOWED_ORIGINS), exact
 *   match only, plus the app's OWN origin — an Origin whose host equals the
 *   request's Host. Browsers send Origin on same-origin module-script and
 *   fetch requests, so without this the app rejected its own page assets
 *   whenever the public domain was not also listed in ALLOWED_ORIGINS.
 *
 * Anything else is denied; the caller answers 403 instead of throwing, so a
 * disallowed origin is never reported as a server error (500).
 */
export interface CorsRequestInfo {
  origin: string | undefined;
  host: string | undefined;
}

export function isOriginAllowed(
  req: CorsRequestInfo,
  opts: { isProduction: boolean; configuredOrigins: readonly string[] },
): boolean {
  const { origin, host } = req;
  if (!origin) return true;
  if (!opts.isProduction) return true;
  // Exact match only — prefix matching would admit evil-suffix origins such
  // as https://app.example.com.evil.tld.
  if (opts.configuredOrigins.includes(origin)) return true;
  return isSameOrigin(origin, host);
}

function isSameOrigin(origin: string, host: string | undefined): boolean {
  if (!host) return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  return parsed.host.toLowerCase() === host.toLowerCase();
}
