/**
 * server/auth/enroll-confirm.ts
 *
 * Wave P26 (adversarial finding O6): out-of-band email confirmation for
 * FIRST-factor enrollment.
 *
 * Threat model closed here: an attacker holding only a phished password can
 * reach an mfa-pending session and — before this wave — enroll their OWN
 * TOTP or passkey as a durable backdoor (the enrollment paths require
 * nothing beyond the password; routers.ts is frozen and cannot be gated
 * directly). This module instead gates the CONSUMPTION points, all in
 * editable files:
 *
 *   - server/auth/mfa.ts          hasActiveTotp / verifyLoginCode require a
 *                                 confirmed companion row whose fingerprint
 *                                 matches the CURRENT TOTP envelope.
 *   - server/auth/webauthn-policy.ts / routers/webauthn.ts
 *                                 unconfirmed passkeys (confirmed_at NULL)
 *                                 are rejected at authentication and
 *                                 invisible to getMfaRequirement.
 *
 * Token discipline (submitter.ts / personas.ts invite-token precedent):
 * the raw token is 32 random bytes hex-encoded, returned exactly once (to
 * the email sender) and never stored; only sha256(raw) is persisted. TTL
 * via FACTOR_CONFIRM_TTL_SECONDS (default 3600). Single-use: consumed_at is
 * set atomically with confirmation; re-use or expiry → generic "invalid or
 * expired" (no account-existence leak — the token is the only input).
 *
 * TOTP re-setup detector: the confirmation row stores md5(secret envelope)
 * at issuance. totp.setup replaces the envelope (server/routers.ts:5583),
 * so a stolen-session re-setup invalidates prior confirmations. md5 is a
 * change-detector over an AES-256-GCM envelope, not credential hashing, and
 * is core-SQL so the migration 0060 backfill matches (schema-enroll-confirm.ts).
 *
 * Test seam: getLastIssuedTokenForTests mirrors replaceChallengeForTests
 * (server/auth/webauthn-challenge.ts) — non-production only, lets journeys
 * and integration tests complete the email loop without an SMTP server.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "../db";
import { totpSecrets } from "../../drizzle/schema";
import { webauthnCredentials } from "../../drizzle/schema-webauthn";
import { factorEnrollmentConfirmations } from "../../drizzle/schema-enroll-confirm";
import { ENV } from "../_core/env";

export type FactorType = "totp" | "passkey";

/** md5 change-detector over the stored TOTP envelope (see module header). */
export function totpFingerprint(secretEnvelope: string): string {
  return createHash("md5").update(secretEnvelope).digest("hex");
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// ── Confirmation-state queries ──────────────────────────────────────────────

/**
 * True when the given ACTIVE totp_secrets row has a confirmed companion
 * whose fingerprint matches the row's CURRENT secret envelope. A re-setup
 * (new envelope) invalidates every prior confirmation.
 */
export async function isTotpConfirmed(totpRowId: string, secretEnvelope: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .select({ id: factorEnrollmentConfirmations.id })
    .from(factorEnrollmentConfirmations)
    .where(and(
      eq(factorEnrollmentConfirmations.factorType, "totp"),
      eq(factorEnrollmentConfirmations.factorId, totpRowId),
      eq(factorEnrollmentConfirmations.factorFingerprint, totpFingerprint(secretEnvelope)),
      isNotNull(factorEnrollmentConfirmations.confirmedAt),
    ))
    .limit(1);
  return rows.length > 0;
}

/**
 * Count the user's CONFIRMED factors (active+confirmed TOTP counts once;
 * confirmed passkeys count each). This is the first-vs-subsequent
 * enrollment discriminator: 0 → the enrolling factor is the account's
 * first and must be email-confirmed before it activates.
 */
export async function countConfirmedFactors(userId: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  let count = 0;
  const totpRows = await db
    .select({ id: totpSecrets.id, secret: totpSecrets.secret })
    .from(totpSecrets)
    .where(and(eq(totpSecrets.userId, userId), eq(totpSecrets.status, "active")))
    .limit(1);
  if (totpRows[0] && (await isTotpConfirmed(totpRows[0].id, totpRows[0].secret))) count += 1;
  const passkeys = await db
    .select({ id: webauthnCredentials.id })
    .from(webauthnCredentials)
    .where(and(eq(webauthnCredentials.userId, userId), isNotNull(webauthnCredentials.confirmedAt)));
  return count + passkeys.length;
}

// ── Token issuance ──────────────────────────────────────────────────────────

export interface IssueConfirmationInput {
  userId: string;
  factorType: FactorType;
  factorId: string;
  /** md5(secret envelope) for TOTP; null for passkeys. */
  factorFingerprint?: string | null;
  label?: string | null;
  requestIp?: string | null;
  requestUserAgent?: string | null;
}

// Non-production test seam (see module header).
const lastIssuedForTests = new Map<string, string>();

/**
 * Issue a fresh single-use confirmation token for a pending factor. Any
 * prior UNCONSUMED token rows for the same factor are expired (latest
 * email wins; resend cannot multiply valid tokens). Returns the RAW token
 * (email it; never store it) plus the row id and expiry.
 */
export async function issueConfirmation(input: IssueConfirmationInput): Promise<{
  rowId: string;
  token: string;
  expiresAt: Date;
}> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  // Burn prior pending tokens for this factor (superseded by this one).
  // Strictly-past expiry: the consume check is `expiresAt < now`, so a
  // same-millisecond `now()` would leave the old token live.
  await db
    .update(factorEnrollmentConfirmations)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(and(
      eq(factorEnrollmentConfirmations.factorType, input.factorType),
      eq(factorEnrollmentConfirmations.factorId, input.factorId),
      isNull(factorEnrollmentConfirmations.consumedAt),
      isNull(factorEnrollmentConfirmations.confirmedAt),
    ));
  const rowId = randomUUID();
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + ENV.factorConfirmTtlSeconds * 1000);
  await db.insert(factorEnrollmentConfirmations).values({
    id: rowId,
    userId: input.userId,
    factorType: input.factorType,
    factorId: input.factorId,
    factorFingerprint: input.factorFingerprint ?? null,
    tokenHash: hashToken(token),
    label: input.label ?? null,
    requestIp: input.requestIp ?? null,
    requestUserAgent: input.requestUserAgent ?? null,
    expiresAt,
  });
  if (process.env.NODE_ENV !== "production") {
    lastIssuedForTests.set(`${input.factorType}:${input.factorId}`, token);
  }
  return { rowId, token, expiresAt };
}

