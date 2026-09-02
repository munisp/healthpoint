import express from "express";
import rateLimit from "express-rate-limit";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseSettlementCallbackKeyring,
  SETTLEMENT_KEY_ID_HEADER,
  SETTLEMENT_SIGNATURE_HEADER,
  SETTLEMENT_TIMESTAMP_HEADER,
  signSettlementCallback,
  verifySettlementCallbackSignature,
} from "./settlement-auth";
import {
  parseSettlementMtlsFingerprints,
  SETTLEMENT_MTLS_FINGERPRINT_HEADER,
  SETTLEMENT_MTLS_INGRESS_TOKEN_HEADER,
  SETTLEMENT_MTLS_VERIFIED_HEADER,
  verifySettlementMtls,
} from "./settlement-mtls";

const secret = "test-settlement-secret-at-least-thirty-two-characters";
const keyring = parseSettlementCallbackKeyring(JSON.stringify({ current: secret, prior: "prior-settlement-secret-at-least-thirty-two-chars" }));
const fingerprints = parseSettlementMtlsFingerprints("a".repeat(64));
const ingressToken = "test-mtls-ingress-token-at-least-thirty-two-chars";

describe("settlement callback signature verification", () => {
  let server: ReturnType<typeof createServer> | undefined;

  afterEach(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    }
    server = undefined;
  });

  it("accepts a correctly signed callback through an HTTP endpoint using the configured secret", async () => {
    expect(secret).toBeTruthy();
    const app = express();
    app.post(
      "/verify-settlement-callback",
      rateLimit({ windowMs: 60_000, max: 20, standardHeaders: false, legacyHeaders: false }),
      express.raw({ type: "application/json" }),
      (req, res) => {
        const result = verifySettlementCallbackSignature({
          secret,
          timestamp: req.header(SETTLEMENT_TIMESTAMP_HEADER) ?? undefined,
          signature: req.header(SETTLEMENT_SIGNATURE_HEADER) ?? undefined,
          rawBody: (req.body as Buffer).toString("utf8"),
        });
        res.status(result.valid ? 200 : 401).json(result);
      },
    );
    server = createServer(app);
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not expose a TCP address");

    const body = JSON.stringify({ eventId: "33d58df0-5f06-43cf-aed7-89e99846d6e1", status: "settled" });
    const timestamp = String(Date.now());
    const response = await fetch(`http://127.0.0.1:${address.port}/verify-settlement-callback`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [SETTLEMENT_TIMESTAMP_HEADER]: timestamp,
        [SETTLEMENT_SIGNATURE_HEADER]: signSettlementCallback(secret!, timestamp, body),
      },
      body,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ valid: true });
  });

  it("rejects a tampered body, invalid signature, or stale timestamp", () => {
    const timestamp = String(Date.now());
    const body = '{"status":"settled"}';
    expect(verifySettlementCallbackSignature({
      secret,
      timestamp,
      signature: signSettlementCallback(secret!, timestamp, '{"status":"failed"}'),
      rawBody: body,
    })).toMatchObject({ valid: false });
    expect(verifySettlementCallbackSignature({
      secret,
      timestamp: String(Date.now() - 10 * 60 * 1000),
      signature: signSettlementCallback(secret!, String(Date.now() - 10 * 60 * 1000), body),
      rawBody: body,
    })).toMatchObject({ valid: false });
  });

  it("accepts a configured current or prior key during a key-rotation overlap and rejects unknown key IDs", () => {
    expect(keyring).toBeTruthy();
    const timestamp = String(Date.now());
    const body = '{"status":"settled"}';
    const [currentKeyId, currentSecret] = Object.entries(keyring!)[0];
    const verification = verifySettlementCallbackSignature({
      secret: undefined,
      keyring,
      keyId: currentKeyId,
      timestamp,
      signature: signSettlementCallback(currentSecret, timestamp, body),
      rawBody: body,
    });
    expect(verification).toEqual({ valid: true });
    expect(verifySettlementCallbackSignature({
      secret: undefined,
      keyring,
      keyId: "retired-or-unknown-key",
      timestamp,
      signature: signSettlementCallback(currentSecret, timestamp, body),
      rawBody: body,
    })).toMatchObject({ valid: false });
    expect(SETTLEMENT_KEY_ID_HEADER).toBe("x-settlement-key-id");
  });

  it("accepts the configured trusted ingress token and provider fingerprint through an HTTP endpoint", async () => {
    expect(fingerprints).toHaveLength(1);
    expect(ingressToken).toBeTruthy();
    const app = express();
    app.post(
      "/verify-mtls",
      rateLimit({ windowMs: 60_000, max: 20, standardHeaders: false, legacyHeaders: false }),
      (req, res) => {
        const result = verifySettlementMtls({
          required: true,
          verifiedHeader: req.header(SETTLEMENT_MTLS_VERIFIED_HEADER) ?? undefined,
          fingerprintHeader: req.header(SETTLEMENT_MTLS_FINGERPRINT_HEADER) ?? undefined,
          ingressTokenHeader: req.header(SETTLEMENT_MTLS_INGRESS_TOKEN_HEADER) ?? undefined,
          expectedIngressToken: ingressToken,
          allowedFingerprints: fingerprints,
        });
        res.status(result.valid ? 200 : 401).json(result);
      },
    );
    server = createServer(app);
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not expose a TCP address");
    const response = await fetch(`http://127.0.0.1:${address.port}/verify-mtls`, {
      method: "POST",
      headers: {
        [SETTLEMENT_MTLS_VERIFIED_HEADER]: "true",
        [SETTLEMENT_MTLS_FINGERPRINT_HEADER]: fingerprints[0],
        [SETTLEMENT_MTLS_INGRESS_TOKEN_HEADER]: ingressToken!,
      },
    });
    expect(response.status).toBe(200);
    expect(verifySettlementMtls({
      required: true,
      verifiedHeader: "true",
      fingerprintHeader: "B".repeat(64),
      ingressTokenHeader: ingressToken,
      expectedIngressToken: ingressToken,
      allowedFingerprints: fingerprints,
    })).toMatchObject({ valid: false });
  });
});
