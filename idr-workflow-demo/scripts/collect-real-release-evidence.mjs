import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
  mkdirSync,
  cpSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

if (process.env.EVIDENCE_EXECUTION !== "protected") {
  throw new Error(
    "EVIDENCE_EXECUTION=protected is required; local, mock, and ad-hoc evidence collection is prohibited."
  );
}
if (
  process.env.NODE_ENV === "test" ||
  process.env.RELEASE_MODE === "mock" ||
  process.env.ALLOW_MOCK_FIXTURES === "true"
) {
  throw new Error(
    "Real-evidence collection refuses test/mock mode; unset ALLOW_MOCK_FIXTURES and use a controlled evidence directory"
  );
}

const outputDir = resolve(
  process.env.REAL_EVIDENCE_DIR || "artifacts/real-external-evidence"
);
if (
  outputDir.includes("mock") ||
  outputDir.includes("fixture") ||
  outputDir.includes("example")
) {
  throw new Error(`Refusing a mock/fixture output directory: ${outputDir}`);
}
mkdirSync(outputDir, { recursive: true });
const marker =
  /placeholder|synthetic|dummy|mock|fake|todo|tbd|changeme|local-integration/i;
const fields = [
  "DATA_USE_APPROVAL_RECORD",
  "GEORGETOWN_MODEL_ARTIFACT",
  "GEORGETOWN_VALIDATION_DATASET",
  "GEORGETOWN_CALIBRATION_REPORT",
  "GEORGETOWN_APPROVAL_RECORD",
  "CMS_PILOT_AUTHORIZATION_RECORD",
  "CMS_SUBMISSION_EVIDENCE",
  "CMS_RECEIPT_EVIDENCE",
  "CMS_FEEDBACK_EVIDENCE",
  "CMS_CERTIFICATION_RECORD",
  "PAYMENT_PROVIDER_CERTIFICATION",
  "PAYMENT_CALLBACK_EVIDENCE",
  "PAYMENT_LEDGER_REPORT",
  "PAYMENT_RECONCILIATION_REPORT",
  "PAYMENT_APPROVAL_RECORD",
  "STAGING_E2E_EVIDENCE",
  "DOCUMENT_ANALYSIS_EVIDENCE",
  "OPERATIONS_RECOVERY_EVIDENCE",
  "OPERATIONS_APPROVAL_RECORD",
  "HIPAA_RISK_ANALYSIS",
  "BAA_OR_LEGAL_REVIEW",
  "ASSURANCE_RECORD",
  "REGULATORY_CONTENT_GOVERNANCE",
  "COMPLIANCE_APPROVAL_RECORD",
];
const manifest = {
  generatedAt: new Date().toISOString(),
  productionUse: true,
  files: [],
};
const env = {};
for (const field of fields) {
  const source = process.env[field];
  if (!source)
    throw new Error(`Missing required real evidence variable ${field}`);
  const sourcePath = resolve(source);
  if (!existsSync(sourcePath) || !statSync(sourcePath).isFile())
    throw new Error(`${field} is not a readable file: ${sourcePath}`);
  const bytes = readFileSync(sourcePath);
  const text = bytes.toString("utf8");
  if (!bytes.length || marker.test(sourcePath) || marker.test(text))
    throw new Error(`${field} contains placeholder/test markers or is empty`);
  const destination = resolve(outputDir, `${field.toLowerCase()}.json`);
  cpSync(sourcePath, destination);
  const hash = createHash("sha256").update(bytes).digest("hex");
  env[field] = destination;
  manifest.files.push({
    field,
    path: destination,
    source: sourcePath,
    bytes: bytes.length,
    sha256: hash,
  });
}
writeFileSync(
  resolve(outputDir, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`
);
const validation = spawnSync(
  process.execPath,
  [resolve(process.cwd(), "scripts/validate-external-release-blockers.mjs")],
  {
    env: {
      ...process.env,
      ...env,
      EVIDENCE_EXECUTION: "protected",
      RELEASE_EVIDENCE_DIR: outputDir,
      RELEASE_BLOCKER_REPORT: resolve(outputDir, "validation.json"),
    },
    encoding: "utf8",
  }
);
process.stdout.write(validation.stdout || "");
process.stderr.write(validation.stderr || "");
if (validation.status !== 0) process.exit(validation.status ?? 2);
console.log(`Real release evidence validated in ${outputDir}`);
