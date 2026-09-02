import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";

const root = process.cwd();
const output = resolve(
  root,
  process.env.PRODUCTION_COMPOSE_ENV_REPORT || "artifacts/production-compose-environment.json"
);
const requested = process.env.PRODUCTION_COMPOSE_FILE?.trim();
const deploymentMode = (process.env.PRODUCTION_DEPLOYMENT_MODE || "manifest").trim();
const errors = [];
const warnings = [];
const truthy = value => ["true", "1", "yes"].includes(String(value).toLowerCase());

if (!["manifest", "compose"].includes(deploymentMode)) {
  errors.push("PRODUCTION_DEPLOYMENT_MODE must be manifest or compose");
}
if (truthy(process.env.CMS_AUTOMATION_ENABLED)) {
  errors.push("CMS_AUTOMATION_ENABLED must remain false for human portal handoff");
}
for (const name of [
  "TEST_INFRA_FALLBACK_MOCKS",
  "ALLOW_MOCK_FIXTURES",
  "EMR_SIMULATION_MODE",
  "TEMPORAL_CONTROLLED_DRILL",
  "AUTHZ_ALLOW_POSTGRES_FALLBACK",
]) {
  if (truthy(process.env[name])) errors.push(`${name} cannot be enabled in production Compose configuration`);
}

let composePath;
let composeMode = "not_applicable";
if (requested) {
  composePath = isAbsolute(requested) ? requested : resolve(root, requested);
  if (basename(composePath) === "docker-compose.integration.yml") {
    errors.push("docker-compose.integration.yml is a disposable local test stack and cannot be used for production");
  }
  if (!existsSync(composePath) || !statSync(composePath).isFile()) {
    errors.push(`PRODUCTION_COMPOSE_FILE does not reference a regular file: ${composePath}`);
  } else {
    composeMode = "validated";
    const source = readFileSync(composePath, "utf8");
    const prohibited = [
      [/(?:healthpoint-)?integration|test[-_ ]only|local-integration/i, "integration/test-only configuration marker"],
      [/(?:POSTGRES_PASSWORD|REDIS_PASSWORD|PASSWORD|TOKEN|SECRET)\s*[:=]\s*["']?[^\s$"'][^\n#]*/i, "embedded secret-like Compose value"],
      [/\b(?:PLAINTEXT|sslmode=disable|redis:\/\/)/i, "plaintext service transport"],
      [/privileged:\s*true|host(?:Network|PID|IPC):\s*true|\bhostPath\s*:/i, "unsafe container privilege or host namespace"],
      [/CMS_(?:IDR_)?API_(?:BASE|KEY)|CMS_API_TOKEN|\/v1\/idr\/submissions/i, "automated CMS API configuration"],
    ];
    for (const [pattern, label] of prohibited) {
      if (pattern.test(source)) errors.push(`Production Compose file contains ${label}`);
    }
    if (!/image:\s*[^\s@]+@sha256:[a-f0-9]{64}/i.test(source)) {
      errors.push("Production Compose file must use immutable sha256-pinned images");
    }
  }
} else if (deploymentMode === "compose") {
  errors.push("PRODUCTION_COMPOSE_FILE is required when PRODUCTION_DEPLOYMENT_MODE=compose");
} else {
  warnings.push("No production Compose file configured; manifest-based deployment validation is enforced separately");
}

const report = {
  valid: errors.length === 0,
  generatedAt: new Date().toISOString(),
  deploymentMode,
  composeMode,
  composePath,
  errors,
  warnings,
};
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.valid) process.exitCode = 2;
