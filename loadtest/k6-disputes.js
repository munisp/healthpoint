// k6 load test: dispute create + advance (tRPC via gateway) + ML fraud score.
//
// Path: k6 -> Caddy/APISIX (BASE_URL) -> app (tRPC disputes router)
//       k6 -> Caddy/APISIX (BASE_URL) -> ml-service (/api/ml/* -> :8100)
//
// Auth: Authorization: Bearer $AUTH_TOKEN (Keycloak access token).
// This script has NOT been run yet — see loadtest/README.md.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const BASE_URL = (__ENV.BASE_URL || 'https://localhost').replace(/\/$/, '');
const AUTH_TOKEN = __ENV.AUTH_TOKEN || '';
const TENANT_ID = __ENV.TENANT_ID || 'loadtest-tenant';

export const options = {
  vus: parseInt(__ENV.VUS || '10', 10),
  duration: __ENV.DURATION || '30s',
  insecureSkipTLSVerify: (__ENV.INSECURE_TLS || 'true') === 'true',
  thresholds: {
    // Intentionally loose defaults — these are smoke gates, not SLAs.
    // Tighten after the first measured runs (see README: no TPS numbers yet).
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<2000'],
  },
};

const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${AUTH_TOKEN}`,
  'X-Tenant-Id': TENANT_ID,
};

const createLat = new Trend('dispute_create_duration', true);
const advanceLat = new Trend('dispute_advance_duration', true);
const fraudLat = new Trend('fraud_score_duration', true);
const createFail = new Counter('dispute_create_failures');
const advanceFail = new Counter('dispute_advance_failures');
const fraudFail = new Counter('fraud_score_failures');

// tRPC-over-HTTP endpoints (batching disabled; one procedure per call).
// Adjust the router prefix if server/ mounts it elsewhere.
const TRPC = `${BASE_URL}/api/trpc`;

function createDispute() {
  const payload = {
    transactionId: uuidv4(),
    amount: (Math.random() * 500 + 1).toFixed(2),
    currency: 'USD',
    reasonCode: 'fraud',
    cardholderId: `ch-${Math.floor(Math.random() * 100000)}`,
    merchantId: `m-${Math.floor(Math.random() * 10000)}`,
    source: 'k6-loadtest',
  };
  const res = http.post(`${TRPC}/disputes.create`, JSON.stringify(payload),
    { headers, tags: { endpoint: 'disputes.create' } });
  createLat.add(res.timings.duration);
  const ok = check(res, { 'dispute created (2xx)': (r) => r.status >= 200 && r.status < 300 });
  if (!ok) createFail.add(1);
  let id = null;
  try {
    const body = res.json();
    id = body && body.result && body.result.data &&
      (body.result.data.id || body.result.data.disputeId);
  } catch (_) { /* non-JSON error body */ }
  return id;
}

function advanceDispute(disputeId) {
  const payload = { id: disputeId, action: 'advance', note: 'k6 load test transition' };
  const res = http.post(`${TRPC}/disputes.advance`, JSON.stringify(payload),
    { headers, tags: { endpoint: 'disputes.advance' } });
  advanceLat.add(res.timings.duration);
  const ok = check(res, { 'dispute advanced (2xx)': (r) => r.status >= 200 && r.status < 300 });
  if (!ok) advanceFail.add(1);
}

function fraudScore() {
  const payload = {
    features: [Math.random(), Math.random(), Math.random(), Math.random(),
               Math.random(), Math.random(), Math.random(), Math.random()],
    request_key: uuidv4(),
  };
  const res = http.post(`${BASE_URL}/api/ml/fraud/score`, JSON.stringify(payload),
    { headers, tags: { endpoint: 'ml.fraud.score' } });
  fraudLat.add(res.timings.duration);
  const ok = check(res, { 'fraud scored (2xx)': (r) => r.status >= 200 && r.status < 300 });
  if (!ok) fraudFail.add(1);
}

export default function () {
  const id = createDispute();
  if (id) advanceDispute(id);
  fraudScore();
  sleep(0.5); // think time — keeps the mix realistic vs a pure hammer
}
