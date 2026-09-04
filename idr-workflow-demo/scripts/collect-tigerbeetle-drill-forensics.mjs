import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";

if (process.env.DRILL_FORENSICS_EXECUTION !== "protected") {
  throw new Error("DRILL_FORENSICS_EXECUTION=protected is required; local/test/mock forensic collection is prohibited.");
}
if (process.env.NODE_ENV === "test" || process.env.ALLOW_MOCK_FIXTURES === "true" || process.env.RELEASE_MODE === "mock") {
  throw new Error("Forensic collection refuses test/mock execution.");
}
const outcome = process.env.DRILL_OUTCOME;
if (!new Set(["successful", "aborted"]).has(outcome)) {
  throw new Error("DRILL_OUTCOME must equal successful or aborted.");
}
const outputDir = resolve(process.env.DRILL_FORENSICS_DIR ?? "artifacts/tigerbeetle-drill-forensics");
if (/mock|fixture|example|synthetic|dummy/i.test(outputDir)) {
  throw new Error("Forensic evidence directory must not be mock, fixture, example, synthetic, or dummy.");
}

const common = [
  "DRILL_RUN_SUMMARY",
  "DRILL_PRE_GATE_REPORT",
  "DRILL_PROMETHEUS_SNAPSHOT",
  "DRILL_ALERTMANAGER_EVENTS",
  "DRILL_KUBERNETES_EVENTS",
  "DRILL_READINESS_BEFORE_LOG",
  "DRILL_CLEANUP_VERIFICATION",
];
const outcomeSpecific = outcome === "successful"
  ? ["DRILL_READINESS_AFTER_LOG", "DRILL_RECOVERY_WINDOW_REPORT"]
  : ["DRILL_ABORT_REPORT", "DRILL_POST_ABORT_STATE"];
const fields = [...common, ...outcomeSpecific];
const sensitive = [
  /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/i,
  /https:\/\/hooks\.slack\.com\//i,
  /authorization\s*:\s*bearer\s+\S+/i,
  /(?:pagerduty_)?routing[_-]?key\s*[:=]\s*[^\s<]/i,
  /client[_-]?key(?:_pem)?\s*[:=]\s*[^\s<]/i,
];

mkdirSync(outputDir, { recursive: true, mode: 0o700 });
const manifest = {
  schemaVersion: 1,
  type: "tigerbeetle-staging-drill-forensics",
  execution: "protected",
  outcome,
  collectedAt: new Date().toISOString(),
  files: [],
};

for (const field of fields) {
  const source = process.env[field];
  if (!source) throw new Error(`Missing required forensic artifact variable ${field}`);
  const sourcePath = resolve(source);
  if (/mock|fixture|example|synthetic|dummy/i.test(sourcePath)) throw new Error(`${field} source path must not be mock, fixture, example, synthetic, or dummy`);
  if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) throw new Error(`${field} is not a readable file`);
  const bytes = readFileSync(sourcePath);
  if (bytes.length === 0) throw new Error(`${field} is empty`);
  const text = bytes.toString("utf8");
  if (sensitive.some(pattern => pattern.test(text))) throw new Error(`${field} appears to contain a secret or notification endpoint`);
  const destination = resolve(outputDir, `${field.toLowerCase()}.${basename(sourcePath).split(".").pop() || "log"}`);
  cpSync(sourcePath, destination, { mode: 0o600 });
  manifest.files.push({
    field,
    path: basename(destination),
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
writeFileSync(resolve(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`TIGERBEETLE_DRILL_FORENSICS_COLLECTED: outcome=${outcome} files=${manifest.files.length} directory=${outputDir}\n`);
