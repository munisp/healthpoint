#!/usr/bin/env node
/**
 * Protected staging-only pre-drill gate checker.
 *
 * This process makes read-only Prometheus HTTPS queries over mTLS. It never
 * invokes kubectl, Alertmanager mutation APIs, TigerBeetle, a secret store,
 * PagerDuty, Slack, or any payment/provider endpoint.
 */
import https from "node:https";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const required = [
  "HEALTHPOINT_TIGERBEETLE_DRILL_ENV",
  "HEALTHPOINT_TIGERBEETLE_CHANGE_TICKET",
  "PAYMENT_EXECUTION_MODE",
  "STAGING_PROMETHEUS_QUERY_URL",
  "STAGING_PROMETHEUS_CA_PATH",
  "STAGING_PROMETHEUS_CLIENT_CERT_PATH",
  "STAGING_PROMETHEUS_CLIENT_KEY_PATH",
  "TIGERBEETLE_NAMESPACE",
  "TIGERBEETLE_STATEFULSET",
  "TIGERBEETLE_EXPORTER_TARGET_COUNT",
  "TIGERBEETLE_TIMING_TARGET_COUNT",
  "TIGERBEETLE_BASELINE_JOB_NAME",
];
for (const key of required) {
  if (!process.env[key]?.trim()) throw new Error(`REFUSED: ${key} is required`);
}
if (process.env.HEALTHPOINT_TIGERBEETLE_DRILL_ENV !== "staging") throw new Error("REFUSED: drill environment must equal staging");
if (process.env.PAYMENT_EXECUTION_MODE !== "disabled") throw new Error("REFUSED: PAYMENT_EXECUTION_MODE must equal disabled");
if (!/^[A-Z][A-Z0-9]+-\d+$/.test(process.env.HEALTHPOINT_TIGERBEETLE_CHANGE_TICKET)) throw new Error("REFUSED: change ticket must resemble CHG-1234");
if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(process.env.TIGERBEETLE_NAMESPACE)) throw new Error("REFUSED: TIGERBEETLE_NAMESPACE is not a DNS label");
if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(process.env.TIGERBEETLE_STATEFULSET)) throw new Error("REFUSED: TIGERBEETLE_STATEFULSET is not a DNS label");
if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(process.env.TIGERBEETLE_BASELINE_JOB_NAME)) throw new Error("REFUSED: TIGERBEETLE_BASELINE_JOB_NAME is not a DNS label");
if (!/^[1-9]\d*$/.test(process.env.TIGERBEETLE_EXPORTER_TARGET_COUNT)) throw new Error("REFUSED: TIGERBEETLE_EXPORTER_TARGET_COUNT must be a positive integer");
if (!/^[1-9]\d*$/.test(process.env.TIGERBEETLE_TIMING_TARGET_COUNT)) throw new Error("REFUSED: TIGERBEETLE_TIMING_TARGET_COUNT must be a positive integer");

const intervalSeconds = Number(process.env.TIGERBEETLE_PRE_DRILL_INTERVAL_SECONDS ?? "30");
const sampleCount = Number(process.env.TIGERBEETLE_PRE_DRILL_SAMPLE_COUNT ?? "30");
if (intervalSeconds !== 30 || sampleCount !== 30) throw new Error("REFUSED: staging pre-drill check requires exactly 30 samples at 30-second intervals");

const queryUrl = new URL(process.env.STAGING_PROMETHEUS_QUERY_URL);
const host = queryUrl.hostname.toLowerCase();
const privateHost = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host.endsWith(".svc.cluster.local") || host.endsWith(".internal");
if (queryUrl.protocol !== "https:" || !privateHost) throw new Error("REFUSED: STAGING_PROMETHEUS_QUERY_URL must be private HTTPS");

for (const key of ["STAGING_PROMETHEUS_CA_PATH", "STAGING_PROMETHEUS_CLIENT_CERT_PATH", "STAGING_PROMETHEUS_CLIENT_KEY_PATH"]) {
  if (!existsSync(process.env[key])) throw new Error(`REFUSED: ${key} is not a readable file`);
}

