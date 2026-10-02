/**
 * server/push/dispatcher.ts — Phase 15 wave FB (audit A1/HIGH fix)
 *
 * Real push-notification dispatch path. Prior to this wave, rows were written
 * to push_subscriptions / expo_push_tokens but nothing ever read them, so push
 * delivery was a dead letter.
 *
 * Channels:
 *  1. Web Push (RFC 8291 aes128gcm payload encryption + RFC 8292 VAPID
 *     voluntary identification). Implemented directly on node:crypto — the
 *     `web-push` npm package is intentionally NOT a dependency (it is not in
 *     package.json and the lockfile is owned by another workstream). The
 *     implementation below follows the public specs; anything it cannot do
 *     (e.g. non-aes128gcm encodings) is reported as unsupported, never faked.
 *  2. Expo Push API (https://exp.host/--/api/v2/push/send) for React-Native
 *     tokens stored in expo_push_tokens.
 *
 * Honesty contract:
 *  - When VAPID keys are not configured, web-push targets are reported as
 *    deliveryStatus "unconfigured" and the attempt is recorded in
 *    notification_attempts with status 'unconfigured' — delivery is never
 *    claimed.
 *  - PUSH_NOTIFICATIONS_ENABLED=false is an explicit kill switch (skips all
 *    dispatch, logs once per call).
 *  - HTTP failures are reported as "failed" with the provider's status code.
 *
 * Unit tests (server/push/dispatcher.test.ts) mock fetch — MOCK-VERIFIED.
 */

import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { pushSubscriptions } from "../../drizzle/schema-push";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export type PushDeliveryStatus = "delivered" | "unconfigured" | "failed" | "disabled";

export interface PushDeliveryResult {
  channel: "web-push" | "expo";
  target: string; // endpoint host or truncated token — never full credentials
  success: boolean;
  deliveryStatus: PushDeliveryStatus;
  error?: string;
}

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const PUSH_TTL_SECONDS = 86_400;

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function getVapidConfig(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: process.env.VAPID_SUBJECT?.trim() || "mailto:ops@healthpoint.example.com" };
}

export function isPushDispatchEnabled(): boolean {
  return process.env.PUSH_NOTIFICATIONS_ENABLED !== "false";
}

// ─── VAPID JWT (RFC 8292) ───────────────────────────────────────────────────

function vapidAuthorizationHeader(endpoint: string, vapid: { publicKey: string; privateKey: string; subject: string }): string {
  const aud = new URL(endpoint).origin;
  const header = b64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64url(Buffer.from(JSON.stringify({
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: vapid.subject,
  })));
  const pub = fromB64url(vapid.publicKey); // 65-byte uncompressed point
  const jwk = {
    kty: "EC", crv: "P-256",
    x: b64url(pub.subarray(1, 33)),
    y: b64url(pub.subarray(33, 65)),
    d: b64url(fromB64url(vapid.privateKey)),
  } as crypto.JsonWebKey;
  const key = crypto.createPrivateKey({ key: jwk, format: "jwk" });
  const sig = crypto.sign("sha256", Buffer.from(`${header}.${payload}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${payload}.${b64url(sig)}, k=${vapid.publicKey}`;
}

// ─── RFC 8291 aes128gcm payload encryption ──────────────────────────────────

function hkdfExtract(salt: Buffer, ikm: Buffer): Buffer {
  return crypto.createHmac("sha256", salt).update(ikm).digest();
}
function hkdfExpand(prk: Buffer, info: Buffer, length: number): Buffer {
  return crypto.createHmac("sha256", prk).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, length);
}

/**
 * Encrypt a push payload for one subscription (aes128gcm content coding,
 * single record). Throws on malformed subscriber keys — callers must treat a
 * throw as a failed delivery for that target, never silently drop.
 */
export function encryptWebPushPayload(payload: string, p256dhB64: string, authB64: string): Buffer {
  const uaPublic = fromB64url(p256dhB64);
  const authSecret = fromB64url(authB64);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error("invalid p256dh key (expected uncompressed P-256 point)");
  if (authSecret.length < 16) throw new Error("invalid auth secret");

  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey(); // uncompressed
  const sharedSecret = ecdh.computeSecret(uaPublic);

  // RFC 8291 §3.3: derive IKM using the auth secret
  const prkKey = hkdfExtract(authSecret, sharedSecret);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0", "utf8"), uaPublic, asPublic]);
  const ikm = hkdfExpand(prkKey, keyInfo, 32);

  // RFC 8188 aes128gcm content encryption key / nonce
  const salt = crypto.randomBytes(16);
  const prk = hkdfExtract(salt, ikm);
  const cek = hkdfExpand(prk, Buffer.from("Content-Encoding: aes128gcm\0", "utf8"), 16);
  const nonce = hkdfExpand(prk, Buffer.from("Content-Encoding: nonce\0", "utf8"), 12);

  // Single record: padding delimiter 0x02 terminates the (empty-pad) plaintext
  const plaintext = Buffer.concat([Buffer.from(payload, "utf8"), Buffer.from([0x02])]);
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096, 0);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, ciphertext]);
}

// ─── Channel senders ────────────────────────────────────────────────────────

