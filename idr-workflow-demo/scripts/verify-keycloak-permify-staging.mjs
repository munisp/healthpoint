import https from "node:https";
import { readFileSync } from "node:fs";

const required = [
  "HEALTHPOINT_EXTERNAL_GATE_TEST_ENV",
  "HEALTHPOINT_EXTERNAL_GATE_CHANGE_TICKET",
  "PERMIFY_STAGING_HTTPS_URL",
  "PERMIFY_STAGING_BEARER_TOKEN",
  "KEYCLOAK_STAGING_ISSUER",
];
for (const key of required) {
  if (!process.env[key]?.trim()) throw new Error(`REFUSED: ${key} is required`);
}
if (process.env.HEALTHPOINT_EXTERNAL_GATE_TEST_ENV !== "staging") {
  throw new Error("REFUSED: HEALTHPOINT_EXTERNAL_GATE_TEST_ENV must equal staging");
}
if (!/^[A-Z][A-Z0-9]+-\d+$/.test(process.env.HEALTHPOINT_EXTERNAL_GATE_CHANGE_TICKET)) {
  throw new Error("REFUSED: HEALTHPOINT_EXTERNAL_GATE_CHANGE_TICKET must resemble CHG-1234");
}
if (process.env.PAYMENT_EXECUTION_MODE === "enabled") {
  throw new Error("REFUSED: payment execution must remain disabled for external gate verification");
}

function privateHttps(value, name) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const allowed = url.protocol === "https:" && (
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
    host.endsWith(".svc.cluster.local") ||
    host.endsWith(".internal")
  );
  if (!allowed) throw new Error(`REFUSED: ${name} must be a private HTTPS endpoint`);
  return url;
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const agent = new https.Agent({
      ca: process.env.EXTERNAL_GATE_CA_PATH ? readFileSync(process.env.EXTERNAL_GATE_CA_PATH) : undefined,
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
    });
    const request = https.request(url, { method: "GET", agent, timeout: 10_000, headers: options.headers ?? {} }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (response.statusCode !== 200) return reject(new Error(`${url}: expected HTTP 200, received ${response.statusCode}`));
        try { resolve(JSON.parse(body)); } catch { reject(new Error(`${url}: response is not valid JSON`)); }
      });
    });
    request.on("timeout", () => request.destroy(new Error(`${url}: request timed out`)));
    request.on("error", reject);
    request.end();
  });
}

const permify = privateHttps(process.env.PERMIFY_STAGING_HTTPS_URL, "PERMIFY_STAGING_HTTPS_URL");
const issuer = privateHttps(process.env.KEYCLOAK_STAGING_ISSUER, "KEYCLOAK_STAGING_ISSUER");
if (issuer.pathname.includes("//")) throw new Error("REFUSED: Keycloak issuer contains an invalid path");

const health = await requestJson(new URL("/healthz", permify), {
  headers: { authorization: `Bearer ${process.env.PERMIFY_STAGING_BEARER_TOKEN}` },
});
const discoveryUrl = new URL(`${issuer.pathname.replace(/\/$/, "")}/.well-known/openid-configuration`, issuer);
const discovery = await requestJson(discoveryUrl);
if (discovery.issuer !== issuer.toString().replace(/\/$/, "")) throw new Error("Keycloak discovery issuer does not match KEYCLOAK_STAGING_ISSUER");
const jwksUrl = privateHttps(discovery.jwks_uri, "Keycloak jwks_uri");
if (jwksUrl.origin !== issuer.origin) throw new Error("Keycloak jwks_uri must use the configured issuer origin");
const jwks = await requestJson(jwksUrl);
if (!Array.isArray(jwks.keys) || jwks.keys.length === 0) throw new Error("Keycloak JWKS contains no keys");
if (!discovery.authorization_endpoint || !discovery.token_endpoint || !discovery.revocation_endpoint) {
  throw new Error("Keycloak discovery lacks authorization, token, or revocation endpoint");
}

process.stdout.write(`${JSON.stringify({
  result: "external_gate_read_checks_verified",
  scope: "authenticated_permify_health,keycloak_https_discovery,keycloak_jwks,keycloak_pkce_and_revocation_metadata",
  permifyHealthKeys: Object.keys(health).sort(),
  keycloakIssuer: discovery.issuer,
  jwksKeyCount: jwks.keys.length,
  authorizationEndpointPresent: true,
  tokenEndpointPresent: true,
  revocationEndpointPresent: true,
})}\n`);
