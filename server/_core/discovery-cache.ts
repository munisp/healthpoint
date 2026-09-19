/**
 * server/_core/discovery-cache.ts
 * OIDC discovery document cache for Keycloak (openid-client).
 *
 * client.discovery() hits the IdP on every call; a transient IdP blip during
 * login previously hard-failed the flow. This module caches the resulting
 * Configuration per issuer with a 10-minute TTL and, on refresh failure,
 * serves the stale entry for up to 1 hour with a warning log.
 *
 * JWKS caching is already handled inside openid-client's Configuration
 * (its remote JWKS fetch caches by default); caching the Configuration
 * object preserves that behavior.
 *
 * Kept as a separate module per wave-ownership rules: keycloak.ts only gets
 * a minimal one-line substitution per discovery call.
 */

import * as client from "openid-client";

const DISCOVERY_TTL_MS = 10 * 60 * 1000;   // 10 min fresh
const DISCOVERY_STALE_MS = 60 * 60 * 1000; // serve stale up to 1h

interface CacheEntry {
  config: client.Configuration;
  fetchedAt: number;
}

const _cache = new Map<string, CacheEntry>();

/** Test hook: clear the cache between tests. */
export function _clearDiscoveryCache(): void {
  _cache.clear();
}

/**
 * Discover (or return cached) OIDC configuration for an issuer.
 * - Fresh (<10min): return cached without a network call.
 * - Stale (>=10min): attempt refresh; on failure serve stale up to 1h.
 * - No cache: propagate the discovery error (fail as before).
 */
export async function discoverCached(
  issuerUrl: URL,
  clientId: string,
  clientSecret: string,
): Promise<client.Configuration> {
  const key = `${issuerUrl.href}|${clientId}`;
  const now = Date.now();
  const entry = _cache.get(key);

  if (entry && now - entry.fetchedAt < DISCOVERY_TTL_MS) {
    return entry.config;
  }

  try {
    const config = await client.discovery(issuerUrl, clientId, clientSecret);
    _cache.set(key, { config, fetchedAt: now });
    return config;
  } catch (err) {
    if (entry && now - entry.fetchedAt < DISCOVERY_STALE_MS) {
      console.warn(
        `[Keycloak] OIDC discovery refresh failed for ${issuerUrl.href}; ` +
        `serving stale discovery document (age ${Math.round((now - entry.fetchedAt) / 1000)}s, max 3600s):`,
        (err as Error)?.message ?? err,
      );
      return entry.config;
    }
    throw err;
  }
}
