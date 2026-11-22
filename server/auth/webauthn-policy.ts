/**
 * server/auth/webauthn-policy.ts
 *
 * Phase 25: WebAuthn / passkey policy helpers.
 *
 *  - assertWebauthnEnabled(): master env gate (design §5.1). Every
 *    webauthn.* procedure calls this first. Env gate deliberately — unknown
 *    feature_flags rows are DEFAULT-ON (server/feature-flags.ts), the wrong
 *    failure direction for an auth feature.
 *  - hasActivePasskey(userId): mirrors hasActiveTotp's exact shape including
 *    fail-open-on-DB-error with a warn log (server/auth/mfa.ts) — a
 *    transient DB blip must not lock out all staff; the verify-time row
 *    lookup re-checks anyway.
 *  - passkeyRequiredForRole(userId): the §5.2 "required" enforcement tier —
 *    true when WEBAUTHN_ENFORCEMENT=required and the user's role is in
 *    WEBAUTHN_REQUIRED_ROLES.
 *  - resolveWebauthnRpConfig(): RP ID / origin resolution (design §4.2).
 *    Explicit WEBAUTHN_RP_ID / WEBAUTHN_ORIGINS win; otherwise derived from
 *    VITE_APP_URL (+ ALLOWED_ORIGINS for origins).
 */
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { users } from "../../drizzle/schema";
import { webauthnCredentials } from "../../drizzle/schema-webauthn";
import { ENV } from "../_core/env";

/** Master gate (design §5.1): every webauthn.* procedure starts with this. */
export function assertWebauthnEnabled(): void {
  if (!ENV.webauthnEnabled) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "webauthn_disabled" });
  }
}

/** True when the user has at least one registered passkey. */
export async function hasActivePasskey(userId: string): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;
    const rows = await db
      .select({ id: webauthnCredentials.id })
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.userId, userId))
      .limit(1);
    return rows.length > 0;
  } catch (err) {
    // Fail open on DB errors so a transient outage cannot lock every user
    // out (hasActiveTotp precedent, server/auth/mfa.ts); the assertion-time
    // credential lookup re-runs anyway.
    console.warn("[webauthn] hasActivePasskey lookup failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * §5.2 "required" tier: true when WEBAUTHN_ENFORCEMENT=required and the
 * user's role is in WEBAUTHN_REQUIRED_ROLES (default "admin"). Fail-open on
 * DB error (same rationale as hasActivePasskey).
 */
export async function passkeyRequiredForRole(userId: string): Promise<boolean> {
  if (ENV.webauthnEnforcement !== "required") return false;
  try {
    const db = await getDb();
    if (!db) return false;
    const rows = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
    const role = rows[0]?.role;
    return typeof role === "string" && ENV.webauthnRequiredRoles.includes(role);
  } catch (err) {
    console.warn("[webauthn] passkeyRequiredForRole lookup failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

export interface WebauthnRpConfig {
  rpId: string;
  rpName: string;
  origins: string[];
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/**
 * Resolve RP ID / accepted origins (design §4.2):
 *  - rpId: WEBAUTHN_RP_ID when set, else the VITE_APP_URL hostname.
 *  - origins: WEBAUTHN_ORIGINS when set (explicit list wins), else
 *    VITE_APP_URL + ALLOWED_ORIGINS (deduped).
 * Throws PRECONDITION_FAILED when no usable RP ID can be determined —
 * enabling WebAuthn without a resolvable RP ID is a misconfiguration, not a
 * runtime condition (fail-closed).
 */
export function resolveWebauthnRpConfig(): WebauthnRpConfig {
  const rpId = ENV.webauthnRpId || hostnameOf(ENV.appUrl) || "";
  if (!rpId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "webauthn_misconfigured: set WEBAUTHN_RP_ID or VITE_APP_URL",
    });
  }
  const origins = ENV.webauthnOrigins.length > 0
    ? ENV.webauthnOrigins
    : Array.from(new Set([ENV.appUrl, ...ENV.allowedOrigins].filter(Boolean)));
  if (origins.length === 0) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "webauthn_misconfigured: set WEBAUTHN_ORIGINS or VITE_APP_URL",
    });
  }
  return { rpId, rpName: ENV.webauthnRpName || "HealthPoint", origins };
}
