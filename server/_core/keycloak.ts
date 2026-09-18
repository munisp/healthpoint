/**
 * Keycloak OIDC Authentication Module
 *
 * Replaces Manus OAuth with standard Keycloak OIDC (Authorization Code Flow + PKCE).
 *
 * Environment variables required (set via webdev secrets):
 *   KEYCLOAK_URL          — Base URL of your Keycloak server, e.g. https://auth.yourorg.com
 *   KEYCLOAK_REALM        — Realm name, e.g. healthpoint
 *   KEYCLOAK_CLIENT_ID    — Client ID configured in Keycloak, e.g. healthpoint-app
 *   KEYCLOAK_CLIENT_SECRET— Client secret (for confidential clients)
 *   JWT_SECRET            — Used to sign internal session cookies (unchanged)
 *
 * Flow:
 *   GET /api/auth/login          → redirects to Keycloak authorization endpoint
 *   GET /api/auth/callback       → exchanges code for tokens, creates session cookie
 *   GET /api/auth/logout         → clears session cookie, redirects to Keycloak logout
 *   GET /api/auth/register       → redirects to Keycloak registration page
 */

import type { Express, Request, Response } from "express";
import * as client from "openid-client";
import { discoverCached } from "./discovery-cache";
import { COOKIE_NAME, ONE_YEAR_MS, SESSION_DURATION_MS } from "@shared/const";
import * as db from "../db";
import { ENV } from "./env";
import { SignJWT, jwtVerify } from "jose";
import { parse as parseCookieHeader } from "cookie";
import type { User } from "../../drizzle/schema";
import { ForbiddenError } from "@shared/_core/errors";

// ─── PKCE state store backed by Redis (falls back to in-memory) ─────────────
import { cacheGet, cacheSet, cacheDel } from "../redis";

const _memPkceStore = new Map<string, { codeVerifier: string; redirectTo: string }>();

async function pkceSet(state: string, data: { codeVerifier: string; redirectTo: string }): Promise<void> {
  await cacheSet(`pkce:${state}`, data, 600); // 10 min TTL
  _memPkceStore.set(state, data);
  setTimeout(() => _memPkceStore.delete(state), 10 * 60 * 1000);
}

async function pkceGet(state: string): Promise<{ codeVerifier: string; redirectTo: string } | null> {
  const cached = await cacheGet<{ codeVerifier: string; redirectTo: string }>(`pkce:${state}`);
  if (cached) return cached;
  return _memPkceStore.get(state) ?? null;
}

