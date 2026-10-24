import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

function encryptionKey(): Buffer {
  const raw = process.env.EMR_CREDENTIALS_ENCRYPTION_KEY ?? "";
  if (!/^[a-fA-F0-9]{64}$/.test(raw)) {
    throw new Error("EMR_CREDENTIALS_ENCRYPTION_KEY must be a 64-character hexadecimal AES-256 key");
  }
  return Buffer.from(raw, "hex");
}

/** Encrypt credential JSON with AES-256-GCM; caller persists only the versioned envelope. */
export function encryptCredentials(credentials: Record<string, string>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

/** Decrypt only in trusted server-side connector code; never return credentials to a client. */
export function decryptCredentials(envelope: string): Record<string, string> {
  const [version, ivRaw, tagRaw, ciphertextRaw] = envelope.split(".");
  if (version !== VERSION || !ivRaw || !tagRaw || !ciphertextRaw) throw new Error("Unsupported encrypted credential envelope");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextRaw, "base64url")), decipher.final()]).toString("utf8");
  const parsed: unknown = JSON.parse(plaintext);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Credential envelope did not contain an object");
  return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

// ─── SMART-on-FHIR access/refresh token encryption at rest ─────────────────
// Same AES-256-GCM envelope scheme as EMR credentials, but for a single
// opaque token string. Envelope prefix `v1t` distinguishes token envelopes
// from credential-JSON envelopes (`v1`). Legacy rows written before this
// remediation hold plaintext; decryptToken falls back to returning the value
// unchanged when it is not an envelope (plaintext fallback read).

const TOKEN_VERSION = "v1t";

/** Encrypt a single token string for at-rest storage. */
export function encryptToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [TOKEN_VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

/** True when the stored value is an encrypted token envelope (not legacy plaintext). */
export function isEncryptedToken(value: string): boolean {
  return value.startsWith(`${TOKEN_VERSION}.`) && value.split(".").length === 4;
}

/**
 * Decrypt a stored token. Plaintext fallback: legacy rows (pre-encryption)
 * are returned unchanged so existing tokens keep working until rotated.
 */
export function decryptToken(value: string): string {
  if (!isEncryptedToken(value)) return value;
  const [version, ivRaw, tagRaw, ciphertextRaw] = value.split(".");
  if (version !== TOKEN_VERSION || !ivRaw || !tagRaw || !ciphertextRaw) throw new Error("Unsupported encrypted token envelope");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextRaw, "base64url")), decipher.final()]).toString("utf8");
}
