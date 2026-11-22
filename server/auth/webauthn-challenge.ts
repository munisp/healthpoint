/**
 * server/auth/webauthn-challenge.ts
 *
 * Phase 25: WebAuthn ceremony challenge storage + per-procedure rate limits.
 *
 * Challenges (design §4.1):
 *  - Stored via sessionSet at session:webauthn-chal:<ceremonyId> with TTL
 *    WEBAUTHN_CHALLENGE_TTL_SECONDS (default 300 — matches the 5-minute
 *    mfa-pending window, server/_core/keycloak.ts).
 *  - Consumed with a single atomic GETDEL (ioredis getdel, Redis >= 6.2) —
 *    NOT get-then-delete; single-use must hold under concurrent replay.
 *  - Redis-down behavior: FAIL-CLOSED in production (consistent with
 *    ratelimit.ts and isTokenRevoked). Outside production the module
 *    degrades to a process-local Map — the same development-only fallback
 *    convention as the PKCE shadow store in server/_core/keycloak.ts —
 *    so local dev, unit tests and the journey runner (no Redis in the
 *    sandbox) can complete ceremonies. The Map path is single-process and
 *    NEVER used in production.
 *
 * Rate limits (design §7.1): INCR+EXPIRE fixed windows on
 * ratelimit:webauthn:* keys (totpLockout.ts redisIncrement pattern);
 * null = backend unavailable → fail-closed in production, warn-and-allow
 * outside (ratelimit.ts convention).
 */
import { TRPCError } from "@trpc/server";
import { getRedisClient, sessionSet } from "../redis";
import { ENV } from "../_core/env";

export interface StoredChallenge {
  challenge: string;
  /** Bound user for mfa-mode ceremonies; null for discoverable mode. */
  userId: string | null;
  mode: "mfa" | "discoverable" | "registration";
}

const keyFor = (ceremonyId: string) => `webauthn-chal:${ceremonyId}`;

// ── Development-only in-memory fallback (never in production) ───────────────
const memStore = new Map<string, { value: string; expiresAt: number }>();
let memWarned = false;

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

function memSet(key: string, value: string, ttlSeconds: number): void {
  if (!memWarned) {
    memWarned = true;
    console.warn("[webauthn] Redis unavailable — using the development-only in-memory challenge store (single process; never used in production)");
  }
  memStore.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

function memGetdel(key: string): string | null {
  const entry = memStore.get(key);
  memStore.delete(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) return null;
  return entry.value;
}

/** Store a ceremony challenge. Throws (fail-closed) when Redis is down in production. */
export async function storeChallenge(ceremonyId: string, value: StoredChallenge): Promise<void> {
  if (!getRedisClient()) {
    if (isProd()) {
      console.error("[webauthn] Redis unavailable in production — failing closed (challenge store)");
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "webauthn_backend_unavailable" });
    }
    memSet(keyFor(ceremonyId), JSON.stringify(value), ENV.webauthnChallengeTtlSeconds);
    return;
  }
  await sessionSet(keyFor(ceremonyId), JSON.stringify(value), ENV.webauthnChallengeTtlSeconds);
}

/** Test seam: injectable GETDEL (same convention as ratelimit.ts IncrementFn). */
export type GetdelFn = (key: string) => Promise<string | null>;

const redisGetdel: GetdelFn = async (key) => {
  const client = getRedisClient();
  if (!client) {
    // Production: null → caller rejects (fail-closed). Else dev Map fallback.
    return isProd() ? null : memGetdel(key);
  }
  try {
    return await client.getdel(`session:${key}`);
  } catch (err) {
    console.warn("[webauthn] challenge GETDEL error:", err);
    return null;
  }
};

/**
 * Atomically consume a ceremony challenge (single-use). Returns null when
 * missing/expired OR when the backend is unavailable — in production the
 * caller maps null to UNAUTHORIZED (fail-closed: an unusable challenge
 * store can never validate a ceremony, so every verify fails).
 */