async function pkceDelete(state: string): Promise<void> {
  await cacheDel(`pkce:${state}`);
  _memPkceStore.delete(state);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getKeycloakConfig() {
  // Fail closed in production: placeholder IdP configuration must never be
  // used there. Missing values surface as login-flow failures (redirect to
  // /?auth_error=...), never as a silently-working placeholder.
  const production = ENV.isProduction;
  return {
    url: ENV.keycloakUrl || (production ? "" : "https://auth.placeholder.example.com"),
    realm: ENV.keycloakRealm || "healthpoint",
    clientId: ENV.keycloakClientId || "healthpoint-app",
    // The web client (healthpoint-app) is a public client; an empty secret is
    // correct there. A fake placeholder secret must never leave development.
    clientSecret: ENV.keycloakClientSecret || (production ? "" : "placeholder-secret"),
  };
}

function getIssuerUrl(): string {
  const { url, realm } = getKeycloakConfig();
  return `${url}/realms/${realm}`;
}

function getCallbackUrl(req: Request): string {
  const proto = req.get("x-forwarded-proto") || req.protocol;
  const host = req.get("x-forwarded-host") || req.get("host");
  return `${proto}://${host}/api/auth/callback`;
}

function getSessionSecret(): Uint8Array {
  // Defense in depth: production must never sign or verify session cookies
  // with the development placeholder secret (validateEnv in _core/index.ts
  // already enforces JWT_SECRET at startup).
  if (ENV.isProduction && !ENV.cookieSecret) {
    throw new Error("JWT_SECRET is required in production");
  }
  return new TextEncoder().encode(ENV.cookieSecret || "placeholder-jwt-secret-change-me");
}

// ─── Session JWT (internal, not Keycloak token) ───────────────────────────────

export const MFA_PENDING_DURATION_MS = 1000 * 60 * 5; // 5 minutes

/**
 * Per-user session duration: orgSettings.sessionTimeoutMinutes overrides the
 * global SESSION_DURATION_MS when set (clamped to [5, 720] minutes). Missing
 * settings row / DB errors fall back to the global default (fail-safe for
 * login availability; the global default is the hardened 8h value).
 */
export async function getSessionDurationMsForUser(userId: string): Promise<number> {
  try {
    const { getDb } = await import("../db");
    const { orgSettings } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return SESSION_DURATION_MS;
    const rows = await db.select({ m: orgSettings.sessionTimeoutMinutes }).from(orgSettings).where(eq(orgSettings.userId, userId)).limit(1);
    const minutes = rows[0]?.m;
    if (typeof minutes === "number" && Number.isFinite(minutes)) {
      const clamped = Math.min(720, Math.max(5, minutes));
      return clamped * 60 * 1000;
    }
  } catch (err) {
    console.warn("[Keycloak] sessionTimeoutMinutes lookup failed, using default:", err instanceof Error ? err.message : err);
  }
  return SESSION_DURATION_MS;
}

export async function createSessionToken(userId: string, name: string, email: string, durationMs?: number): Promise<string> {
  const ttl = durationMs ?? SESSION_DURATION_MS;
  const expiresAt = Math.floor((Date.now() + ttl) / 1000);
  const jti = crypto.randomUUID();
  return new SignJWT({ sub: userId, name, email, type: "session", jti })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expiresAt)
    .setJti(jti)
    .sign(getSessionSecret());
}

/**
 * Short-lived (5 min) pre-MFA token. Scope: mfa-only — it may call the
 * TOTP login/setup procedures and nothing else (enforced in tRPC context:
 * protectedProcedure rejects mfa-pending sessions with 403 except an
 * explicit allow-list).
 */
export async function createMfaPendingToken(userId: string, name: string, email: string): Promise<string> {
  const expiresAt = Math.floor((Date.now() + MFA_PENDING_DURATION_MS) / 1000);
  const jti = crypto.randomUUID();
  return new SignJWT({ sub: userId, name, email, type: "mfa-pending", jti })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expiresAt)
    .setJti(jti)
    .sign(getSessionSecret());
}

/** Thrown by authenticateRequest when the session is a pre-MFA token. */
export class MfaPendingError extends Error {
  constructor() {
    super("mfa_required");
    this.name = "MfaPendingError";
  }
}

export async function verifySessionToken(token: string): Promise<{ sub: string; name: string; email: string; jti?: string; type?: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSessionSecret(), { algorithms: ["HS256"] });
    const { sub, name, email, jti, type } = payload as Record<string, unknown>;
    if (typeof sub !== "string" || !sub) return null;
    // Check Redis token revocation list (fails closed in production — see
    // server/redis.ts isTokenRevoked; do not regress).
    if (typeof jti === "string" && jti) {
      const { isTokenRevoked } = await import("../redis");
      const revoked = await isTokenRevoked(jti).catch(() => false);
      if (revoked) return null;
    }
    return { sub, name: String(name || ""), email: String(email || ""), jti: typeof jti === "string" ? jti : undefined, type: typeof type === "string" ? type : "session" };
  } catch {
    return null;
  }
}

