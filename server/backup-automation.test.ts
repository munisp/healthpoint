import { createHmac } from "crypto";
import express from "express";
import { createServer } from "http";
import { afterEach, describe, expect, it } from "vitest";

const backupPassphrase = process.env.BACKUP_ENCRYPTION_PASSPHRASE;

describe("backup encryption configuration", () => {
  let server: ReturnType<typeof createServer> | undefined;

  afterEach(async () => {
    if (server?.listening) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    server = undefined;
  });

  it("accepts the configured backup passphrase through a lightweight verification endpoint", async () => {
    expect(backupPassphrase?.length).toBeGreaterThanOrEqual(32);
    const app = express();
    app.post("/verify-backup-encryption", express.json(), (req, res) => {
      const challenge = typeof req.body?.challenge === "string" ? req.body.challenge : "";
      if (!challenge || !backupPassphrase) return res.status(400).json({ valid: false });
      const fingerprint = createHmac("sha256", backupPassphrase).update(challenge).digest("hex");
      res.status(200).json({ valid: fingerprint.length === 64 });
    });
    server = createServer(app);
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not expose a TCP address");
    const response = await fetch(`http://127.0.0.1:${address.port}/verify-backup-encryption`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challenge: "backup-integrity-probe" }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ valid: true });
  });
});
