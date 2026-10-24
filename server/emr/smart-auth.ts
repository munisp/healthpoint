/**
 * server/emr/smart-auth.ts
 *
 * Phase 17 (E2): SMART Backend Services OAuth2 client-credentials token
 * acquisition (UDAP-style private_key_jwt client assertion, RS384) per the
 * SMART App Launch Backend Services profile and HL7 FHIR Bulk Data Access:
 *
 *   1. (Optional) discover the token endpoint from
 *      GET {baseUrl}/.well-known/smart-configuration → token_endpoint.
 *   2. Build a one-time RS384 JWT client assertion:
 *        iss = sub = clientId, aud = token endpoint, exp ≤ 5 min, jti random.
 *   3. POST grant_type=client_credentials &
 *        client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer
 *      to the token endpoint with the requested system scope.
 *   4. Cache the access token in memory (keyed by connection id) until
 *      60 s before its `expires_in` deadline; per-connection persistence is
 *      delegated to the caller via encryptToken + smart_tokens (E2 wiring in
 *      the bulk worker reads whatever token row exists).
 *
 * HONESTY / FAIL-CLOSED:
 *  - Env gate: SMART_BACKEND_SERVICES_ENABLED must be exactly "true"; when
 *    unset the module refuses to attempt token acquisition (no silent
 *    fallbacks, no fabricated tokens).
 *  - Private keys are read from the connection's ENCRYPTED credentials blob
 *    (decryptCredentials) or from env vars named in .env.example — never
 *    logged, never returned to any client.
 *  - HTTP/token errors throw SmartAuthError with status/body snippet (body
 *    truncated; token values are never included).
 *
 * Labels: MOCK-VERIFIED (token endpoint + smart-configuration are mocked in
 * server/emr/smart-auth.test.ts; no live vendor sandbox has been tested).
 */

import { createSign, randomUUID } from "node:crypto";

export class SmartAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmartAuthError";
  }
}

/** Per-connection SMART Backend Services configuration (secrets in-memory only). */
export interface SmartBackendConfig {
  /** OAuth client_id registered with the EHR (also iss/sub of the assertion). */
  clientId: string;
  /** PEM-encoded RSA private key used to sign the client assertion (RS384). */
  privateKeyPem: string;
  /** JWK thumbprint/kid registered with the EHR (optional but common for Epic). */
  kid?: string;
  /** Explicit token endpoint; when absent, discovered via .well-known/smart-configuration. */
  tokenEndpoint?: string;
  /** OAuth scope; defaults to system-level read of clinical + financial resources. */
  scope?: string;
  /** FHIR base URL — used for token-endpoint discovery when tokenEndpoint absent. */
  baseUrl?: string;
}

export interface SmartToken {
  accessToken: string;
  tokenType: string;
  /** Absolute expiry (ms epoch); 60 s early-refresh margin already applied. */
  expiresAtMs: number;
  scope: string | null;
}

type FetchLike = typeof fetch;

const DEFAULT_SCOPE = "system/Patient.read system/Claim.read system/Coverage.read system/ExplanationOfBenefit.read system/Procedure.read system/Practitioner.read system/Organization.read";
const ASSERTION_TTL_S = 300; // 5 minutes (spec maximum)
const REFRESH_MARGIN_MS = 60_000;

// ─── In-memory token cache (per process) ────────────────────────────────────
const tokenCache = new Map<string, SmartToken>();

/** Test hook: clear the in-memory cache. */
export function __clearSmartTokenCache(): void {
  tokenCache.clear();
}

function requireEnabled(env: NodeJS.ProcessEnv): void {
  if ((env.SMART_BACKEND_SERVICES_ENABLED ?? "") !== "true") {
    throw new SmartAuthError(
      "SMART Backend Services auth is disabled. Set SMART_BACKEND_SERVICES_ENABLED=true and configure " +
      "per-connection SMART credentials (client id + RS384 private key) before attempting token acquisition."
    );
  }
}

