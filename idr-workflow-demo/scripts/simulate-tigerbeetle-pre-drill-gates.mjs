#!/usr/bin/env node
/**
 * Deterministic local evaluator for the TigerBeetle 15-minute pre-drill gates.
 * It reads fixture values only; it never queries Prometheus, Kubernetes, a
 * TigerBeetle cluster, or any secret store. It must not be used as release
 * evidence. Live execution must use authenticated Prometheus queries.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const fixtureIndex = args.indexOf("--fixture");
if (fixtureIndex === -1 || !args[fixtureIndex + 1] || args.length !== 2) {
  console.error("Usage: node scripts/simulate-tigerbeetle-pre-drill-gates.mjs --fixture <path>");
  process.exit(64);
}

let input;
try {
  input = JSON.parse(readFileSync(resolve(args[fixtureIndex + 1]), "utf8"));
} catch (error) {
  console.error(`SIMULATION_INPUT_INVALID: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(64);
}

if (input.fixture_kind !== "simulation_only") {
  console.error("SIMULATION_REFUSED: fixture_kind must equal simulation_only");
  process.exit(64);
}
if (input.observation_window_seconds !== 900 || input.expected_replicas !== 6 || input.probe_cadence_seconds !== 30) {
  console.error("SIMULATION_REFUSED: fixture must model a 15-minute window, six replicas, and a 30-second probe cadence");
  process.exit(64);
}

const m = input.metrics;
const required = [
  "exporter_min_up",
  "statefulset_desired_replicas",
  "statefulset_min_ready_replicas",
  "pod_min_ready",
  "read_probe_failures",
  "read_probe_successes",
  "read_probe_p99_seconds",
  "cni_enforced_proofs",
  "cni_not_enforced_proofs",
  "cni_inconclusive_proofs",
  "baseline_job_failures",
  "cleanup_failures_last_24h",
];
if (!m || required.some(key => m[key] === undefined)) {
  console.error("SIMULATION_REFUSED: fixture is missing one or more required gate metrics");
  process.exit(64);
}

const gates = [];
function gate(id, observed, expected, pass, reason) {
  gates.push({ id, observed, expected, status: pass ? "PASS" : "FAIL", reason: pass ? "" : reason });
}

gate("exporter_targets_healthy", m.exporter_min_up, "exactly 1", m.exporter_min_up === 1, "one or more required TigerBeetle exporter targets were down during the 15-minute window");
gate("desired_replicas", m.statefulset_desired_replicas, "exactly 6", m.statefulset_desired_replicas === 6, "StatefulSet desired replica count is not the approved six-replica topology");
gate("ready_replicas", m.statefulset_min_ready_replicas, "exactly 6 throughout window", m.statefulset_min_ready_replicas === 6, "fewer than six replicas were ready during the observation window");

const expectedPods = Array.from({ length: 6 }, (_, index) => `tigerbeetle-${index}`);
const missingOrNotReady = expectedPods.filter(pod => m.pod_min_ready[pod] !== 1);
gate("every_named_replica_ready", missingOrNotReady.length === 0 ? "all six pods ready" : missingOrNotReady.join(","), "each tigerbeetle-0..5 exactly 1", missingOrNotReady.length === 0, "one or more named replica readiness series is missing or was not ready");
gate("read_probe_failures", m.read_probe_failures, "exactly 0", m.read_probe_failures === 0, "a read-only mTLS probe failed during the observation window");
gate("minimum_read_probe_successes", m.read_probe_successes, "at least 30", m.read_probe_successes >= 30, "fewer than 30 successful 30-second cadence probes were observed");
gate("read_probe_p99_latency_seconds", m.read_probe_p99_seconds.toFixed(3), "less than 0.500", m.read_probe_p99_seconds < 0.5, "read-only probe p99 latency is not stable enough for a disruption drill");
gate("cni_enforcement_proof", `enforced=${m.cni_enforced_proofs},not_enforced=${m.cni_not_enforced_proofs},inconclusive=${m.cni_inconclusive_proofs}`, "enforced>=1; not_enforced=0; inconclusive=0", m.cni_enforced_proofs >= 1 && m.cni_not_enforced_proofs === 0 && m.cni_inconclusive_proofs === 0, "the same-cluster non-financial NetworkPolicy enforcement proof is missing, negative, or inconclusive");
gate("baseline_readiness_job", m.baseline_job_failures, "exactly 0 failures", m.baseline_job_failures === 0, "a baseline read-only readiness Job failed");
gate("prior_cleanup_failures", m.cleanup_failures_last_24h, "exactly 0 in prior 24h", m.cleanup_failures_last_24h === 0, "a prior temporary NetworkPolicy cleanup failure remains unresolved");

console.log("SIMULATION_ONLY: local fixture evaluation; no Prometheus, Kubernetes, TigerBeetle, secret store, or notification endpoint was contacted.");
console.log(`scenario=${input.scenario} observation_window=15m expected_replicas=6 probe_cadence=30s`);
console.log("gate                                      status  observed                                  required");
console.log("----------------------------------------  ------  ----------------------------------------  ----------------------------------------------");
for (const item of gates) {
  console.log(`${item.id.padEnd(40)}  ${item.status.padEnd(6)}  ${String(item.observed).padEnd(40)}  ${item.expected}`);
  if (item.reason) console.log(`  reason: ${item.reason}`);
}

const failures = gates.filter(item => item.status === "FAIL");
if (failures.length > 0) {
  console.log(`PRE_DRILL_GATE_RESULT=NO_GO failed_gates=${failures.length} mode=simulation_only`);
  process.exit(2);
}
console.log("PRE_DRILL_GATE_RESULT=GO_FOR_HUMAN_APPROVAL_ONLY mode=simulation_only");
console.log("NOTE: a live drill still requires authenticated Prometheus queries, approved change control, cluster identity validation, CNI enforcement proof, and named SRE approval.");
