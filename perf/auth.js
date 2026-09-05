// perf/auth.js — k6 load suite: token acquisition + authenticated probe.
//
// Flow: fetch a Bearer token from Keycloak (direct access grant), then call the
// cheapest authenticated tRPC endpoint (system.health) with it.
//
// Budgets enforced (see perf/BUDGETS.md):
//   - token fetch p95 < 500 ms
//   - authenticated read p95 < 300 ms
//   - error rate < 0.1%
//
// Required env:
//   BASE_URL        e.g. https://staging.healthpoint.example (no trailing slash)
//   KC_URL          e.g. https://keycloak.staging.example (no trailing slash)
//   KC_REALM        default: healthpoint
//   KC_CLIENT_ID    default: healthpoint-app
//   KC_CLIENT_SECRET  (if the client is confidential)
//   KC_USERNAME / KC_PASSWORD   load-test user credentials (password grant)
// Optional env:
//   RPS (default 10), DURATION (default 1m)
import http from "k6/http";
import { check } from "k6";
import { Rate, Trend } from "k6/metrics";

const tokenDuration = new Trend("auth_token_duration", true);
const authedReadDuration = new Trend("auth_authed_read_duration", true);
const failures = new Rate("auth_failures");

export const options = {
  scenarios: {
    auth_flow: {
      executor: "constant-arrival-rate",
      rate: Number(__ENV.RPS ?? 10),
      timeUnit: "1s",
      duration: __ENV.DURATION ?? "1m",
      preAllocatedVUs: 20,
      maxVUs: 100,
    },
  },
  thresholds: {
    auth_token_duration: ["p(95)<500"],
    auth_authed_read_duration: ["p(95)<300"],
    auth_failures: ["rate<0.001"],
    http_req_failed: ["rate<0.001"],
  },
};

const BASE_URL = (__ENV.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const KC_URL = (__ENV.KC_URL ?? "http://localhost:8080").replace(/\/$/, "");
const KC_REALM = __ENV.KC_REALM ?? "healthpoint";
const KC_CLIENT_ID = __ENV.KC_CLIENT_ID ?? "healthpoint-app";

function fetchToken() {
  const body = {
    grant_type: "password",
    client_id: KC_CLIENT_ID,
    username: __ENV.KC_USERNAME ?? "",
    password: __ENV.KC_PASSWORD ?? "",
  };
  if (__ENV.KC_CLIENT_SECRET) body.client_secret = __ENV.KC_CLIENT_SECRET;
  const res = http.post(
    `${KC_URL}/realms/${KC_REALM}/protocol/openid-connect/token`,
    body,
    { headers: { "Content-Type": "application/x-www-form-urlencoded" }, tags: { name: "keycloak_token" } }
  );
  tokenDuration.add(res.timings.duration);
  const ok = check(res, { "token 200": r => r.status === 200 });
  failures.add(!ok);
  if (!ok) return null;
  return res.json("access_token");
}

export default function () {
  const token = fetchToken();
  if (!token) return;

  const input = encodeURIComponent(JSON.stringify({ json: { timestamp: Date.now() } }));
  const res = http.get(`${BASE_URL}/api/trpc/system.health?input=${input}`, {
    headers: { Authorization: `Bearer ${token}` },
    tags: { name: "authed_health_probe" },
  });
  authedReadDuration.add(res.timings.duration);
  const ok = check(res, { "authed read 200": r => r.status === 200 });
  failures.add(!ok);
}