/** Build the RS384 private_key_jwt client assertion. Exported for tests. */
export function buildClientAssertion(cfg: SmartBackendConfig, tokenEndpoint: string): string {
  const nowS = Math.floor(Date.now() / 1000);
  const header = { alg: "RS384", typ: "JWT", ...(cfg.kid ? { kid: cfg.kid } : {}) };
  const payload = {
    iss: cfg.clientId,
    sub: cfg.clientId,
    aud: tokenEndpoint,
    exp: nowS + ASSERTION_TTL_S,
    jti: randomUUID(),
  };
  const b64u = (o: unknown) => Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
  const signingInput = `${b64u(header)}.${b64u(payload)}`;
  const signer = createSign("RSA-SHA384");
  signer.update(signingInput);
  const signature = signer.sign({ key: cfg.privateKeyPem, padding: undefined }).toString("base64url");
  return `${signingInput}.${signature}`;
}

interface SmartConfiguration {
  token_endpoint?: string;
}

/** Resolve the token endpoint: explicit config wins; else SMART discovery. */
async function resolveTokenEndpoint(cfg: SmartBackendConfig, fetchFn: FetchLike): Promise<string> {
  if (cfg.tokenEndpoint) return cfg.tokenEndpoint;
  if (!cfg.baseUrl) {
    throw new SmartAuthError("No tokenEndpoint configured and no baseUrl available for .well-known/smart-configuration discovery.");
  }
  const url = `${cfg.baseUrl.replace(/\/$/, "")}/.well-known/smart-configuration`;
  const res = await fetchFn(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new SmartAuthError(`SMART configuration discovery failed: HTTP ${res.status} from ${url}`);
  const body = (await res.json()) as SmartConfiguration;
  if (!body.token_endpoint) throw new SmartAuthError(`.well-known/smart-configuration at ${url} did not advertise a token_endpoint.`);
  return body.token_endpoint;
}

interface TokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
}

/**
 * Acquire (or return a cached) SMART Backend Services access token.
 * `cacheKey` identifies the connection (e.g. emrConnections.id).
 */
export async function getSmartBackendToken(
  cacheKey: string,
  cfg: SmartBackendConfig,
  deps: { fetchFn?: FetchLike; env?: NodeJS.ProcessEnv } = {},
): Promise<SmartToken> {
  const env = deps.env ?? process.env;
  requireEnabled(env);
  const fetchFn = deps.fetchFn ?? fetch;

  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAtMs > Date.now()) return cached;

  const tokenEndpoint = await resolveTokenEndpoint(cfg, fetchFn);
  const assertion = buildClientAssertion(cfg, tokenEndpoint);
  const form = new URLSearchParams({
    grant_type: "client_credentials",
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: assertion,
    scope: cfg.scope ?? DEFAULT_SCOPE,
  });
  const res = await fetchFn(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: form.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) {
    // Never include the assertion; body snippet only (may contain an error description).
    throw new SmartAuthError(`Token endpoint returned HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  let parsed: TokenResponse;
  try {
    parsed = JSON.parse(text) as TokenResponse;
  } catch {
    throw new SmartAuthError("Token endpoint returned a non-JSON response.");
  }
  if (!parsed.access_token) throw new SmartAuthError("Token endpoint response contained no access_token.");
  const expiresInMs = (parsed.expires_in ?? 300) * 1000;
  const token: SmartToken = {
    accessToken: parsed.access_token,
    tokenType: parsed.token_type ?? "Bearer",
    expiresAtMs: Date.now() + Math.max(0, expiresInMs - REFRESH_MARGIN_MS),
    scope: parsed.scope ?? null,
  };
  tokenCache.set(cacheKey, token);
  return token;
}

/**
 * Load a SMART Backend Services config for an EMR connection from its
 * ENCRYPTED credentials blob (decryptCredentials shape). Expected keys:
 *   smartClientId, smartPrivateKeyPem, smartKid (opt), smartTokenEndpoint (opt),
 *   smartScope (opt).
 * Returns null when the connection has no SMART configuration (honest: the
 * caller must then fall back to unauthenticated access or fail).
 */
export function smartConfigFromCredentials(credentials: Record<string, string>, baseUrl?: string): SmartBackendConfig | null {
  const clientId = credentials.smartClientId;
  const privateKeyPem = credentials.smartPrivateKeyPem;
  if (!clientId || !privateKeyPem) return null;
  return {
    clientId,
    privateKeyPem,
    kid: credentials.smartKid || undefined,
    tokenEndpoint: credentials.smartTokenEndpoint || undefined,
    scope: credentials.smartScope || undefined,
    baseUrl,
  };
}
