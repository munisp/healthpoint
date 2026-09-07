/**
 * server/auth/bearer.ts
 *
 * Keycloak RS256 Bearer-token verification for API clients (the Expo mobile
 * app and headless API consumers) that authenticate via OIDC instead of the
 * web session cookie.
 *
 * Configuration (see .env.example):
 *   KEYCLOAK_URL / KEYCLOAK_REALM — used to derive the issuer
 *     (`${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}`) and the JWKS URI
 *     (`${issuer}/protocol/openid-connect/certs`).
 *   KEYCLOAK_ISSUER              — optional full issuer override (e.g. when the
 *     realm is fronted by a gateway with a different public URL).
 *   KEYCLOAK_JWKS_URI            — optional full JWKS URI override.
 *   KEYCLOAK_BEARER_AUDIENCES    — comma-separated accepted audiences/azp values.
 *     Defaults to KEYCLOAK_CLIENT_ID plus the realm's public clients
 *     (healthpoint-app, healthpoint-frontend, healthpoint-backend).
 *   BEARER_CLOCK_TOLERANCE_SECONDS — iss/exp leeway, default 60.
 *   KEYCLOAK_JWKS_CACHE_TTL_MS   — JWKS cache TTL, default 300000 (5 min).
 *
 * Security model: every failure (missing header, bad signature, wrong issuer,
 * wrong audience, expired token, unreachable JWKS) throws BearerAuthError and
 * the caller responds 401. There is NO fall-through to session-cookie auth
 * when a Bearer header is present.
 */

import { createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTPayload, JWTVerifyGetKey } from "jose";
import type { NextFunction, Request, Response } from "express";
import type { User } from "../../drizzle/schema";

export class BearerAuthError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`Bearer authentication failed: ${reason}`);
    this.name = "BearerAuthError";
    this.reason = reason;
  }
}

// ── Configuration ────────────────────────────────────────────────────────────

const DEFAULT_AUDIENCES = ["healthpoint-app", "healthpoint-frontend", "healthpoint-backend"];
const DEFAULT_CLOCK_TOLERANCE_SECONDS = 60;
const DEFAULT_JWKS_CACHE_TTL_MS = 300_000;

