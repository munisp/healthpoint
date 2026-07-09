import { z } from "zod";

// ── Environment schema — validates at startup, fails fast on missing critical vars ──
const envSchema = z.object({
  // Core
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

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
  // Legacy Manus vars — kept for backward compat, mapped to LLM fields
  BUILT_IN_OPENAI_API_URL: z.string().optional().default(""),
  BUILT_IN_OPENAI_API_KEY: z.string().optional().default(""),
  BUILT_IN_FORGE_API_URL: z.string().optional().default(""),
  BUILT_IN_FORGE_API_KEY: z.string().optional().default(""),

  // Storage — MinIO S3-compatible (self-hosted) or any S3-compatible provider
  S3_ENDPOINT: z.string().optional().default(""),
  S3_ACCESS_KEY: z.string().optional().default(""),
  S3_SECRET_KEY: z.string().optional().default(""),
  S3_BUCKET: z.string().optional().default("healthpoint"),
  S3_REGION: z.string().optional().default("us-east-1"),
  // Legacy Manus storage vars
  BUILT_IN_STORAGE_API_URL: z.string().optional().default(""),
  BUILT_IN_STORAGE_API_KEY: z.string().optional().default(""),

  // Keycloak OIDC (replaces Manus OAuth)
  KEYCLOAK_URL: z.string().optional().default("http://localhost:8080"),
  KEYCLOAK_REALM: z.string().optional().default("healthpoint"),
  KEYCLOAK_CLIENT_ID: z.string().optional().default("healthpoint-app"),
  KEYCLOAK_CLIENT_SECRET: z.string().optional().default(""),

  // Analytics — Umami (self-hosted, open-source)
  UMAMI_WEBSITE_ID: z.string().optional().default(""),
  UMAMI_URL: z.string().optional().default(""),

  // CORS — comma-separated list of allowed origins
  ALLOWED_ORIGINS: z.string().optional().default(""),

  // App URL & email
  VITE_APP_URL: z.string().optional().default("http://localhost:3000"),
  RESEND_API_KEY: z.string().optional().default(""),
  LEAD_NOTIFICATION_EMAIL: z.string().optional().default("team@healthpoint.io"),
  LEAD_FROM_EMAIL: z.string().optional().default("HealthPoint <noreply@healthpoint.io>"),

  // Legacy Manus-specific vars — accepted but not used
  VITE_APP_ID: z.string().optional().default(""),
  OWNER_OPEN_ID: z.string().optional().default(""),
  OAUTH_SERVER_URL: z.string().optional().default(""),
  VITE_ANALYTICS_ENDPOINT: z.string().optional().default(""),
  VITE_ANALYTICS_WEBSITE_ID: z.string().optional().default(""),
  VITE_FRONTEND_FORGE_API_KEY: z.string().optional().default(""),
  VITE_FRONTEND_FORGE_API_URL: z.string().optional().default(""),
  VITE_OAUTH_PORTAL_URL: z.string().optional().default(""),
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

export const ENV = {
  cookieSecret: _env.JWT_SECRET ?? "",
  databaseUrl: _env.DATABASE_URL ?? "",
  isProduction: _env.NODE_ENV === "production",

  // LLM — Ollama first, then generic, then OpenAI, then legacy Manus vars
  ollamaBaseUrl: _env.OLLAMA_BASE_URL || "http://localhost:11434",
  ollamaDefaultModel: _env.OLLAMA_DEFAULT_MODEL || "gemma3:8b",
  llmApiUrl: _env.LLM_API_URL || _env.BUILT_IN_OPENAI_API_URL || _env.BUILT_IN_FORGE_API_URL || "",
  llmApiKey: _env.LLM_API_KEY || _env.BUILT_IN_OPENAI_API_KEY || _env.BUILT_IN_FORGE_API_KEY || "",
  llmDefaultModel: _env.LLM_DEFAULT_MODEL || "gpt-4o-mini",
  openAiApiKey: _env.OPENAI_API_KEY || _env.BUILT_IN_OPENAI_API_KEY || _env.BUILT_IN_FORGE_API_KEY || "",
  // Legacy alias — kept so old callers compile
  openAiApiUrl: _env.LLM_API_URL || _env.BUILT_IN_OPENAI_API_URL || _env.BUILT_IN_FORGE_API_URL || "",

  // Storage — MinIO S3
  s3Endpoint: _env.S3_ENDPOINT || "",
  s3AccessKey: _env.S3_ACCESS_KEY || "",
  s3SecretKey: _env.S3_SECRET_KEY || "",
  s3Bucket: _env.S3_BUCKET || "healthpoint",
  s3Region: _env.S3_REGION || "us-east-1",
  storageApiUrl: _env.BUILT_IN_STORAGE_API_URL || "",
  storageApiKey: _env.BUILT_IN_STORAGE_API_KEY || "",

  // Keycloak OIDC
  keycloakUrl: _env.KEYCLOAK_URL || "http://localhost:8080",
  keycloakRealm: _env.KEYCLOAK_REALM || "healthpoint",
  keycloakClientId: _env.KEYCLOAK_CLIENT_ID || "healthpoint-app",
  keycloakClientSecret: _env.KEYCLOAK_CLIENT_SECRET || "",

  // Analytics — Umami
  umamiWebsiteId: _env.UMAMI_WEBSITE_ID || _env.VITE_ANALYTICS_WEBSITE_ID || "",
  umamiUrl: _env.UMAMI_URL || _env.VITE_ANALYTICS_ENDPOINT || "",

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

  // Legacy Manus compat (some code may still reference these)
  appId: _env.VITE_APP_ID || "",
  ownerId: _env.OWNER_OPEN_ID || "",
  oAuthServerUrl: _env.OAUTH_SERVER_URL || "",
};
