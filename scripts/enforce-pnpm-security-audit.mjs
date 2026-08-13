import { spawnSync } from "node:child_process";

const audit = spawnSync("pnpm", ["audit", "--json"], {
  encoding: "utf8",
  shell: process.platform === "win32",
});

if (!audit.stdout.trim()) {
  console.error(audit.stderr || "pnpm audit did not return JSON output");
  process.exit(2);
}

let report;
try {
  report = JSON.parse(audit.stdout);
} catch (error) {
  console.error("Unable to parse pnpm audit JSON:", error);
  process.exit(2);
}

const counts = report.metadata?.vulnerabilities ?? {};
const critical = Number(counts.critical ?? 0);
const high = Number(counts.high ?? 0);
const moderate = Number(counts.moderate ?? 0);
const low = Number(counts.low ?? 0);

console.log(JSON.stringify({ critical, high, moderate, low }, null, 2));

if (critical > 0 || high > 0) {
  console.error(`Dependency security gate failed: ${critical} critical and ${high} high findings.`);
  process.exit(1);
}

if (moderate > 0 || low > 0) {
  console.warn(`Dependency security gate passed with ${moderate} moderate and ${low} low findings requiring tracked review.`);
}
