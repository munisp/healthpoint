import { createHmac, timingSafeEqual } from "crypto";

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
