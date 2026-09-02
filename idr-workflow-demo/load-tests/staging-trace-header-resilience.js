import http from "k6/http";
import { check, sleep } from "k6";

const target = __ENV.TRACE_HEADER_TEST_URL || "";
const changeTicket = __ENV.CHANGE_TICKET || "";
const requestedVus = Number(__ENV.TRACE_HEADER_TEST_VUS || "2");
const vus = Math.max(1, Math.min(requestedVus, 10));

if (!/^https:\/\/[a-z0-9.-]+\.staging\.[a-z0-9.-]+(?:\/|$)/i.test(target)) {
  throw new Error("TRACE_HEADER_TEST_URL must be an approved HTTPS *.staging.* non-production URL");
}
if (!/^CHG-[A-Z0-9-]{3,}$/i.test(changeTicket)) {
  throw new Error("CHANGE_TICKET must identify the approved staging exercise");
}
if (requestedVus > 10) {
  throw new Error("TRACE_HEADER_TEST_VUS must not exceed 10");
}

export const options = {
  scenarios: {
    malformed_trace_context: {
      executor: "constant-vus",
      vus,
      duration: "30s",
      gracefulStop: "5s",
    },
  },
  thresholds: {
    checks: ["rate>0.99"],
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1000"],
  },
};

const validPrefix = `00-${"a".repeat(32)}-${"b".repeat(16)}-01`;
const cases = [
  { name: "malformed", value: "00-not-a-valid-traceparent" },
  { name: "oversized", value: `${validPrefix}${"x".repeat(256)}` },
];

export default function () {
  const testCase = cases[(__VU + __ITER) % cases.length];
  const response = http.get(target, {
    headers: {
      traceparent: testCase.value,
      "x-healthpoint-staging-test": "trace-context-resilience",
      "x-change-ticket": changeTicket,
    },
    tags: { test_case: testCase.name },
  });
  check(response, {
    "gateway rejects malformed trace context": r => r.status === 400 || r.status === 429,
    "rejection has no cacheable response": r => r.headers["Cache-Control"] === "no-store" || r.status === 429,
  });
  sleep(1);
}
