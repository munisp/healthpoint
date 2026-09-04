#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const input = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!input) {
  console.error("Usage: verify-dapr-temporal-trace-correlation.mjs <redacted-trace-evidence.json>");
  process.exit(64);
}
if (process.env.HEALTHPOINT_ENVIRONMENT !== "staging") {
  console.error(JSON.stringify({ valid: false, reason: "staging_environment_required" }, null, 2));
  process.exit(2);
}
if (process.env.TRACE_EVIDENCE_ORIGIN !== "protected-staging-export") {
  console.error(JSON.stringify({ valid: false, reason: "protected_staging_export_marker_required" }, null, 2));
  process.exit(2);
}

let document;
try {
  document = JSON.parse(fs.readFileSync(input, "utf8"));
} catch {
  console.error(JSON.stringify({ valid: false, reason: "invalid_json_evidence" }, null, 2));
  process.exit(2);
}
const spans = Array.isArray(document.spans) ? document.spans : [];
const errors = [];
if (document.evidenceType !== "redacted-staging-trace-export") errors.push("redacted_staging_trace_export_type_required");
if (document.synthetic === true || document.nonProductionFixture === true) errors.push("synthetic_trace_evidence_is_not_accepted");
if (spans.length < 3) errors.push("at_least_three_spans_required");
const allowedKeys = new Set([
  "service.name", "service.namespace", "service.version", "deployment.environment.name",
  "healthpoint.component", "healthpoint.operation", "healthpoint.status", "healthpoint.outcome",
  "otel.status_code", "span.kind",
]);
const prohibitedKey = /(?:tenant|patient|member|user|email|dispute|document|payment|account|workflow_id|run_id|authorization|cookie|token|query|url|db\.statement|payload|body)/i;
const traceIds = new Set();
for (const span of spans) {
  if (!/^[a-f0-9]{32}$/i.test(span?.traceId ?? "")) errors.push("invalid_trace_id");
  if (!/^[a-f0-9]{16}$/i.test(span?.spanId ?? "")) errors.push("invalid_span_id");
  if (span?.traceId) traceIds.add(span.traceId.toLowerCase());
  const attributes = span?.attributes && typeof span.attributes === "object" ? span.attributes : {};
  for (const [key, value] of Object.entries(attributes)) {
    if (!allowedKeys.has(key) || prohibitedKey.test(key) || typeof value === "object") {
      errors.push(`unsafe_or_unapproved_attribute:${key}`);
    }
  }
}
if (traceIds.size !== 1) errors.push("single_w3c_trace_id_required");
const components = new Set(spans.map(span => span?.attributes?.["healthpoint.component"]));
for (const component of ["dapr", "temporal"]) {
  if (!components.has(component)) errors.push(`required_component_missing:${component}`);
}
const operations = new Set(spans.map(span => span?.attributes?.["healthpoint.operation"]));
if (![...operations].some(value => value === "workflow_start" || value === "workflow_describe" || value === "workflow_list")) {
  errors.push("temporal_operation_missing");
}
if (![...operations].some(value => value === "workflow_invoke" || value === "service_invoke")) {
  errors.push("dapr_invocation_operation_missing");
}
const report = {
  valid: errors.length === 0,
  source: input,
  traceId: traceIds.size === 1 ? [...traceIds][0] : undefined,
  spanCount: spans.length,
  observedComponents: [...components].filter(Boolean).sort(),
  observedOperations: [...operations].filter(Boolean).sort(),
  errors: [...new Set(errors)].sort(),
};
console.log(JSON.stringify(report, null, 2));
process.exit(report.valid ? 0 : 2);
