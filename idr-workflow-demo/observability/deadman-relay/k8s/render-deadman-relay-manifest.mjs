#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const templatePath = path.join(root, "deadman-relay.yaml.template");
const outputPath = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!outputPath) {
  console.error("Usage: render-deadman-relay-manifest.mjs <output-path>");
  process.exit(64);
}

const required = [
  "DEADMAN_RELAY_IMAGE",
  "APPROVED_ALERTMANAGER_EGRESS_CIDR",
  "APPROVED_HEALTH_PROBE_EGRESS_CIDR",
  "APPROVED_HEALTHCHECKS_EGRESS_CIDR",
];
const values = Object.fromEntries(required.map(key => [key, process.env[key]?.trim() ?? ""]));
const missing = required.filter(key => !values[key]);
if (missing.length) {
  console.error(JSON.stringify({ valid: false, reason: "missing_required_environment", missing }, null, 2));
  process.exit(2);
}
if (!/^.+@sha256:[a-f0-9]{64}$/.test(values.DEADMAN_RELAY_IMAGE)) {
  console.error(JSON.stringify({ valid: false, reason: "deadman_relay_image_must_be_digest_pinned" }, null, 2));
  process.exit(2);
}
const ipv4Cidr = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\/(?:[0-9]|[12]\d|3[0-2])$/;
const invalidCidrs = required.slice(1).filter(key => !ipv4Cidr.test(values[key]));
if (invalidCidrs.length) {
  console.error(JSON.stringify({ valid: false, reason: "approved_egress_cidrs_must_be_ipv4_cidrs", invalidCidrs }, null, 2));
  process.exit(2);
}
const namespace = process.env.DEADMAN_RELAY_NAMESPACE?.trim() || "healthpoint-external-observability";
if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(namespace)) {
  console.error(JSON.stringify({ valid: false, reason: "invalid_namespace" }, null, 2));
  process.exit(2);
}
const replacements = { ...values, DEADMAN_RELAY_NAMESPACE: namespace };
let rendered = fs.readFileSync(templatePath, "utf8");
for (const [key, value] of Object.entries(replacements)) {
  rendered = rendered.replaceAll(`\${${key}}`, value);
}
if (/\$\{[A-Z0-9_]+\}/.test(rendered)) {
  console.error(JSON.stringify({ valid: false, reason: "unresolved_template_token" }, null, 2));
  process.exit(2);
}
fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o750 });
fs.writeFileSync(outputPath, rendered, { mode: 0o640 });
console.log(JSON.stringify({ valid: true, output: outputPath, namespace, image: values.DEADMAN_RELAY_IMAGE }, null, 2));
