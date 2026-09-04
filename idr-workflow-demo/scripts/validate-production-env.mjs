#!/usr/bin/env node
import { URL } from "node:url";

const errors = [];
const warnings = [];
const env = process.env;
const forbiddenTrue = [
  "ALLOW_MOCK_FIXTURES",
  "TEST_INFRA_FALLBACK_MOCKS",
  "EMR_SIMULATION_MODE",
  "TEMPORAL_CONTROLLED_DRILL",
  "AUTHZ_ALLOW_POSTGRES_FALLBACK",
];
const production = env.NODE_ENV === "production";
const testMode = env.NODE_ENV === "test";

if (!production && !testMode)
  errors.push(
    `NODE_ENV must be production; received ${env.NODE_ENV || "unset"}`
  );
for (const name of forbiddenTrue) {
  if (
    env.NODE_ENV !== "test" &&
    (env[name]?.toLowerCase() === "true" || env[name] === "1")
  ) {
    errors.push(`${name} must not be enabled outside test mode`);
  }
}
if (env.RELEASE_MODE === "mock" || env.RELEASE_MODE === "test") {
  errors.push(
    `RELEASE_MODE=${env.RELEASE_MODE} is not permitted for production`
  );
}
if (
  env.PAYMENT_EXECUTION_MODE === "simulation" ||
  env.PAYMENT_EXECUTION_MODE === "mock"
) {
  errors.push(
    `PAYMENT_EXECUTION_MODE=${env.PAYMENT_EXECUTION_MODE} is not permitted for production`
  );
}

if (testMode) {
  const result = {
    valid: errors.length === 0,
    generatedAt: new Date().toISOString(),
    mode: "test",
    errors,
    warnings: [],
  };
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.valid ? 0 : 2;
  process.exit();
}

const required = [
  "JWT_SECRET",
  "DATABASE_URL",
  "PERMIFY_URL",
  "PERMIFY_AUTH_TOKEN",
  "REDIS_URL",
  "KAFKA_BROKERS",
  "KAFKA_SECURITY_PROTOCOL",
  "PAYMENT_EXECUTION_MODE",
  "EMR_CREDENTIALS_ENCRYPTION_KEY",
  "KEYCLOAK_URL",
  "KEYCLOAK_REALM",
  "KEYCLOAK_CLIENT_ID",
  "KEYCLOAK_CLIENT_SECRET",
  "HEALTHPOINT_PUBLIC_URL",
  "VITE_APP_URL",
  "ALLOWED_ORIGINS",
  "TEMPORAL_EXECUTION_ENABLED",
  "SCHEDULED_SECRET",
  "OTEL_ENABLED",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_SERVICE_NAME",
  "OTEL_TENANT_HMAC_KEY",
  "ALERTMANAGER_WEBHOOK_TOKEN",
];
for (const name of required) if (!env[name]) errors.push(`${name} is required`);

