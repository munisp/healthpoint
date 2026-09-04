import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const monitorPath = resolve("infrastructure/tigerbeetle-staging/k8s/tigerbeetle-clock-monitor.yaml.template");
const exportersPath = resolve("infrastructure/tigerbeetle-staging/k8s/chrony-and-node-exporter-metrics.yaml.template");
const monitor = readFileSync(monitorPath, "utf8");
const exporters = readFileSync(exportersPath, "utf8");
const findings = [];
const requireText = (source, value, label) => { if (!source.includes(value)) findings.push(`missing ${label}: ${value}`); };
const forbid = (source, pattern, message) => { if (pattern.test(source)) findings.push(message); };

for (const [source, label] of [[monitor, "clock monitor"], [exporters, "clock exporter"]]) {
  requireText(source, "IMAGE_DIGEST}", `${label} digest-pinned image placeholder`);
  requireText(source, "automountServiceAccountToken: false", `${label} tokenless service account`);
  requireText(source, "allowPrivilegeEscalation: false", `${label} privilege-escalation control`);
  requireText(source, "readOnlyRootFilesystem: true", `${label} immutable root filesystem`);
  requireText(source, "runAsNonRoot: true", `${label} non-root runtime`);
  requireText(source, "seccompProfile: { type: RuntimeDefault }", `${label} runtime default seccomp`);
  forbid(source, /privileged:\s*true/i, `${label} must not use privileged containers`);
  forbid(source, /hostNetwork:\s*true/i, `${label} must not use host networking`);
  forbid(source, /hostPID:\s*true/i, `${label} must not use host PID namespace`);
  forbid(source, /hostIPC:\s*true/i, `${label} must not use host IPC namespace`);
  forbid(source, /PAYMENT_EXECUTION_MODE, value: (?!disabled)/, `${label} cannot enable payment execution`);
}

for (const value of [
  "ExternalSecret",
  "tigerbeetle-clock-monitor-prometheus-mtls",
  "STAGING_PROMETHEUS_CA_PATH",
  "STAGING_PROMETHEUS_CLIENT_CERT_PATH",
  "STAGING_PROMETHEUS_CLIENT_KEY_PATH",
  "dist/tigerbeetle-clock-monitor.js",
  "TIGERBEETLE_CLOCK_MONITOR_INTERVAL_SECONDS, value: \"15\"",
  "TIGERBEETLE_CLOCK_MONITOR_WARNING_SECONDS, value: \"0.025\"",
  "TIGERBEETLE_CLOCK_MONITOR_PRECHECK_LIMIT_SECONDS, value: \"0.05\"",
  "interval: 15s",
  "app.kubernetes.io/name: prometheus",
  "port: 9090",
]) requireText(monitor, value, "clock monitor safety control");
forbid(monitor, /STAGING_PROMETHEUS_QUERY_URL, value: https:\/\/(?:localhost|127\.|0\.0\.0\.0)/i, "clock monitor must not use a loopback Prometheus endpoint");
forbid(monitor, /(?:pagerduty|slack|alertmanager|kubectl|argocd|terraform|chronyc|makestep|adjtimex)/i, "clock monitor must not invoke notification, control-plane, or time-adjustment tooling");

for (const value of [
  "TIMING_ROLE: application, cni, otel_collector, and prometheus",
  "healthpoint.io/timing-role: ${TIMING_ROLE}",
  "healthpoint_timing_role: ${TIMING_ROLE}",
  "targetLabel: healthpoint_timing_role",
  "--chrony.address=unix://${CHRONY_SOCKET_PATH}",
  "--collector.tracking",
  "--collector.sources",
  "--collector.timex",
  "capabilities: { drop: [\"ALL\"], add: [\"SYS_TIME\"] }",
  "interval: 15s",
]) requireText(exporters, value, "clock exporter safety control");
forbid(exporters, /^\s*-\s*.*\b(?:chronyd|makestep|adjtimex)\b|^\s*-\s*.*\bchronyc\b.*\b(?:makestep|burst|online|offline)\b/mi, "exporter contract must not run or adjust chronyd/node time");
forbid(exporters, /capabilities:\s*\{[^}]*add:\s*\[(?!\"SYS_TIME\")/i, "Node Exporter must not add capabilities other than SYS_TIME");

if (findings.length) {
  console.error("TIGERBEETLE_CLOCK_MONITOR_DEPLOYMENT_CONTRACT_INVALID");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(2);
}
console.log("TIGERBEETLE_CLOCK_MONITOR_DEPLOYMENT_CONTRACT_VALID: read-only private mTLS observer, role-scoped exporter scrapes, hardened containers, and no time/drill automation");
