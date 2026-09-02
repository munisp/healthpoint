import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const repositoryRoot = resolve(new URL("..", import.meta.url).pathname);
const source = resolve(repositoryRoot, "server/tigerbeetle-clock-monitor.ts");

function run(overrides = {}) {
  return spawnSync("pnpm", ["exec", "tsx", source], {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 10_000,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ...overrides,
    },
  });
}

function expectRefusal(result, message) {
  assert.notEqual(result.status, 0, `clock monitor unexpectedly started: stdout=${result.stdout} stderr=${result.stderr}`);
  assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(message), `expected refusal ${message}; stderr=${result.stderr}`);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /tigerbeetle_clock_monitor_started/);
}

test("clock monitor refuses absent configuration before starting", () => {
  expectRefusal(run(), "HEALTHPOINT_TIGERBEETLE_MONITOR_ENV is required");
});

test("clock monitor refuses a loopback Prometheus endpoint unless the explicit fixture flag is also present", () => {
  expectRefusal(run({
    NODE_ENV: "test",
    HEALTHPOINT_TIGERBEETLE_MONITOR_ENV: "staging",
    PAYMENT_EXECUTION_MODE: "disabled",
    STAGING_PROMETHEUS_QUERY_URL: "https://127.0.0.1:9443",
  }), "loopback is allowed only in explicit NODE_ENV=test fixture mode");
});

test("clock monitor refuses non-staging execution before reading credentials or binding a port", () => {
  expectRefusal(run({
    HEALTHPOINT_TIGERBEETLE_MONITOR_ENV: "production",
    PAYMENT_EXECUTION_MODE: "disabled",
    STAGING_PROMETHEUS_QUERY_URL: "https://prometheus.internal",
    STAGING_PROMETHEUS_CA_PATH: "/nonexistent/ca.crt",
    STAGING_PROMETHEUS_CLIENT_CERT_PATH: "/nonexistent/client.crt",
    STAGING_PROMETHEUS_CLIENT_KEY_PATH: "/nonexistent/client.key",
    TIGERBEETLE_TIMING_TARGET_COUNT: "4",
    TIGERBEETLE_CLOCK_MONITOR_INTERVAL_SECONDS: "15",
    TIGERBEETLE_CLOCK_MONITOR_WARNING_SECONDS: "0.025",
    TIGERBEETLE_CLOCK_MONITOR_PRECHECK_LIMIT_SECONDS: "0.05",
    TIGERBEETLE_CLOCK_MONITOR_LISTEN_ADDRESS: "127.0.0.1",
    TIGERBEETLE_CLOCK_MONITOR_LISTEN_PORT: "9464",
  }), "monitor environment must equal staging");
});
