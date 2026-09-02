import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workflow = resolve(".github/workflows/tigerbeetle-staging-drill-preflight.yml");
const text = readFileSync(workflow, "utf8");
const failures = [];
function mustContain(value) { if (!text.includes(value)) failures.push(`missing required workflow contract: ${value}`); }
function mustNotMatch(pattern, message) { if (pattern.test(text)) failures.push(message); }

for (const value of [
  "workflow_dispatch:",
  "environment: staging-tigerbeetle-drill",
  "runs-on: [self-hosted, linux, healthpoint-staging-gate]",
  "PAYMENT_EXECUTION_MODE: disabled",
  "node scripts/check-tigerbeetle-staging-pre-drill-gates.mjs",
  "Full 40-character reviewed commit SHA",
  "HEALTHPOINT_TIGERBEETLE_CHANGE_TICKET",
  "STAGING_PROMETHEUS_CA_B64",
  "STAGING_PROMETHEUS_CLIENT_CERT_B64",
  "STAGING_PROMETHEUS_CLIENT_KEY_B64",
  "Remove short-lived client credentials",
]) mustContain(value);

mustNotMatch(/^\s{0,2}(push|pull_request|schedule):/m, "staging pre-drill workflow must not run automatically on push, pull request, or schedule");
mustNotMatch(/run-tigerbeetle-(?:partition|quorum)-recovery-drill\.sh(?:\s+--execute)?/, "staging pre-drill workflow must not execute a TigerBeetle disruption script");
mustNotMatch(/\bkubectl\b/, "staging pre-drill workflow must not receive or invoke Kubernetes control-plane access");
mustNotMatch(/PAYMENT_EXECUTION_MODE:\s*(?:enabled|true)/i, "workflow must never enable payment execution");
mustNotMatch(/https:\/\/hooks\.slack\.com|routing[_-]?key\s*:/i, "workflow must not contain notification credentials or endpoints");

if (failures.length) {
  console.error("TIGERBEETLE_DRILL_WORKFLOW_INVALID");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(2);
}
console.log("TIGERBEETLE_DRILL_WORKFLOW_VALID: manual-only protected gate workflow has no automatic trigger, no Kubernetes execution, no payment enablement, and no inline notification secret");
