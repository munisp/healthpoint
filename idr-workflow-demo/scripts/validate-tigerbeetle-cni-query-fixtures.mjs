import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const schema = JSON.parse(readFileSync(resolve(root, "observability/schemas/tigerbeetle-drill-correlation-log.schema.json"), "utf8"));
const contract = JSON.parse(readFileSync(resolve(root, "observability/tigerbeetle-drill-cni-query-contracts.json"), "utf8"));
const timing = JSON.parse(readFileSync(resolve(root, "observability/tigerbeetle-drill-timing-contract.json"), "utf8"));
const fixture = JSON.parse(readFileSync(resolve(root, "test-fixtures/tigerbeetle-cni-correlation/cni-events.json"), "utf8"));

assert.equal(fixture.fixture_kind, "test_only", "fixture must remain explicitly test-only");
const required = new Set(schema.required);
const allowed = new Set(Object.keys(schema.properties));
const forbidden = new Set(contract.privacy.forbidden_fields);

function validateCorrelationRecord(record) {
  for (const field of required) assert.ok(field in record, `missing required correlation field ${field}`);
  for (const field of Object.keys(record)) {
    assert.ok(!forbidden.has(field), `forbidden privacy field ${field}`);
    assert.ok(allowed.has(field) || field === "cni", `unexpected correlation field ${field}`);
  }
  assert.equal(record.schema_version, "healthpoint.tigerbeetle.drill.v1");
  assert.equal(record.environment, "staging");
  assert.equal(record.service_name, "healthpoint-tigerbeetle-drill");
  assert.match(record.change_ticket, /^[A-Z][A-Z0-9]+-\d+$/);
  assert.match(record.correlation_key, /^tbdrill:[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/);
  assert.match(record.target_pod, new RegExp(`^${record.workload_name}-${record.target_ordinal}$`));
  assert.match(record.network_policy_uid ?? "", /^[0-9a-f-]{36}$/);
}

const safeRecords = fixture.records.slice(0, 2);
for (const record of safeRecords) validateCorrelationRecord(record);

assert.throws(() => validateCorrelationRecord(fixture.records[2]), /forbidden privacy field tenant_id/);

const active = safeRecords[0];
const dropValues = new Set(contract.elasticsearch.target_query.drop_values);
const cniDrops = safeRecords.filter(record => record.cni && dropValues.has(record.cni.verdict));
const targetMatches = cniDrops.filter(record =>
  record.cni.destination_namespace === active.k8s_namespace &&
  record.cni.destination_pod === active.target_pod &&
  record.cni.policy_uid === active.network_policy_uid
);
assert.equal(targetMatches.length, 1, "target query contract must match exactly one selected-policy drop");

const nonTargetMatchesForSelectedPolicy = cniDrops.filter(record =>
  record.cni.destination_namespace === active.k8s_namespace &&
  /^tigerbeetle-(0|1|3|4|5)$/.test(record.cni.destination_pod) &&
  record.cni.policy_uid === active.network_policy_uid
);
assert.equal(nonTargetMatchesForSelectedPolicy.length, 0, "selected policy must not match a non-target replica in the safe fixture");

for (const token of ["| json", "verdict=~", "destination_namespace", "policy_uid"]) {
  assert.ok(contract.loki.target_logql.includes(token), `Loki target query contract lacks ${token}`);
}
for (const token of ["time_window", "namespace", "policy_name_or_uid", "drop_verdict"]) {
  assert.ok(contract.elasticsearch.required_constraints.includes(token), `Elasticsearch contract lacks ${token}`);
}
assert.match(contract.loki.non_target_logql, /\(0\|1\|3\|4\|5\)/, "non-target query must enumerate all non-target ordinals");

assert.ok(Array.isArray(fixture.out_of_order_arrivals), "fixture must include out-of-order arrivals");
const arrivals = fixture.out_of_order_arrivals;
const applicationPolicyApplied = arrivals.find(event => event.source === "application" && event.event_type === "healthpoint.tigerbeetle.drill.policy_applied");
const selectedPolicyDrop = arrivals.find(event => event.source === "cni" && event.policy_uid === active.network_policy_uid && event.destination_pod === active.target_pod);
const unrelatedNonTargetDrop = arrivals.find(event => event.source === "cni" && event.destination_pod === "tigerbeetle-4");
assert.ok(applicationPolicyApplied && selectedPolicyDrop && unrelatedNonTargetDrop, "out-of-order fixture lacks expected application/CNI events");
assert.ok(new Date(selectedPolicyDrop.arrival_timestamp) < new Date(applicationPolicyApplied.arrival_timestamp), "fixture must model CNI arrival before delayed application log arrival");
assert.ok(new Date(applicationPolicyApplied.event_timestamp) < new Date(selectedPolicyDrop.event_timestamp), "policy application must precede the selected CNI drop in event time");
assert.equal(applicationPolicyApplied.correlation_key, selectedPolicyDrop.correlation_key, "correlation key must join delayed application and selected CNI events");
assert.equal(applicationPolicyApplied.policy_uid, selectedPolicyDrop.policy_uid, "policy UID must join delayed application and selected CNI events");
assert.notEqual(unrelatedNonTargetDrop.policy_uid, applicationPolicyApplied.policy_uid, "unrelated non-target drop must not join the selected policy");
const orderedByEventTime = [...arrivals].sort((left, right) => new Date(left.event_timestamp) - new Date(right.event_timestamp));
assert.equal(orderedByEventTime[0].source, "application", "correlation must use event timestamp, not arrival order");

assert.ok(fixture.clock_observations, "fixture must include clock observations");
const requiredRoles = new Set(timing.required_clock_observations);
const safeClockRoles = new Set(fixture.clock_observations.safe.map(observation => observation.role));
for (const role of requiredRoles) assert.ok(safeClockRoles.has(role), `safe timing observation is missing required role ${role}`);
assert.ok(fixture.clock_observations.safe.every(observation => Math.abs(observation.offset_seconds) <= timing.clock_offset_warning_seconds), "safe timing observations must remain within the warning offset envelope");
assert.ok(fixture.clock_observations.abort.some(observation => Math.abs(observation.offset_seconds) > timing.clock_offset_abort_seconds), "abort fixture must include an offset exceeding the hard no-go threshold");

console.log("TIGERBEETLE_CNI_QUERY_FIXTURES_VALID: safe correlation records pass; privacy-unsafe record is rejected; target and non-target query contracts isolate the selected policy deterministically; out-of-order arrivals and clock-skew warning/abort conditions are handled by event time and stable identifiers. Test-only result is not staging evidence.");
