/**
 * server/auth/mfa.ts
 *
 * MFA (TOTP) login-gating helpers.
 *
 * Two-stage login: after the Keycloak callback (or any session-issuing path),
 * a user who has an ACTIVE totp_secrets row — or whose orgSettings.requireMFA
 * is true without TOTP enrolled — receives a short-lived "mfa-pending"
 * session token (5 min, scope mfa-only) instead of a full session. The
 * tRPC context (server/_core/context.ts + _core/trpc.ts) exposes the user but
 * denies all protected procedures (403) except an explicit allow-list
 * (auth.verifyLoginTotp + totp setup procs for forced enrollment).
 * auth.verifyLoginTotp upgrades the session to a full token after a valid
 * TOTP proof (or a single-use backup code).
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { orgSettings, totpSecrets } from "../../drizzle/schema";

export type MfaRequirement = "none" | "verify" | "enroll";

/** True when the user has an ACTIVE TOTP secret (2FA enabled). */
export async function hasActiveTotp(userId: string): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;
    const rows = await db
      .select({ id: totpSecrets.id })
      .from(totpSecrets)
      .where(and(eq(totpSecrets.userId, userId), eq(totpSecrets.status, "active")))
      .limit(1);
    return rows.length > 0;
  } catch (err) {
    // Fail open on DB errors so a transient outage cannot lock every user
    // out; the TOTP row check re-runs at verifyLoginTotp time anyway.
    console.warn("[mfa] hasActiveTotp lookup failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

/** True when the user's org settings mandate MFA enrollment. */
export async function orgRequiresMfa(userId: string): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;
    const rows = await db
      .select({ r: orgSettings.requireMFA })
      .from(orgSettings)
      .where(eq(orgSettings.userId, userId))
      .limit(1);
    return rows[0]?.r === true;
  } catch (err) {
    console.warn("[mfa] orgRequiresMfa lookup failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Determine the post-login MFA requirement for a user:
 *   "verify" — TOTP enabled: must present a code before full access
 *   "enroll" — orgSettings.requireMFA=true and no TOTP: must set up TOTP first
 *   "none"   — full session may be issued immediately
 */
export async function getMfaRequirement(userId: string): Promise<MfaRequirement> {
  if (await hasActiveTotp(userId)) return "verify";
  if (await orgRequiresMfa(userId)) return "enroll";
  return "none";
}

/**
 * Verify a TOTP code or single-use backup code against the user's ACTIVE
 * secret. Backup codes are consumed on success. Returns true on success.
 * Throws nothing — all failures return false (callers map to 401).
 */
export async function verifyLoginCode(userId: string, code: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .select()
    .from(totpSecrets)
    .where(and(eq(totpSecrets.userId, userId), eq(totpSecrets.status, "active")))
    .limit(1);
  const row = rows[0];
  if (!row) return false;

  if (/^\d{6}$/.test(code)) {
    const { verify: totpVerify } = await import("otplib");
    // Same envelope format as decryptTotpSecret in server/routers.ts
    // (AES-256-GCM via credential-crypto, "v1."-prefixed; legacy plaintext ok).
    const { decryptCredentials } = await import("../credential-crypto");
    const stored = row.secret;
    let plaintext: string;
    try {
      if (!stored.startsWith("v1.")) plaintext = stored;
      else {
        const creds = decryptCredentials(stored);
        if (typeof creds.s !== "string") return false;
        plaintext = creds.s;
      }
    } catch {
      return false;
    }
    const result = await totpVerify({ token: code, secret: plaintext });
    return result.valid === true;
  }

  // Backup code path (xxxx-xxxx) — single use.
  const backupCodes = JSON.parse(row.backupCodes ?? "[]") as string[];
  const used = JSON.parse(row.usedBackupCodes ?? "[]") as string[];
  const normalized = code.trim().toLowerCase();
  if (!backupCodes.map(c => c.toLowerCase()).includes(normalized)) return false;
  if (used.map(c => c.toLowerCase()).includes(normalized)) return false;
  const original = backupCodes.find(c => c.toLowerCase() === normalized)!;
  await db
    .update(totpSecrets)
    .set({ usedBackupCodes: JSON.stringify([...used, original]), updatedAt: new Date() })
    .where(eq(totpSecrets.userId, userId));
  return true;
}
