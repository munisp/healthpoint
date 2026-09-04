import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

const root = process.cwd();
const rendered = process.argv.includes("--rendered");
const output = resolve(
  root,
  process.env.MANIFEST_POLICY_REPORT || "artifacts/production-manifest-policy.json"
);
const excluded = new Set([".git", "node_modules", "artifacts", "coverage", "dist", "test-results"]);
const roots = rendered
  ? [process.env.RENDERED_MANIFEST_DIR || ""]
  : ["Dockerfile", "Dockerfile.ai-fraud", "docker-compose.yml", "k8s", "deploy", "helm"];

function collect(path) {
  if (!path || !existsSync(path)) return [];
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  if (!stat.isDirectory()) return [];
  const files = [];
  for (const entry of readdirSync(path)) {
    if (excluded.has(entry)) continue;
    files.push(...collect(join(path, entry)));
  }
  return files;
}

const candidates = roots.flatMap(item => collect(resolve(root, item))).filter(path => {
  const name = basename(path);
  return name === "Dockerfile" || name.startsWith("Dockerfile.") || /\.(ya?ml|json)$/i.test(name);
});
const findings = [];
const rules = [
  ["mutable-image", /(?:^|\s)image:\s*[^\s@#]+(?::(?:latest|edge|main|master))?\s*(?:#.*)?$/im, "Manifest uses a mutable or unpinned container image"],
  ["privileged", /privileged:\s*true\b/i, "Privileged container is prohibited"],
  ["host-namespace", /host(?:Network|PID|IPC):\s*true\b/i, "Host namespace sharing is prohibited"],
  ["host-path", /\bhostPath\s*:/i, "Kubernetes hostPath mount is prohibited"],
  ["root-user", /runAsUser:\s*0\b|USER\s+root\b/i, "Root container execution is prohibited"],
  ["writable-root-filesystem", /readOnlyRootFilesystem:\s*false\b/i, "Writable root filesystem is prohibited"],
  ["embedded-basic-credential", /(?:https?|postgres(?:ql)?|redis(?:s)?):\/\/[^\s:@/]+:[^\s@/]+@/i, "Embedded Basic-style credential is prohibited"],
  ["disabled-security", /(?:tls|ssl|verify(?:_ssl|Tls)?)[^\n#]*[:=]\s*(?:false|0|disabled)\b/i, "Disabled transport/security verification is prohibited"],
  ["unresolved-token", /(?:REPLACE_WITH|<[^>]+>|\$\{(?:SECRET|TOKEN|PASSWORD|IMAGE)[^}]*\})/i, "Unresolved deployment token is prohibited"],
];
for (const path of candidates) {
  const text = readFileSync(path, "utf8");
  // The application image is resolved by render-production-manifests.mjs from a
  // protected immutable digest. All other unresolved tokens remain prohibited.
  const policyText = rendered ? text : text.replaceAll("${HEALTHPOINT_APP_IMAGE}", "healthpoint-template-image@sha256:0000000000000000000000000000000000000000000000000000000000000000");
  for (const [rule, pattern, message] of rules) {
    if (pattern.test(policyText)) findings.push({ rule, path: relative(root, path), message });
  }
  if (/^FROM\s+[^\s@]+$/im.test(policyText)) {
    findings.push({ rule: "unpinned-docker-base", path: relative(root, path), message: "Docker base image must be pinned by immutable digest" });
  }
}
const report = {
  valid: candidates.length > 0 && findings.length === 0,
  generatedAt: new Date().toISOString(),
  mode: rendered ? "rendered" : "source",
  manifestCount: candidates.length,
  scannedFiles: candidates.map(path => relative(root, path)),
  findingCount: findings.length,
  findings,
};
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.valid) process.exitCode = 2;
