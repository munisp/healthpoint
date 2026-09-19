// k6 load test: settlement intent endpoints via the gateway.
//
// Path: k6 -> Caddy/APISIX (BASE_URL) -> app settlement router.
// NOTE: payment execution is fail-closed (PAYMENT_EXECUTION_MODE=disabled)
// in the dev topology — expect non-2xx on execution paths there; that is
// correct fail-closed behavior, not a harness bug (see README guardrails).
// Auth: Authorization: Bearer $AUTH_TOKEN.
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
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<2000'],
  },
};

const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${AUTH_TOKEN}`,
  'X-Tenant-Id': TENANT_ID,
};

const intentLat = new Trend('settlement_intent_duration', true);
const statusLat = new Trend('settlement_status_duration', true);
const intentFail = new Counter('settlement_intent_failures');
const statusFail = new Counter('settlement_status_failures');

const TRPC = `${BASE_URL}/api/trpc`;

function createIntent() {
  const payload = {
    intentId: uuidv4(),
    amount: (Math.random() * 1000 + 1).toFixed(2),
    currency: 'USD',
    debtorAccount: `acct-${Math.floor(Math.random() * 100000)}`,
    creditorAccount: `acct-${Math.floor(Math.random() * 100000)}`,
    source: 'k6-loadtest',
  };
  const res = http.post(`${TRPC}/settlement.createIntent`, JSON.stringify(payload),
    { headers, tags: { endpoint: 'settlement.createIntent' } });
  intentLat.add(res.timings.duration);
  const ok = check(res, {
    'intent accepted (2xx) or fail-closed (4xx/5xx in dev)': (r) => r.status < 600,
  });
  if (!ok) intentFail.add(1);
  let id = null;
  try {
    const body = res.json();
    id = body && body.result && body.result.data && body.result.data.id;
  } catch (_) { /* non-JSON error body */ }
  return id;
}

function pollStatus(intentId) {
  const res = http.get(
    `${TRPC}/settlement.getIntent?input=${encodeURIComponent(JSON.stringify({ id: intentId }))}`,
    { headers, tags: { endpoint: 'settlement.getIntent' } });
  statusLat.add(res.timings.duration);
  const ok = check(res, { 'status query answered': (r) => r.status < 600 });
  if (!ok) statusFail.add(1);
}

export default function () {
  const id = createIntent();
  if (id) pollStatus(id);
  sleep(0.5);
}
