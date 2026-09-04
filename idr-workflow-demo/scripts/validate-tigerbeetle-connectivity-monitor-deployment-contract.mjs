import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(new URL("..", import.meta.url).pathname);
const sourcePath = resolve(repositoryRoot, "server/tigerbeetle-connectivity-monitor.ts");
const manifestPath = resolve(repositoryRoot, "infrastructure/tigerbeetle-staging/k8s/tigerbeetle-connectivity-monitor.yaml.template");
const alertsPath = resolve(repositoryRoot, "infrastructure/tigerbeetle-staging/k8s/prometheus-tigerbeetle-connectivity-monitor-alerts.yaml.template");

const source = readFileSync(sourcePath, "utf8");
const manifest = readFileSync(manifestPath, "utf8");
const alerts = readFileSync(alertsPath, "utf8");

function requireText(text, expected, label) {
  assert.ok(text.includes(expected), `${label} must contain ${expected}`);
}

function forbidText(text, prohibited, label) {
  assert.ok(!text.includes(prohibited), `${label} must not contain ${prohibited}`);
}

for (const required of [
  'HEALTHPOINT_TIGERBEETLE_CONNECTIVITY_MONITOR_ENV',
  'PAYMENT_EXECUTION_MODE',
  'TIGERBEETLE_FINALITY_EXECUTION must not be true',
  'TIGERBEETLE_ENABLED must equal true',
  'verifyTigerBeetleReadConnectivity(config.probeTimeoutMs)',
  'startTigerBeetleTunnel()',
  'stopTigerBeetleTunnel()',
  'tigerbeetle_read_timeout',
  'healthpoint_tigerbeetle_connectivity_monitor_status',
  'healthpoint_tigerbeetle_connectivity_monitor_probes_total',
  'healthpoint_tigerbeetle_connectivity_monitor_last_evaluation_timestamp_seconds',
  'statusCode: 503',
]) requireText(source, required, "connectivity monitor source");

for (const prohibited of [
  'createTransfers(',
  'executeTigerBeetleFinalitySubmissionAuthorization',
  'kubectl',
  'child_process',
  'fetch(',
]) forbidText(source, prohibited, "connectivity monitor source");

for (const required of [
  'kind: ExternalSecret',
  'kind: ServiceAccount',
  'automountServiceAccountToken: false',
  'kind: Deployment',
  'image: ${HEALTHPOINT_APP_IMAGE_DIGEST}',
  'command: ["node", "dist/tigerbeetle-connectivity-monitor.js"]',
  '{ name: PAYMENT_EXECUTION_MODE, value: disabled }',
  '{ name: TIGERBEETLE_FINALITY_EXECUTION, value: "false" }',
  '{ name: TIGERBEETLE_CONNECTIVITY_MONITOR_INTERVAL_MS, value: "15000" }',
  '{ name: TIGERBEETLE_CONNECTIVITY_MONITOR_PROBE_TIMEOUT_MS, value: "10000" }',
  '{ name: TIGERBEETLE_CONNECTIVITY_MONITOR_FAILURE_THRESHOLD, value: "2" }',
  'readOnlyRootFilesystem: true',
  'allowPrivilegeEscalation: false',
  'seccompProfile: { type: RuntimeDefault }',
  'defaultMode: 0400',
  'kind: ServiceMonitor',
  'publishNotReadyAddresses: true',
  'kind: NetworkPolicy',
  'app.kubernetes.io/name: tigerbeetle-mtls-proxy',
]) requireText(manifest, required, "connectivity monitor manifest");

for (const prohibited of [
  'kubectl',
  'run-tigerbeetle-partition-recovery-drill.sh',
  'PAYMENT_EXECUTION_MODE, value: enabled',
  'TIGERBEETLE_FINALITY_EXECUTION, value: "true"',
  'serviceAccountToken:',
]) forbidText(manifest, prohibited, "connectivity monitor manifest");

for (const required of [
  'HealthPointTigerBeetleConnectivityMonitorNoGo',
  'HealthPointTigerBeetleConnectivityProbeTimeout',
  'HealthPointTigerBeetleConnectivityMonitorStale',
  'drill_abort: "true"',
  'healthpoint_tigerbeetle_connectivity_monitor_status{status="no_go"} == 1',
  'healthpoint_tigerbeetle_connectivity_monitor_probes_total{outcome="timeout"}',
  'healthpoint_tigerbeetle_connectivity_monitor_last_evaluation_timestamp_seconds > 45',
  'must not trigger automated network, payment, finality, or Kubernetes actions',
]) requireText(alerts, required, "connectivity monitor alerts");

process.stdout.write("TIGERBEETLE_CONNECTIVITY_MONITOR_DEPLOYMENT_CONTRACT=PASS\n");
