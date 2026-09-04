import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

const root = process.cwd();
const rendered = process.argv.includes("--rendered");
const baseDirectory = rendered
  ? resolve(root, process.env.EXTERNAL_GATES_RENDERED_DIR || "")
  : resolve(root, "infrastructure/external-gates-staging/k8s");
const reportFile = resolve(root, process.env.EXTERNAL_GATES_POLICY_REPORT || "artifacts/external-gates-template-policy.json");
const requiredComponents = ["mojaloop", "permify", "keycloak", "fluvio", "openappsec"];
const requiredSecrets = {
  mojaloop: ["ca.crt", "tls.crt", "tls.key", "jws-signing-key.pem"],
  permify: ["database_uri", "runtime_bearer_token", "tls.crt", "tls.key", "ca.crt"],
  keycloak: ["username", "password", "tls.crt", "tls.key", "healthpoint_oidc_client_secret", "admin_username", "admin_password"],
  fluvio: ["ca.crt", "tls.crt", "tls.key"],
  openappsec: ["agent_token", "tls.crt", "tls.key"],
};

function collect(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...collect(path));
    else if (/\.(ya?ml|json)$/i.test(entry) || entry.endsWith(".template")) files.push(path);
  }
  return files.sort();
}

function add(rule, path, message) {
  findings.push({ rule, path: relative(root, path), message });
}

function hasAll(text, values) {
  return values.every(value => text.includes(`secretKey: ${value}`));
}

function isPrivateRuntimeUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
      || host.endsWith(".svc.cluster.local")
      || host.endsWith(".internal");
  } catch {
    return false;
  }
}

const findings = [];
const candidates = collect(baseDirectory);
if (candidates.length === 0) {
  findings.push({ rule: "no-input", path: relative(root, baseDirectory), message: "No external-gate manifests found for policy validation" });
}

for (const component of requiredComponents) {
  const path = join(baseDirectory, component);
  if (!existsSync(path)) findings.push({ rule: "missing-component-package", path: relative(root, path), message: `Missing ${component} staging package` });
}

for (const path of candidates) {
  const text = readFileSync(path, "utf8");
  const component = requiredComponents.find(name => path.includes(`/${name}/`));
  const sourceTemplate = path.endsWith(".template");

  if (!sourceTemplate || rendered) {
    if (/\$\{[^}]+\}|REPLACE(?:_|-)|<[^>]+>/i.test(text)) {
      add("unresolved-token", path, "Rendered manifest has an unresolved deployment token");
    }
    for (const match of text.matchAll(/^\s*image:\s*([^\s#]+)/gim)) {
      if (!/@sha256:[a-f0-9]{64}$/i.test(match[1])) {
        add("mutable-image", path, `Container image is not pinned by a sha256 digest: ${match[1]}`);
      }
    }
    for (const match of text.matchAll(/https?:\/\/[^\s'"}]+/gi)) {
      const value = match[0].replace(/[),]+$/, "");
      const lineStart = text.lastIndexOf("\n", match.index) + 1;
      const lineEnd = text.indexOf("\n", match.index);
      const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
      if (/^\s*helm_(?:repository|chart)\s*:/i.test(line)) continue;
      if (!isPrivateRuntimeUrl(value)) add("non-private-runtime-endpoint", path, `Runtime endpoint is not private HTTPS: ${value}`);
    }
  } else {
    for (const match of text.matchAll(/^\s*image:\s*([^\s#]+)/gim)) {
      if (!/^\$\{[A-Z0-9_]*IMAGE[A-Z0-9_]*\}$/.test(match[1]) && !/@sha256:[a-f0-9]{64}$/i.test(match[1])) {
        add("invalid-source-image-contract", path, "Source image must be a digest or a named IMAGE_DIGEST render variable");
      }
    }
  }

  const nonCredentialKeys = new Set(["secret", "secretkey", "secretname", "secretstoreref", "remoteref", "tlssecret", "usernamesecret", "passwordsecret", "automountserviceaccounttoken"]);
  const inlineSecret = [...text.matchAll(/^\s*([a-z0-9_.-]*(?:password|token|secret|private.?key)[a-z0-9_.-]*)\s*:\s*(.+)$/gim)]
    .find(match => !nonCredentialKeys.has(match[1].toLowerCase()) && !/^\$\{|^\{|^\|$/.test(match[2].trim()));
  if (inlineSecret) {
    add("inline-secret", path, `Manifest appears to place a credential in source: ${inlineSecret[1]}`);
  }
  if (/privileged:\s*true|host(?:Network|PID|IPC):\s*true|hostPath\s*:/i.test(text)) {
    add("unsafe-workload", path, "Privileged mode, host namespace sharing, or hostPath is prohibited");
  }
  if (component && component !== "fluvio" && !text.includes("kind: ExternalSecret")) {
    add("missing-external-secret", path, `${component} package needs an ExternalSecret projection`);
  }
  if (component && requiredSecrets[component] && text.includes("kind: ExternalSecret") && !hasAll(text, requiredSecrets[component])) {
    add("incomplete-external-secret", path, `${component} ExternalSecret does not project all required keys`);
  }
  if (component === "mojaloop" && /mojaloop(?:[_-](?:database|datastore|engine))*\s*:\s*(?:postgres|postgresql)\b|mojaloop[^\n]{0,80}(?:uses|backed by|engine)\s+(?:postgres|postgresql)\b/i.test(text)) {
    add("mojaloop-postgresql-claim", path, "Mojaloop must remain datastore-isolated and must not be declared PostgreSQL-backed");
  }
  if (component === "fluvio" && /enabled:\s*["']?true/i.test(text) && !/application_integration:\s*verified/i.test(text)) {
    add("fluvio-premature-activation", path, "Fluvio cannot be enabled until verified application integration is recorded");
  }
}

const terraform = resolve(root, "infrastructure/external-gates-staging/terraform/main.tf");
if (!existsSync(terraform)) {
  findings.push({ rule: "missing-terraform-guard", path: relative(root, terraform), message: "Cloud-agnostic external-gates Terraform guard is required" });
} else {
  const text = readFileSync(terraform, "utf8");
  for (const requiredText of ["fluvio_application_integration_approved", "mojaloop_datastore_engine", "@sha256", "secret_manager_references"]) {
    if (!text.includes(requiredText)) add("incomplete-terraform-guard", terraform, `Terraform guard lacks ${requiredText}`);
  }
}

mkdirSync(resolve(root, "artifacts"), { recursive: true });
const report = {
  valid: candidates.length > 0 && findings.length === 0,
  mode: rendered ? "rendered" : "source-template",
  generatedAt: new Date().toISOString(),
  scannedFiles: candidates.map(path => relative(root, path)),
  findingCount: findings.length,
  findings,
};
writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.valid) process.exitCode = 2;
