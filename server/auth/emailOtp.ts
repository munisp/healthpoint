/**
 * server/auth/emailOtp.ts
 *
 * MFA login-gating via a one-time code emailed through Resend — an
 * alternative to TOTP (server/auth/mfa.ts) for the "verify" stage of the
 * two-stage login, for users who have TOTP enabled but don't have their
 * authenticator app to hand (parallels the existing backup-code path).
 *
 * Code storage reuses the generic Redis session store (server/redis.ts's
 * sessionSet/Get/Del) the same way server/_core/keycloak.ts already reuses
 * it for PKCE state — a short-lived, single-use value keyed by purpose, not
 * a "session" in the auth sense. The code itself is hashed before storage;
 * only the hash lives in Redis.
 *
 * Brute force is bounded two ways: a fixed TTL (the code stops working on
 * its own) and a Redis-backed attempt counter (rateLimitIncr) checked
 * BEFORE comparing the submitted code, so repeated wrong guesses are capped
 * regardless of outcome, not just after a correct one resets the window.
 */

import { createHash, randomInt } from "crypto";
import { sessionSet, sessionGet, sessionDel, rateLimitIncr } from "../redis";

const OTP_TTL_SECONDS = 10 * 60; // 10 minutes
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_SECONDS = OTP_TTL_SECONDS;

function otpKey(userId: string): string {
  return `email-otp:${userId}`;
}

function hashCode(code: string, userId: string): string {
  // userId-salted so a leaked hash can't be replayed against a different
  // user's pending code.
  return createHash("sha256").update(`${userId}:${code}`).digest("hex");
}

/**
 * Generate a fresh 6-digit code, store its hash (10 min TTL, replacing any
 * prior pending code for this user), and email it via Resend. Resets the
 * attempt counter so requesting a new code gives a clean set of tries.
 */
export async function requestLoginEmailOtp(userId: string, email: string): Promise<void> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await sessionSet(otpKey(userId), hashCode(code, userId), OTP_TTL_SECONDS);
  // A fresh code means a fresh set of attempts - otherwise a user who used
  // up their tries, requests a new code, and gets locked out again
  // immediately by the old counter's leftover window.
  await sessionDel(`email-otp-attempts:${userId}`);
  const { sendLoginOtpEmail } = await import("../email");
  await sendLoginOtpEmail(email, code);
}

export type VerifyLoginEmailOtpResult = "ok" | "invalid" | "rate_limited" | "expired";

/**
 * Verify a submitted code against the stored hash. Single-use: the stored
 * value is deleted on a successful match so it cannot be replayed.
 */
export async function verifyLoginEmailOtp(userId: string, code: string): Promise<VerifyLoginEmailOtpResult> {
  // Checked BEFORE touching the stored code, so attempts are capped even
  // against guesses made after the real code has already expired.
  const attempts = await rateLimitIncr(`email-otp-attempts:${userId}`, ATTEMPT_WINDOW_SECONDS);
  if (attempts > MAX_ATTEMPTS) return "rate_limited";

  const stored = await sessionGet(otpKey(userId));
  if (!stored) return "expired";
  if (stored !== hashCode(code, userId)) return "invalid";

  await sessionDel(otpKey(userId));
  return "ok";
}
