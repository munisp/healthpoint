import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function fail(message) {
  console.error(`TIGERBEETLE_STAGING_ALERT_ROUTING_EVIDENCE_INVALID: ${message}`);
  process.exit(2);
}

const args = process.argv.slice(2);
const index = args.indexOf("--evidence-dir");
if (index === -1 || !args[index + 1] || args.length !== 2) {
  fail("usage: node scripts/validate-tigerbeetle-staging-alertmanager-routing-evidence.mjs --evidence-dir <protected-staging-evidence-directory>");
}
const evidenceDir = resolve(args[index + 1]);
if (/mock|fixture|example|synthetic|dummy|local-alertmanager/i.test(evidenceDir)) {
  fail("evidence directory must not be a test, fixture, mock, example, synthetic, dummy, or local-routing path");
}

function readRequired(name) {
  const path = resolve(evidenceDir, name);
  if (!existsSync(path)) fail(`missing ${name}`);
  const bytes = readFileSync(path);
  if (!bytes.length) fail(`${name} is empty`);
  return bytes;
}
function parseJson(name) {
  try { return JSON.parse(readRequired(name).toString("utf8")); }
  catch { fail(`${name} is not valid JSON`); }
}
function opaqueReference(value, field) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{6,128}$/.test(value)) {
    fail(`${field} must be a redacted opaque reference without a URL, credential, or identity`);
  }
}

const manifest = parseJson("manifest.json");
if (manifest?.schema_version !== "healthpoint.tigerbeetle.alert-routing-drill.v1") fail("manifest schema version is not supported");
if (manifest?.environment !== "staging" || manifest?.payment_execution_mode !== "disabled") fail("manifest must prove staging and disabled payments");
if (manifest?.kubernetes_action !== "none" || manifest?.tigerbeetle_action !== "none") fail("routing drill evidence must prove no Kubernetes or TigerBeetle action");
if (typeof manifest?.run_id !== "string" || !/^tb-alert-routing-[0-9TZ-]+$/.test(manifest.run_id)) fail("manifest run_id is invalid");
if (typeof manifest?.source_sha !== "string" || !/^[a-f0-9]{40}$/.test(manifest.source_sha)) fail("manifest source_sha must be a full immutable commit SHA");

const alertsBytes = readRequired("alerts-active.json");
const alerts = parseJson("alerts-active.json");
if (!Array.isArray(alerts) || alerts.length !== 3) fail("alerts-active.json must contain exactly three synthetic routing alerts");
const expected = new Map([
  ["HealthPointTigerBeetleSyntheticRoutingAbort", { severity: "critical", timingGate: "abort" }],
  ["HealthPointTigerBeetleSyntheticClockNoGo", { severity: "critical", timingGate: "no_go" }],
  ["HealthPointTigerBeetleSyntheticClockAdvisory", { severity: "warning", timingGate: "advisory" }],
]);
for (const alert of alerts) {
  const labels = alert?.labels;
  const contract = expected.get(labels?.alertname);
  if (!contract) fail("alerts-active.json contains an unexpected alert name");
  if (labels?.synthetic_alert_routing_test !== "true" || labels?.drill_run_id !== manifest.run_id) fail("each alert must carry the exact synthetic marker and manifest run ID");
  if (labels?.severity !== contract.severity || labels?.timing_gate !== contract.timingGate) fail("alert severity/timing-gate class does not match the routing contract");
  expected.delete(labels.alertname);
}
if (expected.size) fail("one or more expected alert classes are absent");

const checksumLines = readRequired("sha256sums.txt").toString("utf8").trim().split(/\r?\n/);
const alertsChecksum = createHash("sha256").update(alertsBytes).digest("hex");
if (!checksumLines.some(line => line === `${alertsChecksum}  ${resolve(evidenceDir, "alerts-active.json")}` || line === `${alertsChecksum}  alerts-active.json`)) {
  fail("sha256sums.txt does not bind alerts-active.json");
}

const queryText = readRequired("alertmanager-query.json").toString("utf8");
if (!queryText.includes(manifest.run_id)) fail("Alertmanager query evidence does not contain the exact run ID");
readRequired("inject-response.json");

// Alertmanager acknowledges ingestion, not final notification delivery. The two
// delivery systems are verified by dual operator attestations containing only
// opaque incident/message references, never webhook URLs or recipient content.
const receipts = parseJson("operator-receipts.json");
if (receipts?.schema_version !== "healthpoint.tigerbeetle.alert-routing-receipts.v1") fail("operator receipt schema version is not supported");
if (receipts?.run_id !== manifest.run_id) fail("operator receipts must bind to the exact manifest run ID");
if (receipts?.advisory_pagerduty_delivery !== false) fail("operator receipts must explicitly confirm no PagerDuty advisory delivery");
for (const [field, value] of Object.entries({
  pagerduty_abort_incident_ref: receipts?.pagerduty_abort_incident_ref,
  pagerduty_no_go_incident_ref: receipts?.pagerduty_no_go_incident_ref,
  slack_abort_message_ref: receipts?.slack_abort_message_ref,
  slack_no_go_message_ref: receipts?.slack_no_go_message_ref,
  slack_advisory_message_ref: receipts?.slack_advisory_message_ref,
  operator_attestation_ref: receipts?.operator_attestation_ref,
  independent_reviewer_attestation_ref: receipts?.independent_reviewer_attestation_ref,
})) opaqueReference(value, field);

console.log("TIGERBEETLE_STAGING_ALERT_ROUTING_EVIDENCE_VALID: exact synthetic abort/no-go/advisory alerts, immutable request digest, Alertmanager run-ID acknowledgement, PagerDuty+Slack critical receipts, Slack advisory receipt, explicit no-PagerDuty advisory confirmation, and two opaque review references are present.");
console.log(`TIGERBEETLE_STAGING_ALERT_ROUTING_RUN_ID: ${manifest.run_id}`);