export interface BearerAuthConfig {
  issuer: string;
  jwksUri: string;
  audiences: string[];
  clockToleranceSeconds: number;
  jwksCacheTtlMs: number;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Resolve bearer verification config from the environment. Returns null when
 * Keycloak is not configured at all — every bearer request then fails closed
 * with 401 (a production deployment without an IdP must not silently accept
 * tokens).
 */
export function getBearerAuthConfig(): BearerAuthConfig | null {
  const issuerOverride = process.env.KEYCLOAK_ISSUER?.trim();
  const keycloakUrl = process.env.KEYCLOAK_URL?.trim();
  const realm = process.env.KEYCLOAK_REALM?.trim() || "healthpoint";
  const issuer = issuerOverride
    ? stripTrailingSlash(issuerOverride)
    : keycloakUrl
      ? `${stripTrailingSlash(keycloakUrl)}/realms/${realm}`
      : null;
  if (!issuer) return null;

  const jwksUri = process.env.KEYCLOAK_JWKS_URI?.trim() || `${issuer}/protocol/openid-connect/certs`;
  const configured = (process.env.KEYCLOAK_BEARER_AUDIENCES ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  const clientId = process.env.KEYCLOAK_CLIENT_ID?.trim();
  const audiences = configured.length
    ? Array.from(new Set(configured))
    : Array.from(new Set([clientId, ...DEFAULT_AUDIENCES].filter((v): v is string => Boolean(v))));

  return {
    issuer,
    jwksUri,
    audiences,
    clockToleranceSeconds: envInt("BEARER_CLOCK_TOLERANCE_SECONDS", DEFAULT_CLOCK_TOLERANCE_SECONDS),
    jwksCacheTtlMs: envInt("KEYCLOAK_JWKS_CACHE_TTL_MS", DEFAULT_JWKS_CACHE_TTL_MS),
  };
}

// ── JWKS caching ─────────────────────────────────────────────────────────────
// jose's createRemoteJWKSet caches keys in-process (cacheMaxAge) and re-fetches
// on unknown `kid` after a cooldown. One entry per JWKS URI; process lifetime.
const jwksCache = new Map<string, JWTVerifyGetKey>();

function getJwks(config: BearerAuthConfig): JWTVerifyGetKey {
  const cached = jwksCache.get(config.jwksUri);
  if (cached) return cached;
  const jwks = createRemoteJWKSet(new URL(config.jwksUri), {
    cacheMaxAge: config.jwksCacheTtlMs,
    cooldownDuration: 30_000,
  });
  jwksCache.set(config.jwksUri, jwks);
  return jwks;
}

/** Test hook: drop cached JWKS verifiers so a new issuer/keys can be served. */
export function resetJwksCacheForTests(): void {
  jwksCache.clear();
}

// ── Claim mapping ────────────────────────────────────────────────────────────

/**
 * The principal shape produced from a Keycloak access token. `sub` maps to
 * users.id and `isAdmin` maps the realm "admin" role onto the same
 * "user" | "admin" role the session-cookie path uses, so downstream authz
 * (server/authz.ts) behaves identically for Bearer and session auth.
 */
export interface BearerPrincipal {
  sub: string;
  name: string;
  email: string;
  realmRoles: string[];
  isAdmin: boolean;
}

export function bearerClaimsToPrincipal(payload: JWTPayload): BearerPrincipal | null {
  if (typeof payload.sub !== "string" || payload.sub.length === 0) return null;
  const realmAccess = payload["realm_access"] as { roles?: unknown } | undefined;
  const roles = Array.isArray(realmAccess?.roles)
    ? (realmAccess.roles as unknown[]).filter((r): r is string => typeof r === "string")
    : [];
  const name =
    typeof payload["name"] === "string" && (payload["name"] as string)
      ? (payload["name"] as string)
      : typeof payload["preferred_username"] === "string"
        ? (payload["preferred_username"] as string)
        : "";
  const email = typeof payload["email"] === "string" ? (payload["email"] as string) : "";
  return { sub: payload.sub, name, email, realmRoles: roles, isAdmin: roles.includes("admin") };
}

function audienceAllowed(payload: JWTPayload, audiences: string[]): boolean {
  const aud = payload.aud;
  const audValues = Array.isArray(aud) ? aud : typeof aud === "string" ? [aud] : [];
  if (audValues.some(v => audiences.includes(v))) return true;
  // Keycloak access tokens for public clients commonly carry aud=["account"]
  // only; the authorized party (azp) then identifies the client.
  const azp = payload["azp"];
  return typeof azp === "string" && audiences.includes(azp);
}

// ── Token verification ───────────────────────────────────────────────────────

/**
 * Verify a Keycloak RS256 access token against the realm JWKS and map it to a
 * principal. Throws BearerAuthError on any failure.
 */
export async function verifyBearerToken(
  token: string,
  configOverride?: BearerAuthConfig
): Promise<BearerPrincipal> {
  const config = configOverride ?? getBearerAuthConfig();
  if (!config) {
    throw new BearerAuthError("Keycloak bearer verification is not configured (set KEYCLOAK_URL or KEYCLOAK_ISSUER)");
  }

  let payload: JWTPayload;
  try {
    const verified = await jwtVerify(token, getJwks(config), {
      algorithms: ["RS256"],
      issuer: config.issuer,
      clockTolerance: config.clockToleranceSeconds,
    });
    payload = verified.payload;
  } catch {
    // Do not leak which check failed (signature vs issuer vs expiry).
    throw new BearerAuthError("token signature, issuer, or expiry validation failed");
  }

  if (!audienceAllowed(payload, config.audiences)) {
    throw new BearerAuthError("token audience is not accepted");
  }

  const principal = bearerClaimsToPrincipal(payload);
  if (!principal) throw new BearerAuthError("token is missing the required subject claim");
  return principal;
}

// ── Request helpers ──────────────────────────────────────────────────────────

export function hasBearerToken(req: Request): boolean {
  return /^Bearer\s+\S+/i.test(req.headers.authorization ?? "");
}

function extractBearerToken(req: Request): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec((req.headers.authorization ?? "").trim());
  return match ? match[1] : null;
}

/**
 * Authenticate a request carrying a Keycloak Bearer access token and resolve
 * it to the same `User` row the session path returns. Unknown users are
 * provisioned (mirroring the session login flow); existing users keep their
 * database role — the DB remains the source of truth for role changes.
 */
export async function authenticateBearerRequest(req: Request): Promise<User> {
  const token = extractBearerToken(req);
  if (!token) throw new BearerAuthError("missing or malformed Authorization header");

  const principal = await verifyBearerToken(token);

  const db = await import("../db");
  let user = await db.getUser(principal.sub);
  if (!user) {
    await db.upsertUser({
      id: principal.sub,
      name: principal.name || null,
      email: principal.email || null,
      loginMethod: "keycloak-bearer",
      role: principal.isAdmin ? "admin" : "user",
      lastSignedIn: new Date(),
    });
    user = await db.getUser(principal.sub);
  }
  if (!user) throw new BearerAuthError("user provisioning failed");

  await db.upsertUser({ id: user.id, lastSignedIn: new Date() });
  return user;
}

/**
 * Authenticate an API request via Bearer token when present, else via the
 * session cookie. When a Bearer header IS present, any verification failure
 * throws — there is intentionally no fall-through to the session cookie.
 */
export async function authenticateApiRequest(req: Request): Promise<User> {
  if (hasBearerToken(req)) return authenticateBearerRequest(req);
  const { authenticateRequest } = await import("../_core/keycloak");
  return authenticateRequest(req);
}

// ── Express middleware (non-tRPC API routes) ────────────────────────────────

/**
 * Require an authenticated user (Bearer token or session cookie) on an
 * Express route. Attaches the user as `req.user`. 401 on any failure.
 */
export function requireApiAuth() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await authenticateApiRequest(req);
      (req as unknown as { user: User }).user = user;
      next();
    } catch {
      res.status(401).json({ error: "Authentication required" });
    }
  };
}

/**
 * Require an authenticated ADMIN user (Bearer token or session cookie).
 * 401 unauthenticated, 403 authenticated but not admin.
 */
export function requireApiAdmin() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await authenticateApiRequest(req);
      if (user.role !== "admin") {
        res.status(403).json({ error: "Admin role required" });
        return;
      }
      (req as unknown as { user: User }).user = user;
      next();
    } catch {
      res.status(401).json({ error: "Authentication required" });
    }
  };
}
