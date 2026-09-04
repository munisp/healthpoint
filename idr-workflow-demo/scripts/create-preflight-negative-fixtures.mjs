import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const root = process.cwd();
const outputArg = process.argv.find(arg => arg.startsWith("--output-dir="))?.slice("--output-dir=".length);
if (!outputArg) {
  throw new Error("Usage: node scripts/create-preflight-negative-fixtures.mjs --output-dir=<test-fixture directory>");
}
const outputDir = resolve(root, outputArg);
const rel = relative(root, outputDir);
if (isAbsolute(rel) || rel.startsWith("..") || !/(?:test-fixtures|fixtures|negative-test)/.test(rel)) {
  throw new Error("Refusing to create fixtures outside a repository-local test-fixtures, fixtures, or negative-test directory.");
}
const names = [
  "data_use_approval_record",
  "georgetown_model_artifact",
  "georgetown_validation_dataset",
  "georgetown_calibration_report",
  "georgetown_approval_record",
  "cms_pilot_authorization_record",
  "cms_submission_evidence",
  "cms_receipt_evidence",
  "cms_feedback_evidence",
  "cms_certification_record",
  "payment_provider_certification",
  "payment_callback_evidence",
  "payment_ledger_report",
  "payment_reconciliation_report",
  "payment_approval_record",
  "staging_e2e_evidence",
  "document_analysis_evidence",
  "operations_recovery_evidence",
  "operations_approval_record",
  "hipaa_risk_analysis",
  "baa_or_legal_review",
  "assurance_record",
  "regulatory_content_governance",
  "compliance_approval_record",
];
mkdirSync(outputDir, { recursive: true });
const manifest = {
  fixtureClass: "synthetic-negative-test",
  prohibition: "These files are deliberately invalid and must never be used as approval evidence or release inputs.",
  expectedValidationResult: "blocked",
  generatedAt: new Date().toISOString(),
  files: [],
};
for (const name of names) {
  const filename = `${name}.json`;
  const body = {
    fixture_class: "synthetic-negative-test",
    non_production: true,
    purpose: "Proves protected preflight rejects placeholder external evidence.",
    evidence_name: name,
    prohibited_for_release: true,
  };
  writeFileSync(resolve(outputDir, filename), `${JSON.stringify(body, null, 2)}\n`, { flag: "w", mode: 0o600 });
  manifest.files.push(filename);
}
writeFileSync(resolve(outputDir, "NON_PRODUCTION_NEGATIVE_TEST_ONLY.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "w", mode: 0o600 });
console.log(JSON.stringify({ created: names.length, outputDir, expectedValidationResult: "blocked" }, null, 2));
