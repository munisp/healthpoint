import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const CHECKER = resolve(ROOT, "scripts/check-tigerbeetle-staging-pre-drill-gates.mjs");

function run(overrides = {}) {
  return spawnSync(process.execPath, [CHECKER], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ...overrides,
    },
  });
}

function certificatePaths(directory) {
  const paths = {
    STAGING_PROMETHEUS_CA_PATH: join(directory, "ca.crt"),
    STAGING_PROMETHEUS_CLIENT_CERT_PATH: join(directory, "client.crt"),
    STAGING_PROMETHEUS_CLIENT_KEY_PATH: join(directory, "client.key"),
  };
  for (const path of Object.values(paths)) writeFileSync(path, "test-only-not-a-certificate\n", { mode: 0o600 });
  return paths;
}

function baseEnvironment(directory) {
  return {
    HEALTHPOINT_TIGERBEETLE_DRILL_ENV: "staging",
    HEALTHPOINT_TIGERBEETLE_CHANGE_TICKET: "CHG-1234",
    PAYMENT_EXECUTION_MODE: "disabled",
    STAGING_PROMETHEUS_QUERY_URL: "https://prometheus.internal",
    TIGERBEETLE_NAMESPACE: "healthpoint-staging",
    TIGERBEETLE_STATEFULSET: "tigerbeetle",
    TIGERBEETLE_EXPORTER_TARGET_COUNT: "1",
    TIGERBEETLE_TIMING_TARGET_COUNT: "4",
    TIGERBEETLE_BASELINE_JOB_NAME: "tigerbeetle-readiness",
    TIGERBEETLE_PRE_DRILL_ARTIFACT_DIR: join(directory, "gate-evidence"),
    ...certificatePaths(directory),
  };
}

function expectRefusal(result, message) {
  assert.equal(result.status, 1, `expected exit status 1; stderr=${result.stderr}`);
  assert.match(result.stderr, new RegExp(message), `expected refusal ${message}; stderr=${result.stderr}`);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /PRE_DRILL_SAMPLE_PASS|PRE_DRILL_GATE_PASS/);
}

test("refuses missing required configuration before any gate activity", () => {
  const result = run();
  expectRefusal(result, "HEALTHPOINT_TIGERBEETLE_DRILL_ENV is required");
});

test("refuses missing Chrony timing-target coverage before certificate reads or network activity", () => {
  const dir = mkdtempSync(join(tmpdir(), "hp-tb-gate-test-"));
  try {
    const result = run({
      ...baseEnvironment(dir),
      TIGERBEETLE_TIMING_TARGET_COUNT: "",
      STAGING_PROMETHEUS_CA_PATH: join(dir, "does-not-exist-ca.crt"),
      STAGING_PROMETHEUS_CLIENT_CERT_PATH: join(dir, "does-not-exist-client.crt"),
      STAGING_PROMETHEUS_CLIENT_KEY_PATH: join(dir, "does-not-exist-client.key"),
    });
    expectRefusal(result, "TIGERBEETLE_TIMING_TARGET_COUNT is required");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("refuses any non-staging execution designation", () => {
  const dir = mkdtempSync(join(tmpdir(), "hp-tb-gate-test-"));
  try {
    const result = run({ ...baseEnvironment(dir), HEALTHPOINT_TIGERBEETLE_DRILL_ENV: "production" });
    expectRefusal(result, "drill environment must equal staging");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("refuses when payment execution is not disabled", () => {
  const dir = mkdtempSync(join(tmpdir(), "hp-tb-gate-test-"));
  try {
    const result = run({ ...baseEnvironment(dir), PAYMENT_EXECUTION_MODE: "enabled" });
    expectRefusal(result, "PAYMENT_EXECUTION_MODE must equal disabled");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("refuses malformed change-control identifiers", () => {
  const dir = mkdtempSync(join(tmpdir(), "hp-tb-gate-test-"));
  try {
    const result = run({ ...baseEnvironment(dir), HEALTHPOINT_TIGERBEETLE_CHANGE_TICKET: "ticket-unsafe" });
    expectRefusal(result, "change ticket must resemble CHG-1234");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("refuses public or loopback Prometheus endpoints before certificate reads or network activity", () => {
  const dir = mkdtempSync(join(tmpdir(), "hp-tb-gate-test-"));
  try {
    const result = run({
      ...baseEnvironment(dir),
      STAGING_PROMETHEUS_QUERY_URL: "https://127.0.0.1:9443",
      STAGING_PROMETHEUS_CA_PATH: join(dir, "does-not-exist-ca.crt"),
      STAGING_PROMETHEUS_CLIENT_CERT_PATH: join(dir, "does-not-exist-client.crt"),
      STAGING_PROMETHEUS_CLIENT_KEY_PATH: join(dir, "does-not-exist-client.key"),
    });
    expectRefusal(result, "STAGING_PROMETHEUS_QUERY_URL must be private HTTPS");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("refuses missing mTLS material before any Prometheus request", () => {
  const dir = mkdtempSync(join(tmpdir(), "hp-tb-gate-test-"));
  try {
    const result = run({ ...baseEnvironment(dir), STAGING_PROMETHEUS_CLIENT_KEY_PATH: join(dir, "missing-client.key") });
    expectRefusal(result, "STAGING_PROMETHEUS_CLIENT_KEY_PATH is not a readable file");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("refuses any deviation from the fixed 15-minute sampling contract", () => {
  const dir = mkdtempSync(join(tmpdir(), "hp-tb-gate-test-"));
  try {
    const result = run({ ...baseEnvironment(dir), TIGERBEETLE_PRE_DRILL_INTERVAL_SECONDS: "5" });
    expectRefusal(result, "requires exactly 30 samples at 30-second intervals");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("refuses evidence output paths that could be confused with fixtures", () => {
  const dir = mkdtempSync(join(tmpdir(), "hp-tb-gate-test-"));
  try {
    const result = run({ ...baseEnvironment(dir), TIGERBEETLE_PRE_DRILL_ARTIFACT_DIR: join(dir, "fixture-gates") });
    expectRefusal(result, "pre-drill evidence directory cannot be mock/fixture/example/synthetic");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