function isHttps(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function requireUrl(name, protocols) {
  if (!env[name]) return;
  try {
    const parsed = new URL(env[name]);
    if (!protocols.includes(parsed.protocol))
      errors.push(`${name} must use ${protocols.join(" or ")}`);
    if (["localhost", "127.0.0.1", "0.0.0.0"].includes(parsed.hostname))
      warnings.push(`${name} points to a loopback address`);
  } catch {
    errors.push(`${name} is not a valid URL`);
  }
}
requireUrl("DATABASE_URL", ["postgresql:", "postgres:"]);
requireUrl("REDIS_URL", ["rediss:"]);
requireUrl("PERMIFY_URL", ["https:"]);
requireUrl("KEYCLOAK_URL", ["https:"]);
requireUrl("HEALTHPOINT_PUBLIC_URL", ["https:"]);
requireUrl("VITE_APP_URL", ["https:"]);
requireUrl("OTEL_EXPORTER_OTLP_ENDPOINT", ["https:"]);
for (const origin of (env.ALLOWED_ORIGINS || "").split(",").filter(Boolean)) {
  try {
    const parsed = new URL(origin.trim());
    if (parsed.protocol !== "https:")
      errors.push("ALLOWED_ORIGINS entries must use https:");
    if (parsed.hostname === "*")
      errors.push("ALLOWED_ORIGINS must not contain a wildcard origin");
  } catch {
    errors.push("ALLOWED_ORIGINS contains an invalid URL");
  }
}

if (
  env.KAFKA_SECURITY_PROTOCOL &&
  !["SASL_SSL", "SSL"].includes(env.KAFKA_SECURITY_PROTOCOL)
) {
  errors.push("KAFKA_SECURITY_PROTOCOL must be SASL_SSL or SSL in production");
}
if (!env.KAFKA_SSL_CA_PATH)
  errors.push("KAFKA_SSL_CA_PATH is required for TLS Kafka");
if (
  env.KAFKA_SSL_CA_PATH &&
  /(^|\/)example|placeholder|test|local/i.test(env.KAFKA_SSL_CA_PATH)
) {
  errors.push("KAFKA_SSL_CA_PATH points to a test/example certificate");
}
if (env.JWT_SECRET && env.JWT_SECRET.length < 32)
  errors.push("JWT_SECRET must contain at least 32 characters");
if (env.KEYCLOAK_CLIENT_SECRET && env.KEYCLOAK_CLIENT_SECRET.length < 32)
  errors.push("KEYCLOAK_CLIENT_SECRET must contain at least 32 characters");
if (env.KEYCLOAK_CLIENT_SECRET && /(?:placeholder|change.?me|development|example|test|local)/i.test(env.KEYCLOAK_CLIENT_SECRET))
  errors.push("KEYCLOAK_CLIENT_SECRET must not be a development or placeholder value");
if (env.OTEL_ENABLED !== "true")
  errors.push("OTEL_ENABLED must be true in production");
if (!isHttps(env.OTEL_EXPORTER_OTLP_ENDPOINT))
  errors.push("OTEL_EXPORTER_OTLP_ENDPOINT must use https:// in production");
for (const name of ["OTEL_CLIENT_CERT_PATH", "OTEL_CLIENT_KEY_PATH", "OTEL_CA_PATH"]) {
  if (!env[name]) errors.push(`${name} is required for OTLP mutual TLS`);
  else if (/(^|\/)(?:example|placeholder|test|local)/i.test(env[name])) errors.push(`${name} points to a test/example certificate`);
}
if ((env.OTEL_TENANT_HMAC_KEY?.length ?? 0) < 32)
  errors.push("OTEL_TENANT_HMAC_KEY must contain at least 32 characters");
if ((env.ALERTMANAGER_WEBHOOK_TOKEN?.length ?? 0) < 32)
  errors.push("ALERTMANAGER_WEBHOOK_TOKEN must contain at least 32 characters");
if (/authorization\s*=\s*(?:basic|bearer)\s+[^$]/i.test(env.OTEL_EXPORTER_OTLP_HEADERS ?? ""))
  errors.push("OTEL_EXPORTER_OTLP_HEADERS must not embed literal credentials");
if (
  env.SCHEDULED_SECRET === "dev-scheduled-secret" ||
  (env.SCHEDULED_SECRET && env.SCHEDULED_SECRET.length < 32)
)
  errors.push(
    "SCHEDULED_SECRET must be a non-default value containing at least 32 characters"
  );
if (!/^[a-fA-F0-9]{64}$/.test(env.EMR_CREDENTIALS_ENCRYPTION_KEY || ""))
  errors.push(
    "EMR_CREDENTIALS_ENCRYPTION_KEY must be a 64-character hexadecimal AES-256 key"
  );
if (
  env.PERMIFY_AUTH_TOKEN &&
  /test|local|mock|changeme/i.test(env.PERMIFY_AUTH_TOKEN)
)
  errors.push("PERMIFY_AUTH_TOKEN appears to be a test token");
const approvalEnabled = ["true", "1", "yes"].includes(
  (env.EXTERNAL_INTEGRATION_RELEASE_APPROVED || "").toLowerCase()
);
if (["true", "1", "yes"].includes((env.CMS_AUTOMATION_ENABLED || "").toLowerCase())) {
  errors.push(
    "CMS_AUTOMATION_ENABLED must remain false: only authenticated human portal handoff is supported"
  );
}
for (const name of [
  "GOVERNED_OUTCOME_PREDICTIONS_ENABLED",
  "DOCUMENT_ANALYSIS_REQUIRED",
  "TEMPORAL_EXECUTION_ENABLED",
]) {
  const enabled = ["true", "1", "yes"].includes(
    (env[name] || "").toLowerCase()
  );
  if (enabled && !approvalEnabled) {
    errors.push(
      `${name} requires EXTERNAL_INTEGRATION_RELEASE_APPROVED=true from the protected release process`
    );
  }
}
if (env.GOVERNED_OUTCOME_PREDICTIONS_ENABLED === "true") {
  if (env.GOVERNED_OUTCOME_RUNTIME !== "georgetown")
    errors.push(
      "GOVERNED_OUTCOME_RUNTIME must be georgetown when live outcome predictions are enabled"
    );
  for (const name of [
    "GEORGETOWN_MODEL_ID",
    "GEORGETOWN_MODEL_VERSION",
    "GEORGETOWN_MODEL_URL",
    "GEORGETOWN_MODEL_TOKEN",
  ]) {
    if (!env[name])
      errors.push(
        `${name} is required when live outcome predictions are enabled`
      );
  }
  requireUrl("GEORGETOWN_MODEL_URL", ["https:"]);
}
if (env.PAYMENT_EXECUTION_MODE === "disabled")
  warnings.push(
    "PAYMENT_EXECUTION_MODE=disabled: payment release evidence is not satisfied"
  );
if (!["true", "false"].includes(env.TEMPORAL_EXECUTION_ENABLED || ""))
  errors.push("TEMPORAL_EXECUTION_ENABLED must be true or false");
if (env.TEMPORAL_EXECUTION_ENABLED === "true") {
  for (const name of [
    "TEMPORAL_ADDRESS",
    "TEMPORAL_AUTH_TOKEN",
    "TEMPORAL_TLS_SERVER_NAME",
    "TEMPORAL_NAMESPACE",
    "TEMPORAL_TASK_QUEUE",
    "TEMPORAL_WORKFLOW_TYPE",
    "TEMPORAL_CA_PATH",
  ]) {
    if (!env[name])
      errors.push(`${name} is required when Temporal execution is enabled`);
  }
  if (
    env.TEMPORAL_CA_PATH &&
    /(^|\/)example|placeholder|test|local/i.test(env.TEMPORAL_CA_PATH)
  )
    errors.push("TEMPORAL_CA_PATH points to a test/example certificate");
} else if (env.TEMPORAL_EXECUTION_ENABLED === "false") {
  warnings.push(
    "TEMPORAL_EXECUTION_ENABLED=false: live workflow dispatch is disabled"
  );
}

const result = {
  valid: errors.length === 0,
  generatedAt: new Date().toISOString(),
  errors,
  warnings,
};
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.valid ? 0 : 2;
