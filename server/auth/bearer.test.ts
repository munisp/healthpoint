import express from "express";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import {
  BearerAuthError,
  bearerClaimsToPrincipal,
  requireApiAuth,
  resetJwksCacheForTests,
  verifyBearerToken,
  type BearerAuthConfig,
} from "./bearer";

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;

describe("Keycloak bearer token verification", () => {
  let jwksServer: Server;
  let issuer: string;
  let config: BearerAuthConfig;
  let keyPair: KeyPair;
  let otherKeyPair: KeyPair;

  beforeAll(async () => {
    keyPair = await generateKeyPair("RS256");
    otherKeyPair = await generateKeyPair("RS256");

    const publicJwk = await exportJWK(keyPair.publicKey);
    publicJwk.kid = "test-key";
    publicJwk.alg = "RS256";
    publicJwk.use = "sig";

    const app = express();
    app.get("/realms/test/protocol/openid-connect/certs", (_req, res) => {
      res.json({ keys: [publicJwk] });
    });
    jwksServer = createServer(app);
    await new Promise<void>(resolve => jwksServer.listen(0, "127.0.0.1", resolve));
    const address = jwksServer.address();
    if (!address || typeof address === "string") throw new Error("test server did not expose a TCP address");
    issuer = `http://127.0.0.1:${address.port}/realms/test`;
    config = {
      issuer,
      jwksUri: `${issuer}/protocol/openid-connect/certs`,
      audiences: ["healthpoint-app", "healthpoint-backend"],
      clockToleranceSeconds: 60,
      jwksCacheTtlMs: 60_000,
    };
    resetJwksCacheForTests();
  });

  afterAll(async () => {
    resetJwksCacheForTests();
    await new Promise<void>((resolve, reject) =>
      jwksServer.close(err => (err ? reject(err) : resolve()))
    );
  });

  async function signToken(
    claims: Record<string, unknown> = {},
    options: { key?: KeyPair["privateKey"]; issuer?: string; expiresInSeconds?: number; kid?: string } = {}
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      sub: "user-123",
      name: "Mobile User",
      email: "mobile@example.com",
      realm_access: { roles: ["provider", "user"] },
      azp: "healthpoint-app",
      ...claims,
    })
      .setProtectedHeader({ alg: "RS256", kid: options.kid ?? "test-key" })
      .setIssuer(options.issuer ?? issuer)
      .setIssuedAt(now)
      .setExpirationTime(now + (options.expiresInSeconds ?? 300))
      .sign(options.key ?? keyPair.privateKey);
  }

  it("accepts a valid RS256 token and maps realm roles to the principal", async () => {
    const token = await signToken();
    const principal = await verifyBearerToken(token, config);
    expect(principal.sub).toBe("user-123");
    expect(principal.email).toBe("mobile@example.com");
    expect(principal.realmRoles).toContain("provider");
    expect(principal.isAdmin).toBe(false);
  });

  it("maps the realm admin role onto isAdmin (same role shape as session auth)", async () => {
    const token = await signToken({ realm_access: { roles: ["admin", "user"] } });
    const principal = await verifyBearerToken(token, config);
    expect(principal.isAdmin).toBe(true);
  });

  it("rejects a token signed with a different key", async () => {
    const token = await signToken({}, { key: otherKeyPair.privateKey });
    await expect(verifyBearerToken(token, config)).rejects.toThrow(BearerAuthError);
  });

  it("rejects a token with an unknown key id", async () => {
    const token = await signToken({}, { kid: "unknown-key" });
    await expect(verifyBearerToken(token, config)).rejects.toThrow(BearerAuthError);
  });

  it("rejects a token whose audience/azp is not accepted", async () => {
    const token = await signToken({ azp: "evil-client", aud: "account" });
    await expect(verifyBearerToken(token, config)).rejects.toThrow(/audience/);
  });

  it("accepts a token when an allowed audience is in the aud claim", async () => {
    const token = await signToken({ azp: "evil-client", aud: ["account", "healthpoint-backend"] });
    const principal = await verifyBearerToken(token, config);
    expect(principal.sub).toBe("user-123");
  });

  it("rejects an expired token (beyond clock tolerance)", async () => {
    const token = await signToken({}, { expiresInSeconds: -300 });
    await expect(verifyBearerToken(token, config)).rejects.toThrow(BearerAuthError);
  });

  it("rejects a token from the wrong issuer", async () => {
    const token = await signToken({}, { issuer: "http://evil.example.com/realms/test" });
    await expect(verifyBearerToken(token, config)).rejects.toThrow(BearerAuthError);
  });

  it("bearerClaimsToPrincipal returns null without a subject claim", () => {
    expect(bearerClaimsToPrincipal({})).toBeNull();
  });
});

describe("requireApiAuth middleware", () => {
  let server: Server | undefined;

  afterAll(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => server!.close(err => (err ? reject(err) : resolve())));
    }
  });

  it("responds 401 without credentials and rejects an invalid bearer token without fall-through", async () => {
    const app = express();
    app.get("/protected", requireApiAuth(), (_req, res) => res.json({ ok: true }));
    server = createServer(app);
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not expose a TCP address");
    const url = `http://127.0.0.1:${address.port}/protected`;

    const anon = await fetch(url);
    expect(anon.status).toBe(401);

    const badToken = await fetch(url, { headers: { authorization: "Bearer not-a-jwt" } });
    expect(badToken.status).toBe(401);
  });
});