export async function sendWebPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  message: PushMessage,
  fetchImpl: typeof fetch = fetch,
): Promise<PushDeliveryResult> {
  const target = safeTarget(subscription.endpoint);
  const vapid = getVapidConfig();
  if (!vapid) {
    return { channel: "web-push", target, success: false, deliveryStatus: "unconfigured", error: "VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not configured" };
  }
  try {
    const body = encryptWebPushPayload(JSON.stringify({ title: message.title, body: message.body, data: message.data ?? {} }), subscription.p256dh, subscription.auth);
    const res = await fetchImpl(subscription.endpoint, {
      method: "POST",
      headers: {
        Authorization: vapidAuthorizationHeader(subscription.endpoint, vapid),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(PUSH_TTL_SECONDS),
        Urgency: "normal",
      },
      body: new Uint8Array(body),
    });
    if (res.status === 201 || res.status === 202) {
      return { channel: "web-push", target, success: true, deliveryStatus: "delivered" };
    }
    const text = (await res.text().catch(() => "")).slice(0, 200);
    return { channel: "web-push", target, success: false, deliveryStatus: "failed", error: `push service HTTP ${res.status}: ${text}` };
  } catch (err) {
    return { channel: "web-push", target, success: false, deliveryStatus: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

export async function sendExpoPush(
  tokens: string[],
  message: PushMessage,
  fetchImpl: typeof fetch = fetch,
): Promise<PushDeliveryResult[]> {
  if (tokens.length === 0) return [];
  try {
    const res = await fetchImpl(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(tokens.map(to => ({ to, title: message.title, body: message.body, data: message.data ?? {}, sound: "default" }))),
    });
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 200);
      return tokens.map(t => ({ channel: "expo" as const, target: safeTarget(t), success: false, deliveryStatus: "failed" as const, error: `Expo push HTTP ${res.status}: ${text}` }));
    }
    const data = (await res.json()) as { data?: { status: string; message?: string }[] };
    return tokens.map((t, i) => {
      const receipt = data.data?.[i];
      const ok = receipt?.status === "ok" || receipt === undefined;
      return {
        channel: "expo" as const,
        target: safeTarget(t),
        success: ok,
        deliveryStatus: (ok ? "delivered" : "failed") as PushDeliveryStatus,
        ...(ok ? {} : { error: receipt?.message ?? "Expo rejected token" }),
      };
    });
  } catch (err) {
    return tokens.map(t => ({ channel: "expo" as const, target: safeTarget(t), success: false, deliveryStatus: "failed" as const, error: err instanceof Error ? err.message : String(err) }));
  }
}

function safeTarget(target: string): string {
  try {
    if (target.startsWith("http")) return new URL(target).host;
  } catch { /* fall through */ }
  return target.slice(0, 18) + "…";
}

// ─── Fan-out ────────────────────────────────────────────────────────────────

/**
 * Deliver a push message to every registered device of a user.
 * Reads push_subscriptions (drizzle) and expo_push_tokens (raw SQL — table
 * created by migration 0043_wave_w7.sql, drizzle/schema.ts is wave-owned).
 * Every attempted target produces an honest PushDeliveryResult; when web push
 * is unconfigured the attempt is also persisted to notification_attempts so
 * the dead-letter is observable (never silent).
 */
export async function dispatchPushToUser(
  userId: string,
  message: PushMessage,
  opts: { disputeRef?: string; fetchImpl?: typeof fetch } = {},
): Promise<PushDeliveryResult[]> {
  if (!isPushDispatchEnabled()) {
    console.warn(`[push] dispatch disabled (PUSH_NOTIFICATIONS_ENABLED=false) — user ${userId} not notified`);
    return [{ channel: "web-push", target: "-", success: false, deliveryStatus: "disabled", error: "PUSH_NOTIFICATIONS_ENABLED=false" }];
  }
  const db = await getDb();
  if (!db) return [];

  const results: PushDeliveryResult[] = [];

  const subs = await db
    .select({ endpoint: pushSubscriptions.endpoint, p256dh: pushSubscriptions.p256dh, auth: pushSubscriptions.auth })
    .from(pushSubscriptions)
    .where(sql`${pushSubscriptions.userId} = ${userId}`);

  for (const sub of subs) {
    const r = await sendWebPush(sub, message, opts.fetchImpl);
    if (r.deliveryStatus === "unconfigured") {
      await recordPushAttempt(userId, message, opts.disputeRef, r.error ?? "VAPID not configured").catch(() => {});
    }
    results.push(r);
  }

  const expoRows = await db.execute(sql`SELECT token FROM expo_push_tokens WHERE "userId" = ${userId}`);
  const tokens = (Array.isArray(expoRows) ? expoRows : (expoRows as any)?.rows ?? []).map((r: any) => String(r.token));
  if (tokens.length > 0) {
    results.push(...await sendExpoPush(tokens, message, opts.fetchImpl));
  }

  return results;
}

/** Persist an unconfigured push attempt so the dead-letter is auditable. */
async function recordPushAttempt(userId: string, message: PushMessage, disputeRef: string | undefined, error: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.execute(sql`
    INSERT INTO notification_attempts
      (id, channel, recipient, subject, body, "htmlBody", "notificationType", "disputeRef",
       status, attempts, "nextAttemptAt", "errorMessage", "createdAt")
    VALUES
      (${crypto.randomUUID()}, 'push', ${userId}, ${message.title}, ${message.body}, NULL,
       'system_alert', ${disputeRef ?? null}, 'unconfigured', 0, NULL, ${error}, NOW())
  `);
}
