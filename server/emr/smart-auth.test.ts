/**
 * SMART Backend Services token acquisition — MOCK-VERIFIED.
 * Token endpoint + .well-known/smart-configuration are mocked; a real RSA
 * keypair is generated in-test so the RS384 assertion is genuinely signed.
 * No live vendor sandbox tested.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { generateKeyPairSync, createVerify } from "node:crypto";
import {
  getSmartBackendToken,
  buildClientAssertion,
  smartConfigFromCredentials,
  __clearSmartTokenCache,
  SmartAuthError,
} from "./smart-auth";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKeyPem = publicKey.export({ type: "pkcs1", format: "pem" }).toString();

const ENV = { SMART_BACKEND_SERVICES_ENABLED: "true" } as NodeJS.ProcessEnv;

const CFG = {
  clientId: "hp-test-client",
  privateKeyPem,
  kid: "test-kid-1",
  baseUrl: "https://fhir.example.test",
};

function mockFetch(handlers: Record<string, (init?: RequestInit) => { status?: number; body?: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    for (const [prefix, h] of Object.entries(handlers)) {
      if (u.startsWith(prefix)) {
        const r = h(init);
        const status = r.status ?? 200;
        return new Response(JSON.stringify(r.body ?? {}), { status });
      }
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("smart-auth (MOCK-VERIFIED)", () => {
  beforeEach(() => __clearSmartTokenCache());

  it("fails closed when SMART_BACKEND_SERVICES_ENABLED is not 'true'", async () => {
    await expect(getSmartBackendToken("c1", CFG, { env: {} as NodeJS.ProcessEnv })).rejects.toThrow(SmartAuthError);
  });

  it("discovers token endpoint via .well-known/smart-configuration and posts a valid RS384 assertion", async () => {
    const { fn, calls } = mockFetch({
      "https://fhir.example.test/.well-known/smart-configuration": () => ({
        body: { token_endpoint: "https://fhir.example.test/oauth/token" },
      }),
      "https://fhir.example.test/oauth/token": () => ({
        body: { access_token: "tok-abc", token_type: "Bearer", expires_in: 300, scope: "system/*.read" },
      }),
    });
    const token = await getSmartBackendToken("conn-1", CFG, { fetchFn: fn, env: ENV });
    expect(token.accessToken).toBe("tok-abc");
    expect(calls).toHaveLength(2);

    const body = new URLSearchParams(String(calls[1].init?.body));
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("client_assertion_type")).toBe("urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
    const assertion = body.get("client_assertion")!;
    const [h, p, sig] = assertion.split(".");
    const header = JSON.parse(Buffer.from(h, "base64url").toString());
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(header.alg).toBe("RS384");
    expect(header.kid).toBe("test-kid-1");
    expect(payload.iss).toBe("hp-test-client");
    expect(payload.sub).toBe("hp-test-client");
    expect(payload.aud).toBe("https://fhir.example.test/oauth/token");
    expect(payload.exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(300);
    const verifier = createVerify("RSA-SHA384");
    verifier.update(`${h}.${p}`);
    expect(verifier.verify(publicKeyPem, Buffer.from(sig, "base64url"))).toBe(true);
  });

  it("caches tokens and refreshes after expiry", async () => {
    let tokenCalls = 0;
    const { fn } = mockFetch({
      "https://fhir.example.test/oauth/token": () => {
        tokenCalls++;
        return { body: { access_token: `tok-${tokenCalls}`, expires_in: 300 } };
      },
    });
    const cfg = { ...CFG, tokenEndpoint: "https://fhir.example.test/oauth/token" };
    const t1 = await getSmartBackendToken("conn-2", cfg, { fetchFn: fn, env: ENV });
    const t2 = await getSmartBackendToken("conn-2", cfg, { fetchFn: fn, env: ENV });
    expect(t2.accessToken).toBe(t1.accessToken);
    expect(tokenCalls).toBe(1);
  });

  it("uses the explicit tokenEndpoint without discovery", async () => {
    const { fn, calls } = mockFetch({
      "https://auth.example.test/token": () => ({ body: { access_token: "tok-x", expires_in: 120 } }),
    });
    const t = await getSmartBackendToken("conn-3", { ...CFG, tokenEndpoint: "https://auth.example.test/token" }, { fetchFn: fn, env: ENV });
    expect(t.accessToken).toBe("tok-x");
    expect(calls.every(c => !c.url.includes("smart-configuration"))).toBe(true);
  });

  it("surfaces token endpoint errors without leaking the assertion", async () => {
    const { fn } = mockFetch({
      "https://fhir.example.test/oauth/token": () => ({ status: 401, body: { error: "invalid_client" } }),
    });
    const cfg = { ...CFG, tokenEndpoint: "https://fhir.example.test/oauth/token" };
    await expect(getSmartBackendToken("conn-4", cfg, { fetchFn: fn, env: ENV })).rejects.toThrow(/HTTP 401/);
  });

  it("smartConfigFromCredentials returns null without smart keys (honest)", () => {
    expect(smartConfigFromCredentials({ apiKey: "x" })).toBeNull();
    const cfg = smartConfigFromCredentials({ smartClientId: "c", smartPrivateKeyPem: "pem", smartTokenEndpoint: "https://t" }, "https://b");
    expect(cfg?.clientId).toBe("c");
    expect(cfg?.tokenEndpoint).toBe("https://t");
    expect(cfg?.baseUrl).toBe("https://b");
  });

  it("buildClientAssertion embeds a unique jti per call", () => {
    const a = buildClientAssertion(CFG, "https://t");
    const b = buildClientAssertion(CFG, "https://t");
    const jti = (x: string) => JSON.parse(Buffer.from(x.split(".")[1], "base64url").toString()).jti;
    expect(jti(a)).not.toBe(jti(b));
  });
});
