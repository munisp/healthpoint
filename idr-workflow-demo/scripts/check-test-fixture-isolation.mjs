import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = process.cwd();
const output = resolve(root, process.env.TEST_FIXTURE_ISOLATION_REPORT || "artifacts/test-fixture-isolation.json");
mkdirSync(resolve(output, ".."), { recursive: true });
const prohibited = [
  /from\s+["'][^"']*(?:test-fixtures|test-infra-fallback)[^"']*["']/,
  /import\s*\(\s*["'][^"']*(?:test-fixtures|test-infra-fallback)[^"']*["']\s*\)/,
];
const excludedDirs = new Set(["node_modules", ".git", "dist", "artifacts", "coverage", "test-results"]);
function collect(dir) {
  if (!existsSync(dir)) return [];
  const stat = statSync(dir);
  if (stat.isFile()) return [dir];
  return readdirSync(dir).flatMap(name => excludedDirs.has(name) ? [] : collect(join(dir, name)));
}
const findings = [];
for (const path of collect(resolve(root, "server"))) {
  if (!/\.tsx?$/i.test(path) || /(?:\.test\.ts|\.spec\.ts|\/test-fixtures\/|\/test-infra-fallback\.ts$)/.test(path)) continue;
  const text = readFileSync(path, "utf8");
  for (const pattern of prohibited) {
    if (pattern.test(text)) findings.push({ path: relative(root, path), rule: "production-imports-test-fixture" });
  }
}
const report = {
  valid: findings.length === 0,
  generatedAt: new Date().toISOString(),
  policy: "Production server modules must not import test fixtures, mock stores, or test-infrastructure fallbacks.",
  findings,
};
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.valid) process.exitCode = 2;
