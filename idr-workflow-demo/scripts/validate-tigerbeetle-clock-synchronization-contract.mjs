import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const timingPath = resolve("observability/tigerbeetle-drill-timing-contract.json");
const rulePath = resolve("infrastructure/tigerbeetle-staging/k8s/prometheus-tigerbeetle-clock-synchronization.yaml.template");
const timing = JSON.parse(readFileSync(timingPath, "utf8"));
const rules = readFileSync(rulePath, "utf8");
const findings = [];
const requireText = (value, label) => { if (!rules.includes(value)) findings.push(`missing ${label}: ${value}`); };
const forbid = (pattern, message) => { if (pattern.test(rules)) findings.push(message); };

if (timing.clock_offset_warning_seconds !== 0.05) findings.push("timing contract warning threshold must remain 0.05 seconds");
if (timing.clock_offset_abort_seconds !== 0.25) findings.push("timing contract abort threshold must remain 0.25 seconds");
if (timing.maximum_collector_ingest_lag_seconds !== 30) findings.push("timing contract collector lag must remain 30 seconds");
for (const metric of [
  "chrony_up",
  "chrony_tracking_system_time_seconds",
  "chrony_tracking_root_delay_seconds",
  "chrony_tracking_root_dispersion_seconds",
  "chrony_tracking_reference_timestamp_seconds",
  "chrony_tracking_remote_reference",
  "node_timex_sync_status",
]) {
  if (!timing.chrony_required_metrics.includes(metric) && !timing.kernel_time_required_metrics.includes(metric)) findings.push(`timing contract lacks required metric ${metric}`);
  requireText(metric, "clock-rule metric");
}
for (const role of ["application", "cni", "otel_collector", "prometheus"]) requireText(role, "required correlation role");
for (const value of [
  "record: healthpoint:chrony_clock_error_bound_seconds",
  "abs(chrony_tracking_system_time_seconds",
  "chrony_tracking_root_dispersion_seconds",
  "0.5 * chrony_tracking_root_delay_seconds",
  "record: healthpoint:chrony_time_source_sample_age_seconds",
  "HealthPointTigerBeetleClockAccuracyWarning",
  "> 0.05",
  "for: 30s",
  "HealthPointTigerBeetleClockAccuracyAbort",
  "> 0.25",
  "for: 5s",
  "healthpoint_tigerbeetle_partition_drill_active",
  "HealthPointTigerBeetleChronyUnavailable",
  "HealthPointTigerBeetleChronyNotSynchronised",
  "HealthPointTigerBeetleChronyReferenceStale",
  "HealthPointTigerBeetleKernelTimeUnsynchronised",
  "absent(chrony_up",
  "absent(node_timex_sync_status",
]) requireText(value, "clock-rule safety control");
forbid(/\btenant(?:_id)?\b|\bpatient(?:_id)?\b|\bdispute(?:_id)?\b|\baccount(?:_id)?\b|\btransfer(?:_id)?\b/i, "timing metrics must not introduce regulated or financial identifier labels");
forbid(/image:\s*[^\n]*:(?![^\n]*@sha256:)/, "clock-rule template must not introduce mutable images");

if (findings.length) {
  console.error("TIGERBEETLE_CLOCK_SYNCHRONIZATION_CONTRACT_INVALID");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(2);
}
console.log("TIGERBEETLE_CLOCK_SYNCHRONIZATION_CONTRACT_VALID: Chrony/kernel timing metrics, 50 ms warning, 250 ms active-drill abort, and telemetry-blindness guards are present");
