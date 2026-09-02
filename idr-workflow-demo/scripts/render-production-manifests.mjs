import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

const root = process.cwd();
const outputDir = resolve(root, process.env.RENDERED_MANIFEST_DIR || "artifacts/rendered-production-manifests");
const reportPath = resolve(root, process.env.MANIFEST_RENDER_REPORT || "artifacts/manifest-render.json");
const sources = ["k8s", "deploy", "helm", "docker-compose.production.yml", "docker-compose.prod.yml"];
const ignored = new Set([".git", "node_modules", "artifacts", "coverage", "dist", "test-results"]);
const templateValues = {
  HEALTHPOINT_APP_IMAGE: process.env.HEALTHPOINT_APP_IMAGE?.trim() || "",
};

function collect(path) {
  if (!existsSync(path)) return [];
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  if (!stat.isDirectory()) return [];
  return readdirSync(path).flatMap(name => ignored.has(name) ? [] : collect(join(path, name)));
}

function validateImage(image) {
  return /^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/i.test(image);
}

function renderSource(source, report) {
  const rel = relative(root, source);
  let content = readFileSync(source, "utf8");
  content = content.replace(/\$\{(HEALTHPOINT_APP_IMAGE)\}/g, (_match, key) => {
    const value = templateValues[key];
    if (!value) {
      report.errors.push(`${rel}: ${key} is required to render the production application deployment`);
      return `__UNRESOLVED_${key}__`;
    }
    if (!validateImage(value)) {
      report.errors.push(`${rel}: ${key} must be an immutable image reference ending in @sha256:<64 hex characters>`);
      return `__INVALID_${key}__`;
    }
    return value;
  });
  if (/\$\{[A-Z0-9_]+\}|__UNRESOLVED_|__INVALID_/g.test(content)) {
    report.errors.push(`${rel}: unresolved or invalid deployment token remains after rendering`);
  }
  const destination = join(outputDir, rel);
  mkdirSync(resolve(destination, ".."), { recursive: true });
  writeFileSync(destination, content);
  report.renderedFiles.push(rel);
}

const sourceFiles = sources
  .flatMap(source => collect(resolve(root, source)))
  .filter(path => /(?:\.ya?ml|\.json)$/i.test(basename(path)));

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });
const report = {
  valid: sourceFiles.length > 0,
  generatedAt: new Date().toISOString(),
  outputDir,
  sources,
  renderedFiles: [],
  errors: [],
};
if (!sourceFiles.length) {
  report.errors.push("No production Kubernetes/Helm/Compose manifest source is present. The disposable docker-compose.integration.yml is intentionally excluded and cannot satisfy production preflight.");
} else {
  for (const source of sourceFiles) renderSource(source, report);
}
report.valid = report.valid && report.errors.length === 0;
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.valid) process.exitCode = 2;
