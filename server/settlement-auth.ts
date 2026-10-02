import { createHash, createHmac, timingSafeEqual } from "crypto";

export const SETTLEMENT_SIGNATURE_HEADER = "x-settlement-signature";
export const SETTLEMENT_TIMESTAMP_HEADER = "x-settlement-timestamp";
export const SETTLEMENT_EVENT_ID_HEADER = "x-settlement-event-id";
export const SETTLEMENT_KEY_ID_HEADER = "x-settlement-key-id";
export const DEFAULT_CALLBACK_MAX_AGE_MS = 5 * 60 * 1000;

export type SettlementCallbackKeyring = Record<string, string>;

export interface SettlementSignatureVerification {
  valid: boolean;
  reason?: string;
}

export function parseSettlementCallbackKeyring(raw: string | undefined): SettlementCallbackKeyring | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const entries = Object.entries(parsed).filter(([keyId, secret]) =>
      /^[A-Za-z0-9._-]{1,64}$/.test(keyId) && typeof secret === "string" && secret.length >= 32
    );
    return entries.length ? Object.fromEntries(entries) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Produces the canonical HMAC message used by settlement providers and HealthPoint.
 * The exact raw request body is signed to prevent field reordering or post-parse mutation.
 */
export function signSettlementCallback(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export function verifySettlementCallbackSignature(input: {
  secret: string | undefined;
  keyring?: SettlementCallbackKeyring | undefined;
  keyId?: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
  rawBody: string;
  now?: Date;
  maxAgeMs?: number;
}): SettlementSignatureVerification {
  const secret = input.keyring
    ? (input.keyId ? input.keyring[input.keyId] : undefined)
    : input.secret;
  if (!secret || secret.length < 32) {
    return { valid: false, reason: "settlement callback secret is not configured" };
  }
  if (!input.timestamp || !input.signature) {
    return { valid: false, reason: "missing settlement callback signature headers" };
  }
  const timestampMs = Number(input.timestamp);
  if (!Number.isFinite(timestampMs)) {
    return { valid: false, reason: "invalid settlement callback timestamp" };
  }
  const maxAgeMs = input.maxAgeMs ?? DEFAULT_CALLBACK_MAX_AGE_MS;
  if (Math.abs((input.now ?? new Date()).getTime() - timestampMs) > maxAgeMs) {
    return { valid: false, reason: "settlement callback timestamp is outside the accepted window" };
  }
  const expected = signSettlementCallback(secret, input.timestamp, input.rawBody);
  const supplied = Buffer.from(input.signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (supplied.length !== expectedBuffer.length || !timingSafeEqual(supplied, expectedBuffer)) {
    return { valid: false, reason: "invalid settlement callback signature" };
  }
  return { valid: true };
}

// ─── Replay protection (settlement_callback_nonces) ─────────────────────────
//
// HMAC + timestamp-window verification alone leaves a gap: a captured callback
// is byte-identical replayable inside the window. The settlement callback
// payloads carry NO nonce/jti field, so we DERIVE a per-transmission nonce:
//
//   nonce = sha256hex(`${signature}.${timestamp}.${sha256hex(rawBody)}`)
//
// Deterministic for a given transmission (any byte change to signature,
// timestamp, or body yields a different nonce), yet distinct across legitimate
// provider retries (which re-sign with a fresh timestamp), so at-least-once
// delivery semantics are preserved and only true replays are rejected.
//
// Rows live in settlement_callback_nonces (migration 0055_wave_auditfix) and
// are purged by the retention worker (server/scheduled/retentionWorker.ts).

export const SETTLEMENT_NONCE_TTL_MS = 24 * 60 * 60 * 1000; // 24h >> 5min window

export function deriveSettlementCallbackNonce(input: {
  signature: string;
  timestamp: string;
  rawBody: string;
}): string {
  const bodyHash = createHash("sha256").update(input.rawBody).digest("hex");
  return createHash("sha256")
    .update(`${input.signature}.${input.timestamp}.${bodyHash}`)
    .digest("hex");
}

/**
 * Atomically claim a nonce. Returns true when the nonce was newly observed
 * (inserted), false when it already exists (replay). Call AFTER signature
 * verification and BEFORE business processing, in the same request path, so
 * the claim is the single atomic gate. Throws when the DB is unavailable —
 * settlement callbacks already require the DB for reconciliation, so this
 * preserves fail-closed behavior (the route returns 503).
 */
export async function claimSettlementCallbackNonce(
  nonce: string,
  ttlMs: number = SETTLEMENT_NONCE_TTL_MS
): Promise<boolean> {
  const { getDb } = await import("./db");
  const { settlementCallbackNonces } = await import("../drizzle/schema-portal-rpa");
  const db = await getDb();
  if (!db) throw new Error("settlement callback replay store unavailable (database down)");
  const inserted = await db
    .insert(settlementCallbackNonces)
    .values({ nonce, expiresAt: new Date(Date.now() + ttlMs) })
    .onConflictDoNothing()
    .returning({ nonce: settlementCallbackNonces.nonce });
  return inserted.length > 0;
}

/** Retention hook: drop nonce rows past their expiry. Returns rows purged. */
export async function purgeExpiredSettlementCallbackNonces(now: Date = new Date()): Promise<number> {
  const { getDb } = await import("./db");
  const { settlementCallbackNonces } = await import("../drizzle/schema-portal-rpa");
  const { lt } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .delete(settlementCallbackNonces)
    .where(lt(settlementCallbackNonces.expiresAt, now))
    .returning({ nonce: settlementCallbackNonces.nonce });
  return rows.length;
}