/** Test seam (non-production only): the last raw token issued for a factor. */
export function getLastIssuedTokenForTests(factorType: FactorType, factorId: string): string | null {
  if (process.env.NODE_ENV === "production") {
    throw new Error("getLastIssuedTokenForTests is unavailable in production");
  }
  return lastIssuedForTests.get(`${factorType}:${factorId}`) ?? null;
}

// ── Token consumption ───────────────────────────────────────────────────────

export type ConsumeResult =
  | { status: "confirmed"; userId: string; factorType: FactorType; factorId: string }
  | { status: "invalid" };

/**
 * Confirm a factor from a raw emailed token. Token-only (no session) by
 * design: the attacker's mfa-pending session cannot self-confirm — the
 * token exists only in the account owner's mailbox.
 *
 * All failure modes (unknown token, expired, already consumed, factor
 * deleted, TOTP envelope changed since issuance) collapse to "invalid" so
 * the endpoint leaks nothing about account state.
 */
export async function consumeConfirmationToken(rawToken: string): Promise<ConsumeResult> {
  const db = await getDb();
  if (!db) return { status: "invalid" };
  const rows = await db
    .select()
    .from(factorEnrollmentConfirmations)
    .where(eq(factorEnrollmentConfirmations.tokenHash, hashToken(rawToken)))
    .limit(1);
  const row = rows[0];
  if (!row) return { status: "invalid" };
  if (row.consumedAt || row.confirmedAt) return { status: "invalid" };
  if (row.expiresAt.getTime() < Date.now()) return { status: "invalid" };

  if (row.factorType === "passkey") {
    // Activate the credential only if it still exists, still belongs to the
    // same user, and is still pending.
    const creds = await db
      .select({ id: webauthnCredentials.id, confirmedAt: webauthnCredentials.confirmedAt })
      .from(webauthnCredentials)
      .where(and(
        eq(webauthnCredentials.id, row.factorId),
        eq(webauthnCredentials.userId, row.userId),
      ))
      .limit(1);
    if (!creds[0] || creds[0].confirmedAt) return { status: "invalid" };
    await db.update(webauthnCredentials)
      .set({ confirmedAt: new Date() })
      .where(eq(webauthnCredentials.id, row.factorId));
  } else {
    // TOTP: the envelope must be unchanged since issuance (re-setup detector).
    const totpRows = await db
      .select({ id: totpSecrets.id, secret: totpSecrets.secret, status: totpSecrets.status })
      .from(totpSecrets)
      .where(and(eq(totpSecrets.id, row.factorId), eq(totpSecrets.userId, row.userId)))
      .limit(1);
    const t = totpRows[0];
    if (!t || t.status !== "active") return { status: "invalid" };
    if (!row.factorFingerprint || row.factorFingerprint !== totpFingerprint(t.secret)) {
      return { status: "invalid" };
    }
    // The companion row itself IS the TOTP confirmation state — marking it
    // confirmed below activates the factor (mfa.ts checks confirmedAt +
    // fingerprint match).
  }

  await db.update(factorEnrollmentConfirmations)
    .set({ consumedAt: new Date(), confirmedAt: new Date() })
    .where(eq(factorEnrollmentConfirmations.id, row.id));
  return {
    status: "confirmed",
    userId: row.userId,
    factorType: row.factorType as FactorType,
    factorId: row.factorId,
  };
}

