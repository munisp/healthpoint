import { z } from "zod";

// ── Environment schema — validates at startup, fails fast on missing critical vars ──
const envSchema = z.object({
  // Core
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  EXTERNAL_POSTGRES_URL: z.string().optional().default(""),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  // LLM backends — priority: Ollama > LLM_API > OpenAI
  // Set OLLAMA_BASE_URL to use local Ollama (Gemma3, Qwen2.5, Llama3, etc.)
  OLLAMA_BASE_URL: z.string().optional().default("http://localhost:11434"),
  OLLAMA_DEFAULT_MODEL: z.string().optional().default("gemma3:8b"),
  // Generic OpenAI-compatible endpoint (vLLM, LM Studio, Together AI, Groq, etc.)
  LLM_API_URL: z.string().optional().default(""),
  LLM_API_KEY: z.string().optional().default(""),
  LLM_DEFAULT_MODEL: z.string().optional().default("gpt-4o-mini"),
  // OpenAI directly
  OPENAI_API_KEY: z.string().optional().default(""),

  // Storage — MinIO S3-compatible (self-hosted) or any S3-compatible provider
  S3_ENDPOINT: z.string().optional().default(""),
  S3_ACCESS_KEY: z.string().optional().default(""),
  S3_SECRET_KEY: z.string().optional().default(""),
  S3_BUCKET: z.string().optional().default("healthpoint"),
  S3_REGION: z.string().optional().default("us-east-1"),
  EMR_CREDENTIALS_ENCRYPTION_KEY: z.string().optional().default(""),

  // Keycloak OIDC using Authorization Code Flow with PKCE
  KEYCLOAK_URL: z.string().optional().default("http://localhost:8080"),
  KEYCLOAK_REALM: z.string().optional().default("healthpoint"),
  KEYCLOAK_CLIENT_ID: z.string().optional().default("healthpoint-app"),
  KEYCLOAK_CLIENT_SECRET: z.string().optional().default(""),

  // Analytics — Umami (self-hosted, open-source)
  UMAMI_WEBSITE_ID: z.string().optional().default(""),
  UMAMI_URL: z.string().optional().default(""),

  // Observability — OTLP/HTTP only. Production validation occurs in telemetry.ts.
  OTEL_ENABLED: z.enum(["true", "false"]).optional().default("false"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional().default(""),
  OTEL_EXPORTER_OTLP_HEADERS: z.string().optional().default(""),
  OTEL_SERVICE_NAME: z.string().optional().default("healthpoint-api"),
  OTEL_SERVICE_VERSION: z.string().optional().default(""),
  OTEL_DEPLOYMENT_ENVIRONMENT: z.string().optional().default(""),
  OTEL_TENANT_HMAC_KEY: z.string().optional().default(""),
  OTEL_METRIC_EXPORT_INTERVAL_MS: z.string().optional().default("30000"),
  ALERTMANAGER_WEBHOOK_TOKEN: z.string().optional().default(""),

  // CORS — comma-separated list of allowed origins
  ALLOWED_ORIGINS: z.string().optional().default(""),

  // App URL & email
  VITE_APP_URL: z.string().optional().default("http://localhost:3000"),
  RESEND_API_KEY: z.string().optional().default(""),
  LEAD_NOTIFICATION_EMAIL: z.string().optional().default("team@healthpoint.io"),
  LEAD_FROM_EMAIL: z
    .string()
    .optional()
    .default("HealthPoint <noreply@healthpoint.io>"),

  // TigerBeetle: the Node client may communicate only through a local mTLS tunnel.
  TIGERBEETLE_ENABLED: z.enum(["true", "false"]).optional().default("false"),
  TIGERBEETLE_ADDRESS: z.string().optional(),
  TIGERBEETLE_CLUSTER_ID: z.string().optional(),
  TIGERBEETLE_TLS_REMOTE_ADDRESS: z.string().optional(),
  TIGERBEETLE_TLS_SERVER_NAME: z.string().optional(),
  TIGERBEETLE_CA_PATH: z.string().optional(),
  TIGERBEETLE_CLIENT_CERT_PATH: z.string().optional(),
  TIGERBEETLE_CLIENT_KEY_PATH: z.string().optional(),
  TIGERBEETLE_CLIENT_KEY_PEM: z.string().optional(),

  // Temporal workflow client. Dispatch remains independently opt-in and
  // production validation is enforced by server/temporal.ts.
  TEMPORAL_ADDRESS: z.string().optional().default(""),
  TEMPORAL_AUTH_TOKEN: z.string().optional().default(""),
  TEMPORAL_TLS_SERVER_NAME: z.string().optional().default(""),
  TEMPORAL_NAMESPACE: z.string().optional().default(""),
  TEMPORAL_TASK_QUEUE: z.string().optional().default(""),
  TEMPORAL_WORKFLOW_TYPE: z.string().optional().default(""),
  TEMPORAL_CA_PATH: z.string().optional().default(""),
  TEMPORAL_EXECUTION_ENABLED: z
    .enum(["true", "false"])
    .optional()
    .default("false"),
});

const _parsed = envSchema.safeParse(process.env);
if (!_parsed.success) {
  console.error("[ENV] Invalid environment configuration:");
  _parsed.error.issues.forEach(issue =>
    console.error(`  ${issue.path.join(".")}: ${issue.message}`)
  );
  if (process.env.NODE_ENV === "production") process.exit(1);
}
const _env = _parsed.success ? _parsed.data : (process.env as any);

if (
  process.env.NODE_ENV === "production" &&
  !/^[a-fA-F0-9]{64}$/.test(_env.EMR_CREDENTIALS_ENCRYPTION_KEY ?? "")
) {
  console.error(
    "[ENV] EMR_CREDENTIALS_ENCRYPTION_KEY must be a 64-character hexadecimal AES-256 key in production"
  );
  process.exit(1);
}

export const ENV = {
  cookieSecret: _env.JWT_SECRET ?? "",
  databaseUrl: _env.EXTERNAL_POSTGRES_URL || _env.DATABASE_URL || "",
  isProduction: _env.NODE_ENV === "production",

  // LLM — open-source Ollama first, then a generic OpenAI-compatible endpoint, then OpenAI.
  ollamaBaseUrl: _env.OLLAMA_BASE_URL || "http://localhost:11434",
  ollamaDefaultModel: _env.OLLAMA_DEFAULT_MODEL || "gemma3:8b",
  llmApiUrl: _env.LLM_API_URL || "",
  llmApiKey: _env.LLM_API_KEY || "",
  llmDefaultModel: _env.LLM_DEFAULT_MODEL || "gpt-4o-mini",
  openAiApiKey: _env.OPENAI_API_KEY || "",

  // Storage — MinIO S3
  s3Endpoint: _env.S3_ENDPOINT || "",
  s3AccessKey: _env.S3_ACCESS_KEY || "",
  s3SecretKey: _env.S3_SECRET_KEY || "",
  s3Bucket: _env.S3_BUCKET || "healthpoint",
  s3Region: _env.S3_REGION || "us-east-1",
  emrCredentialsEncryptionKey: _env.EMR_CREDENTIALS_ENCRYPTION_KEY || "",

  // Keycloak OIDC
  keycloakUrl: _env.KEYCLOAK_URL || "http://localhost:8080",
  keycloakRealm: _env.KEYCLOAK_REALM || "healthpoint",
  keycloakClientId: _env.KEYCLOAK_CLIENT_ID || "healthpoint-app",
  keycloakClientSecret: _env.KEYCLOAK_CLIENT_SECRET || "",

  // Analytics — Umami
  umamiWebsiteId: _env.UMAMI_WEBSITE_ID || "",
  umamiUrl: _env.UMAMI_URL || "",

  // OpenTelemetry
  otelEnabled: _env.OTEL_ENABLED === "true",
  otelEndpoint: _env.OTEL_EXPORTER_OTLP_ENDPOINT || "",
  otelServiceName: _env.OTEL_SERVICE_NAME || "healthpoint-api",
  otelTenantHmacKey: _env.OTEL_TENANT_HMAC_KEY || "",
  alertmanagerWebhookToken: _env.ALERTMANAGER_WEBHOOK_TOKEN || "",

  // CORS
  allowedOrigins: (_env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean),

  // App URL & email
  appUrl: _env.VITE_APP_URL || "http://localhost:3000",
  resendApiKey: _env.RESEND_API_KEY || "",
  leadNotificationEmail: _env.LEAD_NOTIFICATION_EMAIL || "team@healthpoint.io",
  leadFromEmail: _env.LEAD_FROM_EMAIL || "HealthPoint <noreply@healthpoint.io>",

  // TigerBeetle mutual-TLS transport (the private key is deliberately not exposed here).
  tigerBeetleEnabled: _env.TIGERBEETLE_ENABLED === "true",
  tigerBeetleAddress: _env.TIGERBEETLE_ADDRESS,
};

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Runtime counterpart to the deploy pre-flight check. This protects against a
 * direct process start that bypasses CI/CD and rejects unsafe production setup.
 */
export function assertProductionRuntimeConfig(): void {
  if (!ENV.isProduction) return;
  const errors: string[] = [];
  const required = [
    "REDIS_URL",
    "PERMIFY_URL",
    "PERMIFY_AUTH_TOKEN",
    "KAFKA_BROKERS",
    "KAFKA_SECURITY_PROTOCOL",
    "KAFKA_SSL_CA_PATH",
    "KEYCLOAK_URL",
    "KEYCLOAK_REALM",
    "KEYCLOAK_CLIENT_ID",
    "KEYCLOAK_CLIENT_SECRET",
    "S3_ENDPOINT",
    "S3_ACCESS_KEY",
    "S3_SECRET_KEY",
    "S3_BUCKET",
    "VITE_APP_URL",
    "ALLOWED_ORIGINS",
    "SCHEDULED_SECRET",
  ];
  for (const name of required)
    if (!process.env[name]?.trim()) errors.push(`${name} is required`);
  if (!/^rediss:\/\//.test(process.env.REDIS_URL ?? ""))
    errors.push("REDIS_URL must use rediss://");
  for (const name of [
    "PERMIFY_URL",
    "KEYCLOAK_URL",
    "S3_ENDPOINT",
    "VITE_APP_URL",
  ]) {
    if (!isHttpsUrl(process.env[name] ?? ""))
      errors.push(`${name} must use https://`);
  }
  if (
    !["SASL_SSL", "SSL"].includes(process.env.KAFKA_SECURITY_PROTOCOL ?? "")
  ) {
    errors.push("KAFKA_SECURITY_PROTOCOL must be SASL_SSL or SSL");
  }
  if ((process.env.JWT_SECRET ?? "").length < 32)
    errors.push("JWT_SECRET must contain at least 32 characters");
  if (
    (process.env.SCHEDULED_SECRET ?? "").length < 32 ||
    process.env.SCHEDULED_SECRET === "dev-scheduled-secret"
  ) {
    errors.push(
      "SCHEDULED_SECRET must be a non-default value containing at least 32 characters"
    );
  }
  for (const name of [
    "ALLOW_MOCK_FIXTURES",
    "TEST_INFRA_FALLBACK_MOCKS",
    "EMR_SIMULATION_MODE",
    "TEMPORAL_CONTROLLED_DRILL",
    "AUTHZ_ALLOW_POSTGRES_FALLBACK",
  ]) {
    if (process.env[name] === "true")
      errors.push(`${name} must not be enabled in production`);
  }
  if (process.env.DAPR_ENABLED === "true") {
    for (const name of ["DAPR_APP_API_TOKEN", "DAPR_PUBSUB_NAME"]) {
      if (!process.env[name]?.trim()) errors.push(`${name} is required when Dapr is enabled`);
    }
    if (!/^[a-z][a-z0-9-]{0,127}$/.test(process.env.DAPR_PUBSUB_NAME ?? "")) {
      errors.push("DAPR_PUBSUB_NAME must be a valid scoped Dapr component name");
    }
    if ((process.env.DAPR_APP_API_TOKEN ?? "").length < 32) {
      errors.push("DAPR_APP_API_TOKEN must contain at least 32 characters");
    }
  }
  const finalityRequired = process.env.TIGERBEETLE_FINALITY_REQUIRED === "true";
  const finalityWorkerEnabled = process.env.TIGERBEETLE_FINALITY_WORKER_ENABLED === "true";
  const finalityExecutionEnabled = process.env.TIGERBEETLE_FINALITY_EXECUTION === "true";
  if (finalityRequired || finalityWorkerEnabled || finalityExecutionEnabled) {
    if (!(finalityRequired && finalityWorkerEnabled && finalityExecutionEnabled)) {
      errors.push("TigerBeetle finality requires TIGERBEETLE_FINALITY_REQUIRED, TIGERBEETLE_FINALITY_WORKER_ENABLED, and TIGERBEETLE_FINALITY_EXECUTION to all equal true");
    }
    if (process.env.TIGERBEETLE_ENABLED !== "true") errors.push("TIGERBEETLE_ENABLED must equal true when finality is enabled");
    if (process.env.PAYMENT_EXECUTION_MODE !== "enabled") errors.push("PAYMENT_EXECUTION_MODE must equal enabled when TigerBeetle finality is enabled");
    for (const name of [
      "TIGERBEETLE_ADDRESS", "TIGERBEETLE_CLUSTER_ID", "TIGERBEETLE_TLS_REMOTE_ADDRESS",
      "TIGERBEETLE_TLS_SERVER_NAME", "TIGERBEETLE_CA_PATH", "TIGERBEETLE_CLIENT_CERT_PATH",
      "TIGERBEETLE_FINALITY_MAX_ATTEMPTS", "TIGERBEETLE_FINALITY_LEASE_SECONDS", "TIGERBEETLE_FINALITY_WORKER_INTERVAL_MS",
    ]) if (!process.env[name]?.trim()) errors.push(`${name} is required when TigerBeetle finality is enabled`);
    if (!process.env.TIGERBEETLE_CLIENT_KEY_PATH?.trim() && !process.env.TIGERBEETLE_CLIENT_KEY_PEM?.trim()) {
      errors.push("TigerBeetle finality requires exactly one externally managed client-key source");
    }
    if (process.env.TIGERBEETLE_CLIENT_KEY_PATH?.trim() && process.env.TIGERBEETLE_CLIENT_KEY_PEM?.trim()) {
      errors.push("TigerBeetle finality permits only one client-key source");
    }
  }
  if (process.env.TEMPORAL_EXECUTION_ENABLED === "true") {
    for (const name of [
      "TEMPORAL_ADDRESS",
      "TEMPORAL_AUTH_TOKEN",
      "TEMPORAL_TLS_SERVER_NAME",
      "TEMPORAL_NAMESPACE",
      "TEMPORAL_TASK_QUEUE",
      "TEMPORAL_WORKFLOW_TYPE",
      "TEMPORAL_CA_PATH",
    ]) {
      if (!process.env[name]?.trim())
        errors.push(`${name} is required when Temporal execution is enabled`);
    }
  }
  if (errors.length)
    throw new Error(`Unsafe production configuration: ${errors.join("; ")}`);
}
