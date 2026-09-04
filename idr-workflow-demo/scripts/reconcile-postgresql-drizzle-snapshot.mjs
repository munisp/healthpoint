#!/usr/bin/env node
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const meta = join(root, "drizzle", "migrations", "meta");
const journalPath = join(meta, "_journal.json");
const priorSnapshotPath = join(meta, "0037_snapshot.json");
const candidatePath = join(
  root,
  "artifacts",
  "drizzle-reconciliation-generated",
  "meta",
  "0002_snapshot.json"
);
const targetPath = join(meta, "0038_snapshot.json");
const write = process.argv.includes("--write");
const requiredTables = [
  "public.cms_submissions",
  "public.cms_submission_outbox",
  "public.document_analysis_jobs",
  "public.dispute_workflow_transitions",
  "public.file_quarantine_jobs",
  "public.model_governance_models",
  "public.model_validation_runs",
  "public.document_validation_runs",
  "public.document_validation_step_evidence",
  "public.outcome_predictions",
  "public.stakeholder_claim_evidence_bundles",
  "public.stakeholder_claim_evidence_artifacts",
  "public.stakeholder_claim_reviewer_attestations",
  "public.stakeholder_claim_signing_keys",
];
const errors = [];
if (!existsSync(candidatePath))
  errors.push(`Missing schema-derived candidate snapshot: ${candidatePath}`);
if (!existsSync(priorSnapshotPath))
  errors.push(`Missing prior canonical snapshot: ${priorSnapshotPath}`);
if (!existsSync(journalPath))
  errors.push(`Missing canonical journal: ${journalPath}`);
if (errors.length) {
  console.error(JSON.stringify({ reconciled: false, errors }, null, 2));
  process.exit(2);
}
const candidate = JSON.parse(readFileSync(candidatePath, "utf8"));
const prior = JSON.parse(readFileSync(priorSnapshotPath, "utf8"));
const journal = JSON.parse(readFileSync(journalPath, "utf8"));
if (candidate.dialect !== "postgresql")
  errors.push(
    `Candidate snapshot dialect must be postgresql; received ${candidate.dialect}`
  );
if (prior.dialect !== "postgresql")
  errors.push(
    `Prior snapshot dialect must be postgresql; received ${prior.dialect}`
  );
if (
  !journal.entries.some(
    entry => entry.tag === "0038_stakeholder_attestation_signatures"
  )
)
  errors.push(
    "Canonical journal does not register 0038_stakeholder_attestation_signatures"
  );
for (const table of requiredTables)
  if (!candidate.tables?.[table])
    errors.push(`Candidate snapshot is missing ${table}`);
if (errors.length) {
  console.error(JSON.stringify({ reconciled: false, errors }, null, 2));
  process.exit(2);
}
const reconciled = { ...candidate, prevId: prior.id };
const result = {
  reconciled: write,
  targetPath,
  candidateId: candidate.id,
  predecessorId: prior.id,
  tableCount: Object.keys(candidate.tables).length,
  requiredTableCount: requiredTables.length,
};
if (!write) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(2);
}
if (existsSync(targetPath))
  copyFileSync(targetPath, `${targetPath}.pre-reconciliation.bak`);
writeFileSync(targetPath, `${JSON.stringify(reconciled, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
