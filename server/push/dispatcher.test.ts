/**
 * server/push/dispatcher.test.ts — Phase 15 FB (A1)
 *
 * MOCK-VERIFIED: all HTTP transport is a mocked fetch; no push service is
 * contacted. The RFC 8291 aes128gcm payload encryption is verified by a real
 * decrypt round-trip (the test plays the push service + subscriber), so the
 * crypto is EXECUTED-VERIFIED while delivery itself remains MOCK-VERIFIED.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import {
  sendWebPush,
  sendExpoPush,
  encryptWebPushPayload,
  getVapidConfig,
} from "./dispatcher";

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/** Decrypt an aes128gcm web-push body as the subscriber would (test-only mirror of RFC 8291). */
function decryptWebPushBody(body: Buffer, subscriberPriv: crypto.ECDH, uaPublic: Buffer, authSecret: Buffer): string {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  const shared = subscriberPriv.computeSecret(asPublic);
  const hmac = (key: Buffer, data: Buffer) => crypto.createHmac("sha256", key).update(data).digest();
  const prkKey = hmac(authSecret, shared);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0", "utf8"), uaPublic, asPublic]);
  const ikm = hmac(prkKey, Buffer.concat([keyInfo, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: aes128gcm\0"), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: nonce\0"), Buffer.from([1])])).subarray(0, 12);
  const tag = ciphertext.subarray(ciphertext.length - 16);
  const decipher = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  expect(plain[plain.length - 1]).toBe(0x02); // single-record padding delimiter
  return plain.subarray(0, plain.length - 1).toString("utf8");
}

describe("push dispatcher (MOCK-VERIFIED transport)", () => {
  const savedEnv = { ...process.env };
  beforeEach(() => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  });
  afterEach(() => {
    process.env = { ...savedEnv };
    vi.restoreAllMocks();
  });

  it("reports unconfigured (never fakes delivery) when VAPID keys are absent", async () => {
    const fetchMock = vi.fn();
    const r = await sendWebPush({ endpoint: "https://push.example.com/sub/abc", p256dh: "x", auth: "y" }, { title: "t", body: "b" }, fetchMock as any);
    expect(r.success).toBe(false);
    expect(r.deliveryStatus).toBe("unconfigured");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getVapidConfig()).toBeNull();
  });

  it("sends a real VAPID-signed, aes128gcm-encrypted request (decrypt round-trip verifies crypto)", async () => {
    // Generate a VAPID keypair
    const vapid = crypto.createECDH("prime256v1");
    vapid.generateKeys();
    process.env.VAPID_PUBLIC_KEY = b64url(vapid.getPublicKey());
    process.env.VAPID_PRIVATE_KEY = b64url(vapid.getPrivateKey());

    // Generate a subscriber keypair + auth secret
    const subscriber = crypto.createECDH("prime256v1");
    subscriber.generateKeys();
    const uaPublic = subscriber.getPublicKey();
    const authSecret = crypto.randomBytes(16);

    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 201 }));
    const message = { title: "Deadline", body: "IDR initiation due", data: { disputeId: "d-1" } };
    const r = await sendWebPush(
      { endpoint: "https://push.example.com/sub/abc", p256dh: b64url(uaPublic), auth: b64url(authSecret) },
      message,
      fetchMock as any,
    );
    expect(r.deliveryStatus).toBe("delivered");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { body: Uint8Array }];
    expect(url).toBe("https://push.example.com/sub/abc");
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Encoding"]).toBe("aes128gcm");
    expect(headers.Authorization).toMatch(/^vapid t=.+, k=/);
    // Verify the VAPID JWT signature against the public key
    const jwt = headers.Authorization.match(/^vapid t=([^,]+)/)![1];
    const [h, p, s] = jwt.split(".");
    const pub = vapid.getPublicKey();
    const verifyKey = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33, 65)) }, format: "jwk" });
    expect(crypto.verify("sha256", Buffer.from(`${h}.${p}`), { key: verifyKey, dsaEncoding: "ieee-p1363" }, fromB64url(s))).toBe(true);
    expect(JSON.parse(Buffer.from(p, "base64url").toString()).aud).toBe("https://push.example.com");
    // Decrypt the body as the subscriber would
    const decrypted = decryptWebPushBody(Buffer.from(init.body), subscriber, uaPublic, authSecret);
    expect(JSON.parse(decrypted)).toEqual({ title: message.title, body: message.body, data: message.data });
  });

  it("reports failed delivery on non-2xx push service response", async () => {
    const vapid = crypto.createECDH("prime256v1");
    vapid.generateKeys();
    process.env.VAPID_PUBLIC_KEY = b64url(vapid.getPublicKey());
    process.env.VAPID_PRIVATE_KEY = b64url(vapid.getPrivateKey());
    const subscriber = crypto.createECDH("prime256v1");
    subscriber.generateKeys();
    const fetchMock = vi.fn().mockResolvedValue(new Response("gone", { status: 410 }));
    const r = await sendWebPush(
      { endpoint: "https://push.example.com/sub/old", p256dh: b64url(subscriber.getPublicKey()), auth: b64url(crypto.randomBytes(16)) },
      { title: "t", body: "b" },
      fetchMock as any,
    );
    expect(r.success).toBe(false);
    expect(r.deliveryStatus).toBe("failed");
    expect(r.error).toContain("410");
  });

  it("encryptWebPushPayload rejects malformed subscriber keys", () => {
    expect(() => encryptWebPushPayload("{}", "AAAA", b64url(crypto.randomBytes(16)))).toThrow(/p256dh/);
  });

  it("posts to the Expo push API and maps per-token receipts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ status: "ok" }, { status: "error", message: "DeviceNotRegistered" }] }), { status: 200 }));
    const results = await sendExpoPush(["ExponentPushToken[aaa]", "ExponentPushToken[bbb]"], { title: "t", body: "b" }, fetchMock as any);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://exp.host/--/api/v2/push/send");
    const sent = JSON.parse(init.body as string);
    expect(sent).toHaveLength(2);
    expect(sent[0].to).toBe("ExponentPushToken[aaa]");
    expect(results[0].deliveryStatus).toBe("delivered");
    expect(results[1].deliveryStatus).toBe("failed");
    expect(results[1].error).toContain("DeviceNotRegistered");
  });

  it("marks all Expo targets failed when the API errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("boom", { status: 502 }));
    const results = await sendExpoPush(["ExponentPushToken[aaa]"], { title: "t", body: "b" }, fetchMock as any);
    expect(results[0].deliveryStatus).toBe("failed");
    expect(results[0].error).toContain("502");
  });
});