/** Decode (unverified — caller must verify first) the exp claim, seconds. */
export function decodeSessionExp(token: string): number | null {
  try {
    const parts = token.split(".");
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

// ─── Authenticate incoming request (used by tRPC context) ────────────────────

/**
 * Resolve the session cookie to a user plus the token type. "mfa-pending"
 * sessions resolve the user normally — the caller (tRPC context) is
 * responsible for restricting what an mfa-pending principal may do.
 */
export async function resolveSession(req: Request): Promise<{ user: User; type: string }> {
  const cookies = parseCookieHeader(req.headers.cookie || "");
  const sessionCookie = cookies[COOKIE_NAME];
  const session = await verifySessionToken(sessionCookie);

  if (!session) {
    throw ForbiddenError("Invalid or missing session cookie");
  }

  let user = await db.getUser(session.sub);
  if (!user) {
    // Auto-provision user from session data
    await db.upsertUser({
      id: session.sub,
      name: session.name || null,
      email: session.email || null,
      loginMethod: "keycloak",
      lastSignedIn: new Date(),
    });
    user = await db.getUser(session.sub);
  }

  if (!user) throw ForbiddenError("User not found");

  assertNotSuspended(user);

  await db.upsertUser({ id: user.id, lastSignedIn: new Date() });
  return { user, type: session.type ?? "session" };
}

export async function authenticateRequest(req: Request): Promise<User> {
  const { user, type } = await resolveSession(req);
  if (type === "mfa-pending") {
    // Full API access is denied to pre-MFA sessions. The tRPC context uses
    // resolveSession directly to expose a restricted principal instead.
    throw new MfaPendingError();
  }
  return user;
}

/**
 * X2: enforce administrative suspension on every authenticated request.
 * A user with suspendedAt set is rejected while the suspension is active —
 * either indefinitely (no suspendedUntil) or until suspendedUntil passes.
 */
export function assertNotSuspended(user: User): void {
  if (!user.suspendedAt) return;
  const now = Date.now();
  if (!user.suspendedUntil || new Date(user.suspendedUntil).getTime() > now) {
    throw ForbiddenError("account_suspended");
  }
}

// ─── Express route registration ───────────────────────────────────────────────

export function registerKeycloakRoutes(app: Express) {
  const kc = getKeycloakConfig();

  // GET /api/auth/login — initiate OIDC Authorization Code + PKCE flow
  app.get("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const redirectTo = (req.query.redirectTo as string) || "/";
      const issuerUrl = new URL(getIssuerUrl());
      const config = await discoverCached(issuerUrl, kc.clientId, kc.clientSecret);

      const codeVerifier = client.randomPKCECodeVerifier();
      const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
      const state = client.randomState();

      // Store PKCE verifier keyed by state (Redis + in-memory fallback)
      await pkceSet(state, { codeVerifier, redirectTo });

      const callbackUrl = getCallbackUrl(req);
      const authUrl = client.buildAuthorizationUrl(config, {
        redirect_uri: callbackUrl,
        scope: "openid email profile",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      });

      res.redirect(302, authUrl.href);
    } catch (error) {
      console.error("[Keycloak] Login initiation failed:", error);
      res.redirect(302, "/?auth_error=login_failed");
    }
  });

  // GET /api/auth/register — redirect to Keycloak registration page
  app.get("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const redirectTo = (req.query.redirectTo as string) || "/";
      const role = (req.query.role as string) || "";
      const issuerUrl = new URL(getIssuerUrl());
      const config = await discoverCached(issuerUrl, kc.clientId, kc.clientSecret);

      const codeVerifier = client.randomPKCECodeVerifier();
      const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
      const state = client.randomState();

      await pkceSet(state, { codeVerifier, redirectTo: `${redirectTo}?role=${role}` });

      const callbackUrl = getCallbackUrl(req);
      // Keycloak supports ?kc_action=register to go directly to registration
      const authUrl = client.buildAuthorizationUrl(config, {
        redirect_uri: callbackUrl,
        scope: "openid email profile",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      });
      // Append Keycloak-specific registration hint
      const registrationUrl = new URL(authUrl.href);
      registrationUrl.searchParams.set("kc_action", "register");

      res.redirect(302, registrationUrl.href);
    } catch (error) {
      console.error("[Keycloak] Registration redirect failed:", error);
      res.redirect(302, "/?auth_error=register_failed");
    }
  });

  // GET /api/auth/callback — exchange code for tokens, set session cookie
  app.get("/api/auth/callback", async (req: Request, res: Response) => {
    const state = req.query.state as string;
    const stored = await pkceGet(state);

    if (!stored) {
      console.error("[Keycloak] Unknown or expired state:", state);
      res.redirect(302, "/?auth_error=invalid_state");
      return;
    }

    await pkceDelete(state);

    try {
      const issuerUrl = new URL(getIssuerUrl());
      const config = await discoverCached(issuerUrl, kc.clientId, kc.clientSecret);
      const callbackUrl = getCallbackUrl(req);
      const currentUrl = new URL(`${callbackUrl.replace("/api/auth/callback", "")}${req.url}`);

      const tokens = await client.authorizationCodeGrant(config, currentUrl, {
        pkceCodeVerifier: stored.codeVerifier,
        expectedState: state,
      }, { redirect_uri: callbackUrl });

      const claims = tokens.claims();
      if (!claims || !claims.sub) {
        res.redirect(302, "/?auth_error=no_claims");
        return;
      }

      const userId = claims.sub;
      const name = (claims.name as string) || (claims.preferred_username as string) || "";
      const email = (claims.email as string) || "";

      // Detect new user before upserting (first login triggers onboarding)
      const existingUser = await db.getUser(userId);
      const isNewUser = !existingUser;

      // Upsert user in DB
      await db.upsertUser({
        id: userId,
        name: name || null,
        email: email || null,
        loginMethod: "keycloak",
        lastSignedIn: new Date(),
      });

      const isSecure = req.get("x-forwarded-proto") === "https" || req.protocol === "https";

      // Two-stage login: TOTP-enabled users (or orgs with requireMFA who have
      // not enrolled yet) get a short-lived mfa-pending token instead of a
      // full session. They must complete auth.verifyLoginTotp (or TOTP
      // enrollment) before any other protected procedure will run.
      const { getMfaRequirement } = await import("../auth/mfa");
      const mfaRequirement = isNewUser ? "none" : await getMfaRequirement(userId);
      if (mfaRequirement !== "none") {
        const mfaToken = await createMfaPendingToken(userId, name, email);
        res.cookie(COOKIE_NAME, mfaToken, {
          httpOnly: true,
          sameSite: "lax",
          secure: isSecure,
          maxAge: MFA_PENDING_DURATION_MS,
          path: "/",
        });
        res.redirect(302, mfaRequirement === "verify" ? "/mfa?mode=verify" : "/mfa?mode=enroll");
        return;
      }

      // Create internal session cookie (per-user orgSettings.sessionTimeoutMinutes
      // overrides the global default when configured)
      const durationMs = await getSessionDurationMsForUser(userId);
      const sessionToken = await createSessionToken(userId, name, email, durationMs);

      res.cookie(COOKIE_NAME, sessionToken, {
        httpOnly: true,
        sameSite: "lax",
        secure: isSecure,
        maxAge: durationMs,
        path: "/",
      });

      // First-time users go to onboarding; extract role from redirectTo if present
      if (isNewUser) {
        const redirectUrl = new URL(stored.redirectTo || "/", "http://localhost");
        const role = redirectUrl.searchParams.get("role") || "";
        const onboardingUrl = `/onboarding${role ? `?role=${encodeURIComponent(role)}` : ""}`;
        res.redirect(302, onboardingUrl);
      } else {
        res.redirect(302, stored.redirectTo || "/");
      }
    } catch (error) {
      console.error("[Keycloak] Callback failed:", error);
      res.redirect(302, "/?auth_error=callback_failed");
    }
  });

  // GET /api/auth/logout — clear session, redirect to Keycloak end-session
  app.get("/api/auth/logout", async (req: Request, res: Response) => {
    // Revoke the session token server-side (Redis blocklist) so a captured
    // cookie cannot be replayed after logout. Non-prod fails open when Redis
    // is unavailable (revocation is a no-op, documented in server/redis.ts);
    // production treats Redis loss as fail-closed at verify time.
    try {
      const cookies = parseCookieHeader(req.headers.cookie || "");
      const sessionCookie = cookies[COOKIE_NAME];
      if (sessionCookie) {
        const session = await verifySessionToken(sessionCookie).catch(() => null);
        if (session?.jti) {
          const exp = decodeSessionExp(sessionCookie);
          const ttl = exp ? Math.max(1, exp - Math.floor(Date.now() / 1000)) : Math.floor(SESSION_DURATION_MS / 1000);
          const { revokeToken } = await import("../redis");
          await revokeToken(session.jti, ttl);
        }
      }
    } catch (err) {
      console.warn("[Keycloak] logout token revocation failed:", err instanceof Error ? err.message : err);
    }
    res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: "lax", path: "/" });

    try {
      const issuerUrl = new URL(getIssuerUrl());
      const config = await discoverCached(issuerUrl, kc.clientId, kc.clientSecret);
      const proto = req.get("x-forwarded-proto") || req.protocol;
      const host = req.get("x-forwarded-host") || req.get("host");
      const postLogoutUri = `${proto}://${host}/`;

      const endSessionUrl = client.buildEndSessionUrl(config, {
        post_logout_redirect_uri: postLogoutUri,
      });

      res.redirect(302, endSessionUrl.href);
    } catch {
      // Fallback: just redirect home if end-session endpoint is unavailable
      res.redirect(302, "/");
    }
  });

  // GET /api/auth/session — returns session TTL info for the frontend expiry warning
  app.get("/api/auth/session", async (req: Request, res: Response) => {
    const cookies = req.cookies as Record<string, string>;
    const sessionCookie = cookies[COOKIE_NAME];
    if (!sessionCookie) {
      res.status(401).json({ authenticated: false });
      return;
    }
    const session = await verifySessionToken(sessionCookie).catch(() => null);
    if (!session) {
      res.status(401).json({ authenticated: false });
      return;
    }
    // Decode JWT payload to read exp without re-verifying (already verified above)
    let exp = 0;
    try {
      const parts = sessionCookie.split(".");
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
      exp = payload.exp as number;
    } catch {
      exp = Math.floor((Date.now() + SESSION_DURATION_MS) / 1000);
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const remainingMs = Math.max(0, (exp - nowSec) * 1000);
    res.json({
      authenticated: true,
      expiresAt: exp * 1000,   // ms epoch
      remainingMs,
      userId: session.sub,
    });
  });

  // GET /api/auth/refresh — silently re-issue a fresh session cookie if current one is valid
  app.get("/api/auth/refresh", async (req: Request, res: Response) => {
    const cookies = req.cookies as Record<string, string>;
    const sessionCookie = cookies[COOKIE_NAME];
    if (!sessionCookie) {
      res.status(401).json({ refreshed: false, reason: "no_session" });
      return;
    }
    const session = await verifySessionToken(sessionCookie).catch(() => null);
    if (!session) {
      res.status(401).json({ refreshed: false, reason: "invalid_session" });
      return;
    }
    if (session.type === "mfa-pending") {
      // Pre-MFA tokens are never upgraded by refresh — only by verifyLoginTotp.
      res.status(401).json({ refreshed: false, reason: "mfa_required" });
      return;
    }
    // Re-issue a fresh JWT (honoring per-user sessionTimeoutMinutes) — no
    // Keycloak round-trip needed for internal sessions
    const user = await db.getUser(session.sub).catch(() => null);
    const name = user?.name || session.name || "";
    const email = user?.email || session.email || "";
    const durationMs = await getSessionDurationMsForUser(session.sub);
    const newToken = await createSessionToken(session.sub, name, email, durationMs);
    // Rotation: revoke the OLD token's jti so the previous cookie is dead the
    // moment the new one is issued (reuse of the old cookie = 401).
    if (session.jti) {
      const oldExp = decodeSessionExp(sessionCookie);
      const ttl = oldExp ? Math.max(1, oldExp - Math.floor(Date.now() / 1000)) : Math.floor(durationMs / 1000);
      const { revokeToken } = await import("../redis");
      await revokeToken(session.jti, ttl).catch(err =>
        console.warn("[Keycloak] refresh revocation failed:", err instanceof Error ? err.message : err));
    }
    const isSecure = req.get("x-forwarded-proto") === "https" || req.protocol === "https";
    res.cookie(COOKIE_NAME, newToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: isSecure,
      maxAge: durationMs,
      path: "/",
    });
    const exp = Math.floor((Date.now() + durationMs) / 1000);
    res.json({
      refreshed: true,
      expiresAt: exp * 1000,
      remainingMs: durationMs,
    });
  });

  // Keep legacy /api/oauth/callback as a redirect alias for backwards compatibility
  app.get("/api/oauth/callback", (_req: Request, res: Response) => {
    res.redirect(302, "/api/auth/login");
  });
}
