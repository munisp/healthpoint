import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const root = process.cwd();
const output = resolve(
  root,
  process.env.PLATFORM_INDEPENDENCE_REPORT || "artifacts/platform-independence.json"
);
const excludedDirectories = new Set([
  ".git",
  "node_modules",
  "artifacts",
  "coverage",
  "dist",
  "test-results",
]);
const allowedExtensions = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".yml", ".yaml", ".sh", ".py", ".go", ".rs", ".md", "",
]);
const rootsToScan = [
  "server",
  "client",
  "scripts",
  "backend",
  "middleware",
  "deploy",
  "helm",
  ".github",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.integration.yml",
  "package.json",
  "README.md",
];
const selfPath = new URL(import.meta.url).pathname;
const prohibited = [
  { id: "manus-package", pattern: /(?:@manus[-/]|manus[-_]oauth|manus[-_]api)/i },
  { id: "manus-runtime", pattern: /\b(?:MANUS_API_KEY|MANUS_OAUTH|MANUS_PROJECT|MANUS_ENDPOINT)\b/i },
  { id: "manus-host", pattern: /(?:manus\.im|manus\.ai|manus-sandbox)/i },
  { id: "manus-import", pattern: /from\s+["'][^"']*manus[^"']*["']|require\(["'][^"']*manus[^"']*["']\)/i },
];

function collect(path) {
  if (!existsSync(path)) return [];
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  if (!stat.isDirectory()) return [];
  const paths = [];
  for (const entry of readdirSync(path)) {
    if (excludedDirectories.has(entry)) continue;
    paths.push(...collect(join(path, entry)));
  }
  return paths;
}

const findings = [];
for (const scanRoot of rootsToScan) {
  for (const path of collect(resolve(root, scanRoot))) {
    const extension = extname(path);
    if (!allowedExtensions.has(extension) && basename(path) !== "Dockerfile") continue;
    const rel = relative(root, path);
    if (path !== selfPath && /manus/i.test(rel)) {
      findings.push({ rule: "manus-filename", path: rel, message: "Legacy Manus reference in active filename" });
    }
    if (path === selfPath) continue;
    const source = readFileSync(path, "utf8");
    for (const rule of prohibited) {
      if (rule.pattern.test(source)) {
        findings.push({ rule: rule.id, path: rel, message: "Legacy Manus dependency or endpoint reference found" });
      }
    }
  }
}
const report = {
  valid: findings.length === 0,
  generatedAt: new Date().toISOString(),
  policy: "The production platform must run independently of Manus-specific SDKs, OAuth, endpoints, runtime credentials, and service names.",
  scannedRoots: rootsToScan,
  findingCount: findings.length,
  findings,
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.valid) process.exitCode = 2;
