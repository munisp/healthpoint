import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repositoryRoot = resolve(new URL("..", import.meta.url).pathname);
const analyzer = resolve(repositoryRoot, "scripts/validate-tigerbeetle-staging-alertmanager-routing-evidence.mjs");
const runId = "tb-alert-routing-20260901T010203Z-123456";
const sourceSha = "a".repeat(40);

function makeEvidence({ omitReceipts = false, advisoryPagerDutyDelivery = false } = {}) {
  const directory = mkdtempSync(resolve(tmpdir(), "healthpoint-routing-evidence-"));
  const alerts = [
    { labels: { alertname: "HealthPointTigerBeetleSyntheticRoutingAbort", synthetic_alert_routing_test: "true", drill_run_id: runId, severity: "critical", timing_gate: "abort" } },
    { labels: { alertname: "HealthPointTigerBeetleSyntheticClockNoGo", synthetic_alert_routing_test: "true", drill_run_id: runId, severity: "critical", timing_gate: "no_go" } },
    { labels: { alertname: "HealthPointTigerBeetleSyntheticClockAdvisory", synthetic_alert_routing_test: "true", drill_run_id: runId, severity: "warning", timing_gate: "advisory" } },
  ];
  const manifest = { schema_version: "healthpoint.tigerbeetle.alert-routing-drill.v1", run_id: runId, environment: "staging", payment_execution_mode: "disabled", kubernetes_action: "none", tigerbeetle_action: "none", source_sha: sourceSha };
  const alertsText = `${JSON.stringify(alerts)}\n`;
  writeFileSync(resolve(directory, "manifest.json"), `${JSON.stringify(manifest)}\n`, { mode: 0o600 });
  writeFileSync(resolve(directory, "alerts-active.json"), alertsText, { mode: 0o600 });
  writeFileSync(resolve(directory, "inject-response.json"), "{}\n", { mode: 0o600 });
  writeFileSync(resolve(directory, "alertmanager-query.json"), JSON.stringify([{ labels: { drill_run_id: runId } }]), { mode: 0o600 });
  writeFileSync(resolve(directory, "sha256sums.txt"), `${createHash("sha256").update(alertsText).digest("hex")}  ${resolve(directory, "alerts-active.json")}\n`, { mode: 0o600 });
  if (!omitReceipts) {
    const receipts = {
      schema_version: "healthpoint.tigerbeetle.alert-routing-receipts.v1",
      run_id: runId,
      advisory_pagerduty_delivery: advisoryPagerDutyDelivery,
      pagerduty_abort_incident_ref: "PD-ABORT-1001",
      pagerduty_no_go_incident_ref: "PD-NOGO-1002",
      slack_abort_message_ref: "SLACK-ABORT-1001",
      slack_no_go_message_ref: "SLACK-NOGO-1002",
      slack_advisory_message_ref: "SLACK-WARN-1003",
      operator_attestation_ref: "ATTEST-OPERATOR-1001",
      independent_reviewer_attestation_ref: "ATTEST-REVIEWER-1002",
    };
    writeFileSync(resolve(directory, "operator-receipts.json"), `${JSON.stringify(receipts)}\n`, { mode: 0o600 });
  }
  return directory;
}

function analyze(directory) {
  return spawnSync("node", [analyzer, "--evidence-dir", directory], { cwd: repositoryRoot, encoding: "utf8" });
}

test("staging routing evidence analyzer accepts complete hash-bound critical and advisory receipt references", () => {
  const directory = makeEvidence();
  try {
    const result = analyze(directory);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /TIGERBEETLE_STAGING_ALERT_ROUTING_EVIDENCE_VALID/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("staging routing evidence analyzer rejects an Alertmanager acknowledgement without operator receipts", () => {
  const directory = makeEvidence({ omitReceipts: true });
  try {
    const result = analyze(directory);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /missing operator-receipts\.json/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("staging routing evidence analyzer rejects an advisory that reached PagerDuty", () => {
  const directory = makeEvidence({ advisoryPagerDutyDelivery: true });
  try {
    const result = analyze(directory);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /no PagerDuty advisory delivery/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
