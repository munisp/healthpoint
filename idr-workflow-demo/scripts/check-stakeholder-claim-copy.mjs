import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = process.cwd();
const output = resolve(root, process.env.STAKEHOLDER_CLAIM_COPY_REPORT || "artifacts/stakeholder-claim-copy.json");
mkdirSync(resolve(output, ".."), { recursive: true });
const prohibited = [
  [/(?:automatically|auto(?:mated)?)\s+(?:submit|submits|submission)\s+(?:to\s+)?cms/i, "unsupported-automatic-cms-claim"],
  [/(?:georgetown|idr)\s+(?:model|engine).{0,80}(?:validated|approved|production[- ]ready|certified)/i, "unsupported-model-governance-claim"],
  [/(?:hipaa|soc\s*2|hitrust)\s+(?:compliant|certified|approved)/i, "unsupported-compliance-claim"],
  [/(?:95|99|100)\s*%\s*(?:accuracy|success|win|automation|reduction)/i, "unsupported-performance-claim"],
  [/\b(?:most complete|best[- ]in[- ]class|market[- ]leading)\b/i, "unsupported-superlative-claim"],
];
const excludedDirs = new Set(["node_modules", ".git", "dist", "artifacts", "coverage", "test-results"]);
function collect(path) {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap(name => excludedDirs.has(name) ? [] : collect(join(path, name)));
}
const findings = [];
for (const sourceRoot of ["client/src", "server"]) {
  for (const path of collect(resolve(root, sourceRoot))) {
    if (!/\.(?:ts|tsx)$/i.test(path) || /\.test\.(?:ts|tsx)$/.test(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const [pattern, rule] of prohibited) {
      if (pattern.test(text)) findings.push({ path: relative(root, path), rule });
    }
  }
}
const report = {
  valid: findings.length === 0,
  generatedAt: new Date().toISOString(),
  policy: "Active product copy may describe implemented controls but must not assert unsupported external performance, automated CMS submission, governance approval, compliance certification, or superlatives.",
  findings,
};
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.valid) process.exitCode = 2;
