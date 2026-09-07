// perf/payments.js — k6 load suite: payment-create → status poll.
//
// Flow (per iteration):
//   1. POST /api/trpc/ledger.recordPayment  (superjson body: {"json": {...}})
//      with a unique idempotency key per iteration
//   2. GET  /api/trpc/ledger.history        (poll the posted dispute's ledger)
//
// Budgets enforced (see perf/BUDGETS.md):
//   - payment-create p95 < 800 ms at 50 RPS
//   - ledger read (poll) p95 < 300 ms
//   - error rate < 0.1%
//
// Required env:
//   BASE_URL         e.g. https://staging.healthpoint.example
//   ACCESS_TOKEN     a valid Bearer token for a user with write access to the
//                    dispute below (mint one via Keycloak; see perf/auth.js)
//   LOAD_DISPUTE_ID  a dispute seeded for load testing at STEP_14+ with a
//                    determinationAmount large enough to absorb the run
//                    (e.g. 99999999.00) — see perf/BUDGETS.md "Prerequisites"
// Optional env:
//   RPS (default 50), DURATION (default 2m)
import http from "k6/http";
import { check } from "k6";
import { Rate, Trend } from "k6/metrics";

const paymentCreateDuration = new Trend("payment_create_duration", true);
const paymentPollDuration = new Trend("payment_poll_duration", true);
const failures = new Rate("payment_failures");

export const options = {
  scenarios: {
    payment_create: {
      executor: "constant-arrival-rate",
      rate: Number(__ENV.RPS ?? 50),
      timeUnit: "1s",
      duration: __ENV.DURATION ?? "2m",
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
  },
  thresholds: {
    payment_create_duration: ["p(95)<800"],
    payment_poll_duration: ["p(95)<300"],
    payment_failures: ["rate<0.001"],
    http_req_failed: ["rate<0.001"],
  },
};

const BASE_URL = (__ENV.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const DISPUTE_ID = __ENV.LOAD_DISPUTE_ID ?? "";
const TOKEN = __ENV.ACCESS_TOKEN ?? "";

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export default function () {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${TOKEN}`,
  };

  const createRes = http.post(
    `${BASE_URL}/api/trpc/ledger.recordPayment`,
    JSON.stringify({
      json: {
        disputeId: DISPUTE_ID,
        amountDollars: 0.01 + Math.random(),
        referenceId: `k6-ref-${__VU}-${__ITER}`,
        idempotencyKey: uuid(),
      },
    }),
    { headers, tags: { name: "ledger_record_payment" } }
  );
  paymentCreateDuration.add(createRes.timings.duration);
  const createOk = check(createRes, {
    "payment create 200": r => r.status === 200,
  });
  failures.add(!createOk);

  // Poll: read the dispute's ledger history (the status read a client performs).
  const input = encodeURIComponent(JSON.stringify({ json: { disputeId: DISPUTE_ID } }));
  const pollRes = http.get(`${BASE_URL}/api/trpc/ledger.history?input=${input}`, {
    headers,
    tags: { name: "ledger_history_poll" },
  });
  paymentPollDuration.add(pollRes.timings.duration);
  const pollOk = check(pollRes, { "poll 200": r => r.status === 200 });
  failures.add(!pollOk);
}
