// perf/search.js — k6 load suite: full-text search reads.
//
// Flow: authenticated tRPC query search.query with rotating terms.
//
// Budgets enforced (see perf/BUDGETS.md):
//   - search read p95 < 300 ms at 50 RPS
//   - error rate < 0.1%
//
// Required env: BASE_URL, ACCESS_TOKEN (see perf/auth.js for minting one)
// Optional env: RPS (default 50), DURATION (default 2m)
import http from "k6/http";
import { check } from "k6";
import { Rate, Trend } from "k6/metrics";

const searchDuration = new Trend("search_duration", true);
const failures = new Rate("search_failures");

export const options = {
  scenarios: {
    search_reads: {
      executor: "constant-arrival-rate",
      rate: Number(__ENV.RPS ?? 50),
      timeUnit: "1s",
      duration: __ENV.DURATION ?? "2m",
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
  },
  thresholds: {
    search_duration: ["p(95)<300"],
    search_failures: ["rate<0.001"],
    http_req_failed: ["rate<0.001"],
  },
};

const BASE_URL = (__ENV.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const TOKEN = __ENV.ACCESS_TOKEN ?? "";

const TERMS = ["ambulance", "99283", "IDR-2026", "anesthesia", "radiology", "appeal"];

export default function () {
  const term = TERMS[(__VU + __ITER) % TERMS.length];
  const input = encodeURIComponent(JSON.stringify({ json: { q: term, limit: 20 } }));
  const res = http.get(`${BASE_URL}/api/trpc/search.query?input=${input}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    tags: { name: "search_query" },
  });
  searchDuration.add(res.timings.duration);
  const ok = check(res, { "search 200": r => r.status === 200 });
  failures.add(!ok);
}
