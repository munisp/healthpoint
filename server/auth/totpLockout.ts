/**
 * server/auth/totpLockout.ts
 *
 * Phase 24 (F2 / identity+api audit §3): per-user attempt lockout for the
 * TOTP second stage of login (`auth.verifyLoginTotp`). The email-OTP path
 * already caps guesses at 5 attempts per code via a Redis counter
 * (server/auth/emailOtp.ts:25,63-64); the TOTP path had no equivalent, so
 * an mfa-pending session could brute-force the 6-digit code unbounded
 * (only the fail-open 300/min/IP API limiter stood in the way).
 *
 * Policy (mirrors the email-OTP asymmetry exactly):
 *   - the attempt counter is incremented BEFORE the code is checked, so
 *     wrong guesses are capped regardless of outcome;
 *   - the 6th attempt within the 15-minute window (i.e. after 5 failures)
 *     is rejected as "locked" — even a correct code is refused;
 *   - a successful verification resets the counter.
 *
 * Failure mode (mirrors server/auth/ratelimit.ts): fail-CLOSED in
 * production — when Redis is unavailable the attempt is reported as locked
 * rather than allowed; outside production the check degrades to allow with
 * a warning, matching server/redis.ts's graceful-degradation convention.
 */

import { getRedisClient } from "../redis";

export const TOTP_MAX_ATTEMPTS = 5;
export const TOTP_LOCKOUT_WINDOW_SECONDS = 15 * 60; // 15 minutes

const keyFor = (userId: string) => `totp-login-attempts:${userId}`;

/** Same shape as server/auth/ratelimit.ts's IncrementFn: null = backend unavailable. */
export type TotpIncrementFn = (key: string, windowSeconds: number) => Promise<number | null>;

const redisIncrement: TotpIncrementFn = async (key, windowSeconds) => {
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
    console.warn("[totpLockout] Redis increment error:", err);
    return null;
  }
};

export type TotpAttemptGate = "ok" | "locked";

/**
 * Record one TOTP verify attempt for `userId` and report whether it may
 * proceed to code verification. Call BEFORE checking the code; on "locked"
 * the caller must reject the attempt without verifying.
 *
 * Test seam (repo convention, cf. ratelimit.ts): `increment` injects a
 * counter backend so tests need no live Redis.
 */
export async function checkTotpLoginAttempt(
  userId: string,
  increment: TotpIncrementFn = redisIncrement,
): Promise<TotpAttemptGate> {
  const count = await increment(keyFor(userId), TOTP_LOCKOUT_WINDOW_SECONDS);
  if (count === null) {
    if (process.env.NODE_ENV === "production") {
      console.error("[totpLockout] backend unavailable in production — failing closed (locked)");
      return "locked";
    }
    console.warn("[totpLockout] backend unavailable — allowing attempt (fail-open outside production)");
    return "ok";
  }
  return count > TOTP_MAX_ATTEMPTS ? "locked" : "ok";
}

/** Reset the attempt counter after a successful verification. */
export async function resetTotpLoginAttempts(userId: string): Promise<void> {
  const client = getRedisClient();
  if (!client) return;
  try {
    await client.del(`ratelimit:${keyFor(userId)}`);
  } catch (err) {
    console.warn("[totpLockout] reset error:", err);
  }
}