// ── TOTP companion helpers (used by the mfaConfirm router) ─────────────────

/**
 * Record an immediately-confirmed TOTP companion (subsequent-factor
 * enrollment: the user already proved possession of another confirmed
 * factor, so only an alert email is required, not a confirmation round-trip).
 */
export async function recordConfirmedTotpCompanion(input: {
  userId: string;
  totpRowId: string;
  secretEnvelope: string;
  label?: string | null;
  requestIp?: string | null;
  requestUserAgent?: string | null;
}): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const id = randomUUID();
  await db.insert(factorEnrollmentConfirmations).values({
    id,
    userId: input.userId,
    factorType: "totp",
    factorId: input.totpRowId,
    factorFingerprint: totpFingerprint(input.secretEnvelope),
    // Placeholder hash: no usable token exists for an already-confirmed row
    // (consumed+confirmed at insert). Random to preserve token uniqueness.
    tokenHash: hashToken(randomBytes(32).toString("hex")),
    label: input.label ?? null,
    requestIp: input.requestIp ?? null,
    requestUserAgent: input.requestUserAgent ?? null,
    expiresAt: new Date(),
    consumedAt: new Date(),
    confirmedAt: new Date(),
  });
  return id;
}

/**
 * Find the user's pending (unconfirmed) factor of the given type, if any:
 *  - totp: the ACTIVE totp_secrets row lacks a valid confirmed companion
 *    (covers both fresh enrollment and post-re-setup invalidation);
 *  - passkey: the newest credential with confirmed_at NULL.
 * Returns enough to issue a fresh token (resend flow).
 */
export async function findPendingFactor(userId: string, factorType: FactorType): Promise<{
  factorId: string;
  factorFingerprint: string | null;
  label: string;
} | null> {
  const db = await getDb();
  if (!db) return null;
  if (factorType === "totp") {
    const rows = await db
      .select({ id: totpSecrets.id, secret: totpSecrets.secret })
      .from(totpSecrets)
      .where(and(eq(totpSecrets.userId, userId), eq(totpSecrets.status, "active")))
      .limit(1);
    const t = rows[0];
    if (!t) return null;
    if (await isTotpConfirmed(t.id, t.secret)) return null;
    return { factorId: t.id, factorFingerprint: totpFingerprint(t.secret), label: "Authenticator app (TOTP)" };
  }
  const creds = await db
    .select({ id: webauthnCredentials.id, name: webauthnCredentials.name })
    .from(webauthnCredentials)
    .where(and(eq(webauthnCredentials.userId, userId), isNull(webauthnCredentials.confirmedAt)))
    .orderBy(desc(webauthnCredentials.createdAt))
    .limit(1);
  const c = creds[0];
  if (!c) return null;
  return { factorId: c.id, factorFingerprint: null, label: c.name || "Passkey" };
}
