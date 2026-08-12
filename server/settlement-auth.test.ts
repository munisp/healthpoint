import express from "express";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  SETTLEMENT_SIGNATURE_HEADER,
  SETTLEMENT_TIMESTAMP_HEADER,
  signSettlementCallback,
  verifySettlementCallbackSignature,
} from "./settlement-auth";

const secret = process.env.SETTLEMENT_CALLBACK_SECRET;

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
    app.post("/verify-settlement-callback", express.raw({ type: "application/json" }), (req, res) => {
      const result = verifySettlementCallbackSignature({
        secret,
        timestamp: req.header(SETTLEMENT_TIMESTAMP_HEADER) ?? undefined,
        signature: req.header(SETTLEMENT_SIGNATURE_HEADER) ?? undefined,
        rawBody: (req.body as Buffer).toString("utf8"),
      });
      res.status(result.valid ? 200 : 401).json(result);
    });
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
});
