import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";

const root = process.cwd();
const output = resolve(
  root,
  process.env.CMS_HANDOFF_POLICY_REPORT ||
    "artifacts/cms-manual-handoff-policy.json"
);
const excludedDirectoryNames = new Set([
  ".git",
  "node_modules",
  "artifacts",
  "coverage",
  "dist",
  "test-results",
]);
const allowedExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".py", ".sh", ".yml", ".yaml", ".json", ""]);
const prohibited = [
  {
    id: "retired-cms-service",
    pattern: /cms-portal-automation-service/i,
    message: "Retired CMS portal automation service reference found",
  },
  {
    id: "legacy-http-cms-transport",
    pattern: /HttpCmsTransport\b/,
    message: "Legacy automated CMS HTTP transport reference found",
  },
  {
    id: "cms-api-credential",
    pattern: /\bCMS_(?:IDR_)?API_(?:BASE|KEY)\b|\bCMS_API_TOKEN\b/,
    message: "CMS API credential/configuration reference found",
  },
  {
    id: "cms-portal-api-route",
    pattern: /\/v1\/idr\/submissions\b/i,
    message: "Automated CMS submission route reference found",
  },
];
const selfPath = new URL(import.meta.url).pathname;
const policyImplementationPaths = new Set([
  selfPath,
  resolve(root, "scripts/validate-production-compose-env.mjs"),
]);
const rootsToScan = [
  "server",
  "scripts",
  "backend",
  "middleware",
  ".github",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.integration.yml",
  "README.md",
];

function collectFiles(path) {
  if (!existsSync(path)) return [];
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  if (!stat.isDirectory()) return [];
  const files = [];
  for (const entry of readdirSync(path)) {
    if (excludedDirectoryNames.has(entry)) continue;
    files.push(...collectFiles(join(path, entry)));
  }
  return files;
}

const findings = [];
for (const source of rootsToScan) {
  for (const path of collectFiles(resolve(root, source))) {
    const extension = extname(path);
    if (!allowedExtensions.has(extension) && basename(path) !== "Dockerfile") continue;
    if (policyImplementationPaths.has(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const rule of prohibited) {
      if (rule.pattern.test(text)) {
        findings.push({
          rule: rule.id,
          message: rule.message,
          path: relative(root, path),
        });
      }
    }
  }
}

const adapterPath = resolve(root, "server/services/cms-adapter.ts");
const outboxPath = resolve(root, "server/services/cms-outbox.ts");
const productionGatePath = resolve(root, "server/_core/production-gates.ts");
for (const [path, required, label] of [
  [adapterPath, "ManualCmsHandoffAdapter", "manual CMS handoff adapter"],
  [adapterPath, "recordHumanPortalReceipt", "human portal receipt recorder"],
  [outboxPath, "listPendingManualHandoffs", "manual handoff queue"],
  [productionGatePath, "CMS_AUTOMATION_ENABLED must remain false", "production CMS automation prohibition"],
]) {
  if (!existsSync(path) || !readFileSync(path, "utf8").includes(required)) {
    findings.push({
      rule: "required-manual-control",
      message: `Missing required ${label}`,
      path: relative(root, path),
    });
  }
}

const report = {
  valid: findings.length === 0,
  scannedAt: new Date().toISOString(),
  policy: "CMS is an authorized human portal handoff; automated API submission and polling are prohibited.",
  scannedRoots: rootsToScan,
  findingCount: findings.length,
  findings,
};
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.valid) process.exitCode = 2;
