import { readFile } from "node:fs/promises";

const releaseMode = process.argv.includes("--release");
const manifestPath = new URL("../assurance/claim-manifest.json", import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const allowedStatuses = new Set(["verified", "blocked", "incomplete", "retired", "not_applicable"]);
const errors = [];

if (manifest.schemaVersion !== 1) errors.push("Unsupported or missing manifest schemaVersion");
if (!Array.isArray(manifest.claims) || manifest.claims.length === 0) errors.push("Manifest contains no material claims");
const seen = new Set();
for (const claim of manifest.claims ?? []) {
  for (const key of ["id", "claim", "source", "entryPoints", "evidence", "status", "limitations"]) {
    if (claim[key] === undefined || claim[key] === null || claim[key] === "") errors.push(`${claim.id ?? "unknown"}: missing ${key}`);
  }
  if (seen.has(claim.id)) errors.push(`Duplicate claim identifier: ${claim.id}`);
  seen.add(claim.id);
  if (!allowedStatuses.has(claim.status)) errors.push(`${claim.id}: invalid status ${claim.status}`);
}
if (errors.length) {
  console.error("ASSURANCE_MANIFEST_INVALID");
  errors.forEach(error => console.error(`- ${error}`));
  process.exit(1);
}
const blockers = manifest.claims.filter(claim => claim.status === "blocked" || claim.status === "incomplete");
console.log(`ASSURANCE_MANIFEST_VALID claims=${manifest.claims.length} blockers=${blockers.length}`);
if (releaseMode && blockers.length) {
  console.error("RELEASE_DECISION=NOT_RELEASEABLE");
  blockers.forEach(claim => console.error(`- ${claim.id}: ${claim.limitations}`));
  process.exit(2);
}
console.log(releaseMode ? "RELEASE_DECISION=RELEASEABLE" : "ASSURANCE_DECISION=EVIDENCE_INVENTORY_ONLY");