export async function consumeChallenge(
  ceremonyId: string,
  getdel: GetdelFn = redisGetdel,
): Promise<StoredChallenge | null> {
  const raw = await getdel(keyFor(ceremonyId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredChallenge;
  } catch {
    return null;
  }
}

/**
 * Test seam (non-production only — journeys and integration tests plant the
 * committed fixture's challenge into a live ceremony). Throws in production.
 */
export async function replaceChallengeForTests(ceremonyId: string, value: StoredChallenge): Promise<void> {
  if (isProd()) throw new Error("replaceChallengeForTests is unavailable in production");
  if (!getRedisClient()) {
    memSet(keyFor(ceremonyId), JSON.stringify(value), ENV.webauthnChallengeTtlSeconds);
    return;
  }
  await sessionSet(keyFor(ceremonyId), JSON.stringify(value), ENV.webauthnChallengeTtlSeconds);
}

// ── Step-up markers (§3.6: passkey-only deleteCredential proof) ─────────────

/**
 * Record a completed mfa-mode ceremony as a step-up proof for `userId`
 * (TTL 600). In production Redis is guaranteed present (challenge storage
 * would have failed closed earlier), so a missing client outside production
 * uses the same dev Map fallback.
 */
export async function storeStepupMarker(userId: string, ceremonyId: string, ttlSeconds: number): Promise<void> {
  if (!getRedisClient()) {
    if (isProd()) {
      console.error("[webauthn] Redis unavailable in production — step-up marker not recorded (fail-closed)");
      return;
    }
    memSet(`webauthn-stepup:${userId}`, ceremonyId, ttlSeconds);
    return;
  }
  await sessionSet(`webauthn-stepup:${userId}`, ceremonyId, ttlSeconds);
}

/** Consume a step-up marker (single-use). Returns the ceremonyId or null. */
export async function consumeStepupMarker(userId: string): Promise<string | null> {
  const client = getRedisClient();
  if (!client) return isProd() ? null : memGetdel(`webauthn-stepup:${userId}`);
  try {
    return await client.getdel(`session:webauthn-stepup:${userId}`);
  } catch (err) {
    console.warn("[webauthn] step-up GETDEL error:", err);
    return null;
  }
}

// ── Rate limits (design §7.1) ────────────────────────────────────────────────

/** Same shape as server/auth/ratelimit.ts's IncrementFn: null = backend unavailable. */
export type IncrementFn = (key: string, windowSeconds: number) => Promise<number | null>;

const redisIncrement: IncrementFn = async (key, windowSeconds) => {
  const client = getRedisClient();
  if (!client) return null;
  try {
    const fullKey = `ratelimit:${key}`;
    const count = await client.incr(fullKey);
    if (count === 1) {
      await client.expire(fullKey, windowSeconds);
    }
    return count;
  } catch (err) {
    console.warn("[webauthn] rate-limit increment error:", err);
    return null;
  }
};

/**
 * Fixed-window rate limit for webauthn procedures. Exceeding →
 * TOO_MANY_REQUESTS with a generic body (the per-IP options limit is the
 * credential-enumeration control — no detail leaks). Backend unavailable →
 * fail-closed in production, warn-and-allow outside.
 */
export async function webauthnRateLimit(
  bucket: string,
  max: number,
  windowSeconds: number,
  increment: IncrementFn = redisIncrement,
): Promise<void> {
  const count = await increment(`webauthn:${bucket}`, windowSeconds);
  if (count === null) {
    if (isProd()) {
      console.error(`[webauthn] rate-limit backend unavailable in production — failing closed (${bucket})`);
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "rate_limited" });
    }
    console.warn(`[webauthn] rate-limit backend unavailable — allowing (${bucket})`);
    return;
  }
  if (count > max) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "rate_limited" });
  }
}

/** Client IP for per-IP limits (x-forwarded-for first, trpc.ts precedent). */
export function clientIpOf(req: unknown): string {
  const headers = ((req as { headers?: Record<string, unknown> })?.headers ?? {}) as Record<string, unknown>;
  const fwd = headers["x-forwarded-for"];
  const first = (Array.isArray(fwd) ? fwd[0] : (fwd as string | undefined))?.split(",")[0]?.trim();
  return first || (req as { ip?: string })?.ip || "unknown";
}