const artifactDir = resolve(process.env.TIGERBEETLE_PRE_DRILL_ARTIFACT_DIR ?? "artifacts/tigerbeetle-staging-pre-drill");
if (/mock|fixture|example|synthetic/i.test(artifactDir)) throw new Error("REFUSED: pre-drill evidence directory cannot be mock/fixture/example/synthetic");
mkdirSync(artifactDir, { recursive: true });
const artifactPath = resolve(artifactDir, `pre-drill-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);

const ns = process.env.TIGERBEETLE_NAMESPACE;
const sts = process.env.TIGERBEETLE_STATEFULSET;
const baselineJob = process.env.TIGERBEETLE_BASELINE_JOB_NAME;
const expectedExporterTargets = Number(process.env.TIGERBEETLE_EXPORTER_TARGET_COUNT);
const expectedTimingTargets = Number(process.env.TIGERBEETLE_TIMING_TARGET_COUNT);
const agent = new https.Agent({
  ca: readFileSync(process.env.STAGING_PROMETHEUS_CA_PATH),
  cert: readFileSync(process.env.STAGING_PROMETHEUS_CLIENT_CERT_PATH),
  key: readFileSync(process.env.STAGING_PROMETHEUS_CLIENT_KEY_PATH),
  minVersion: "TLSv1.2",
  rejectUnauthorized: true,
});

function sleep(ms) { return new Promise(resolvePromise => setTimeout(resolvePromise, ms)); }
function request(query) {
  const url = new URL("/api/v1/query", queryUrl);
  url.searchParams.set("query", query);
  return new Promise((resolvePromise, reject) => {
    const req = https.request(url, { method: "GET", agent, timeout: 10_000 }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (response.statusCode !== 200) return reject(new Error(`Prometheus returned HTTP ${response.statusCode}`));
        try {
          const parsed = JSON.parse(body);
          if (parsed.status !== "success" || !parsed.data) return reject(new Error("Prometheus returned non-success response"));
          resolvePromise(parsed.data);
        } catch { reject(new Error("Prometheus returned invalid JSON")); }
      });
    });
    req.on("timeout", () => req.destroy(new Error("Prometheus query timed out")));
    req.on("error", reject);
    req.end();
  });
}

async function scalar(name, query) {
  const data = await request(query);
  if (data.resultType !== "vector" || !Array.isArray(data.result) || data.result.length !== 1) throw new Error(`${name}: expected exactly one scalar vector result`);
  const value = Number(data.result[0]?.value?.[1]);
  if (!Number.isFinite(value)) throw new Error(`${name}: non-numeric result`);
  return value;
}
async function podVector() {
  const data = await request(`min by (pod) (min_over_time(kube_pod_status_ready{namespace="${ns}",condition="true",pod=~"${sts}-[0-5]"}[15m]))`);
  if (data.resultType !== "vector" || !Array.isArray(data.result) || data.result.length !== 6) throw new Error("every_named_replica_ready: expected exactly six pod readiness vectors");
  const expected = new Set(Array.from({ length: 6 }, (_, index) => `${sts}-${index}`));
  for (const result of data.result) {
    const pod = result?.metric?.pod;
    const value = Number(result?.value?.[1]);
    if (!expected.has(pod) || value !== 1) throw new Error(`every_named_replica_ready: ${pod ?? "unknown"} is missing or not ready`);
    expected.delete(pod);
  }
  if (expected.size) throw new Error("every_named_replica_ready: one or more ordinal pods are missing");
  return "all-six-ready";
}

const gateQueries = [
  ["exporter_targets_healthy", `sum(min_over_time(up{job="tigerbeetle-statsd-exporter",namespace="${ns}"}[15m]))`, value => value === expectedExporterTargets, `exactly ${expectedExporterTargets} healthy exporter target(s)`],
  ["timing_targets_healthy", `sum(min_over_time(chrony_up{job="chrony-exporter",healthpoint_timing_role=~"application|cni|otel_collector|prometheus"}[15m]))`, value => value === expectedTimingTargets, `exactly ${expectedTimingTargets} healthy Chrony timing target(s)`],
  ["timing_remote_references", `min(min_over_time(chrony_tracking_remote_reference{job="chrony-exporter",healthpoint_timing_role=~"application|cni|otel_collector|prometheus"}[15m]))`, value => value === 1, "all timing roles retain an approved remote Chrony reference"],
  ["timing_clock_error_bound_seconds", `max(max_over_time(healthpoint:chrony_clock_error_bound_seconds{healthpoint_timing_role=~"application|cni|otel_collector|prometheus"}[15m]))`, value => value <= 0.05, "clock error bound at or below 0.05 seconds for 15 minutes"],
  ["timing_reference_sample_age_seconds", `max(max_over_time(healthpoint:chrony_time_source_sample_age_seconds{healthpoint_timing_role=~"application|cni|otel_collector|prometheus"}[15m]))`, value => value <= 180, "Chrony reference sample age at or below 180 seconds"],
  ["kernel_time_synchronization", `min(min_over_time(node_timex_sync_status{job="node-exporter",healthpoint_timing_role=~"application|cni|otel_collector|prometheus"}[15m]))`, value => value === 1, "all timing roles retain Linux kernel time synchronization"],
  ["desired_replicas", `max(kube_statefulset_replicas{namespace="${ns}",statefulset="${sts}"})`, value => value === 6, "exactly 6 desired replicas"],
  ["ready_replicas", `min_over_time(kube_statefulset_status_replicas_ready{namespace="${ns}",statefulset="${sts}"}[15m])`, value => value === 6, "exactly 6 ready replicas for 15 minutes"],
  ["read_probe_failures", `sum(increase(healthpoint_tigerbeetle_read_probe_total{environment="staging",namespace="${ns}",operation="lookup_accounts",result="failure"}[15m]))`, value => value === 0, "zero failed read-only probes"],
  ["read_probe_successes", `sum(increase(healthpoint_tigerbeetle_read_probe_total{environment="staging",namespace="${ns}",operation="lookup_accounts",result="success"}[15m]))`, value => value >= 30, "at least 30 successful probes"],
  ["read_probe_p99_seconds", `histogram_quantile(0.99, sum by (le) (rate(healthpoint_tigerbeetle_read_probe_duration_seconds_bucket{environment="staging",namespace="${ns}",operation="lookup_accounts"}[15m])))`, value => value < 0.5, "p99 under 0.5 seconds"],
  ["cni_enforced_proof", `sum(increase(healthpoint_tigerbeetle_partition_cni_enforcement_total{environment="staging",namespace="${ns}",result="enforced"}[15m]))`, value => value >= 1, "at least one enforced CNI proof"],
  ["cni_not_enforced_proof", `sum(increase(healthpoint_tigerbeetle_partition_cni_enforcement_total{environment="staging",namespace="${ns}",result="not_enforced"}[15m]))`, value => value === 0, "zero negative CNI proofs"],
  ["cni_inconclusive_proof", `sum(increase(healthpoint_tigerbeetle_partition_cni_enforcement_total{environment="staging",namespace="${ns}",result="inconclusive"}[15m]))`, value => value === 0, "zero inconclusive CNI proofs"],
  ["baseline_readiness_job", `max(kube_job_status_failed{namespace="${ns}",job_name="${baselineJob}"})`, value => value === 0, "baseline readiness Job has zero failures"],
  ["prior_cleanup_failures", `sum(increase(healthpoint_tigerbeetle_partition_cleanup_total{environment="staging",namespace="${ns}",result="failed"}[24h]))`, value => value === 0, "zero cleanup failures in prior 24 hours"],
  ["active_abort_alerts", `(sum(ALERTS{alertstate="firing",environment="staging",service="tigerbeetle",drill_abort="true"}) or vector(0))`, value => value === 0, "zero active drill-abort alerts"],
];

const report = {
  execution: "protected-staging-pre-drill",
  status: "running",
  startedAt: new Date().toISOString(),
  changeTicket: process.env.HEALTHPOINT_TIGERBEETLE_CHANGE_TICKET,
  namespace: ns,
  statefulset: sts,
  sampleCount,
  intervalSeconds,
  samples: [],
};

function persist() { writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`); }
try {
  for (let sample = 1; sample <= sampleCount; sample += 1) {
    const observed = [];
    for (const [name, query, assertion, expected] of gateQueries) {
      const value = await scalar(name, query);
      const pass = assertion(value);
      observed.push({ name, value, expected, pass });
      if (!pass) throw new Error(`${name}: observed ${value}; required ${expected}`);
    }
    await podVector();
    report.samples.push({ number: sample, observedAt: new Date().toISOString(), gates: observed, podReadiness: "all-six-ready" });
    persist();
    process.stdout.write(`PRE_DRILL_SAMPLE_PASS sample=${sample}/${sampleCount}\n`);
    if (sample < sampleCount) await sleep(intervalSeconds * 1000);
  }
  report.status = "pass";
  report.completedAt = new Date().toISOString();
  persist();
  process.stdout.write(`PRE_DRILL_GATE_PASS: ${sampleCount} staging samples passed; human change approval remains required. artifact=${artifactPath}\n`);
} catch (error) {
  report.status = "fail";
  report.completedAt = new Date().toISOString();
  report.error = error instanceof Error ? error.message : String(error);
  persist();
  process.stderr.write(`PRE_DRILL_GATE_FAIL: ${report.error}. artifact=${artifactPath}\n`);
  process.exit(2);
}
