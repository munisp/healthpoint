import fs from "node:fs";

const auditPath = process.argv[2];
if (!auditPath) {
  console.error("Usage: node scripts/summarize-pnpm-audit.mjs <pnpm-audit.json>");
  process.exit(2);
}

const audit = JSON.parse(fs.readFileSync(auditPath, "utf8"));
const advisories = Object.values(audit.advisories ?? {});
const findings = advisories
  .filter(advisory => ["critical", "high"].includes(advisory.severity))
  .map(advisory => ({
    severity: advisory.severity,
    module: advisory.module_name,
    advisory: advisory.github_advisory_id ?? advisory.id,
    patched: advisory.patched_versions ?? "No patched version supplied",
    paths: advisory.findings?.flatMap(finding => finding.paths ?? []).slice(0, 3) ?? [],
  }))
  .sort((a, b) => a.severity.localeCompare(b.severity) || a.module.localeCompare(b.module));

console.log(JSON.stringify({
  counts: audit.metadata?.vulnerabilities ?? {},
  criticalAndHigh: findings,
}, null, 2));
