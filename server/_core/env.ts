import { z } from "zod";

// ── Environment schema — validates at startup, fails fast on missing critical vars ──
const envSchema = z.object({
  // Core
  VITE_APP_ID: z.string().optional().default(""),
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  OWNER_OPEN_ID: z.string().optional().default(""),
  OAUTH_SERVER_URL: z.string().optional().default(""),
  // Built-in LLM / storage
  BUILT_IN_OPENAI_API_URL: z.string().optional().default(""),
  BUILT_IN_OPENAI_API_KEY: z.string().optional().default(""),
  BUILT_IN_FORGE_API_URL: z.string().optional().default(""),
  BUILT_IN_FORGE_API_KEY: z.string().optional().default(""),
  BUILT_IN_STORAGE_API_URL: z.string().optional().default(""),
  BUILT_IN_STORAGE_API_KEY: z.string().optional().default(""),
  // Keycloak OIDC
  KEYCLOAK_URL: z.string().optional().default("https://auth.placeholder.example.com"),
  KEYCLOAK_REALM: z.string().optional().default("healthpoint"),
  KEYCLOAK_CLIENT_ID: z.string().optional().default("healthpoint-app"),
  KEYCLOAK_CLIENT_SECRET: z.string().optional().default("placeholder-secret"),
  // App URL & email
  VITE_APP_URL: z.string().optional().default("https://healthpoint.manus.space"),
  RESEND_API_KEY: z.string().optional().default(""),
  LEAD_NOTIFICATION_EMAIL: z.string().optional().default("team@healthpoint.io"),
  LEAD_FROM_EMAIL: z.string().optional().default("HealthPoint <onboarding@resend.dev>"),
});

const _parsed = envSchema.safeParse(process.env);
if (!_parsed.success) {
  console.error("[ENV] Invalid environment configuration:");
  _parsed.error.issues.forEach(issue =>
    console.error(`  ${issue.path.join(".")}: ${issue.message}`)
  );
  // In production, exit immediately; in dev, warn and continue
  if (process.env.NODE_ENV === "production") process.exit(1);
}
const _env = _parsed.success ? _parsed.data : (process.env as any);

export const ENV = {
  appId: _env.VITE_APP_ID ?? "",
  cookieSecret: _env.JWT_SECRET ?? "",
  databaseUrl: _env.DATABASE_URL ?? "",
  oAuthServerUrl: _env.OAUTH_SERVER_URL ?? "",
  ownerId: _env.OWNER_OPEN_ID ?? "",
  isProduction: _env.NODE_ENV === "production",
  openAiApiUrl: _env.BUILT_IN_OPENAI_API_URL ?? _env.BUILT_IN_FORGE_API_URL ?? "",
  openAiApiKey: _env.BUILT_IN_OPENAI_API_KEY ?? _env.BUILT_IN_FORGE_API_KEY ?? "",
  storageApiUrl: _env.BUILT_IN_STORAGE_API_URL ?? "",
  storageApiKey: _env.BUILT_IN_STORAGE_API_KEY ?? "",
  // Keycloak OIDC
  keycloakUrl: _env.KEYCLOAK_URL ?? "https://auth.placeholder.example.com",
  keycloakRealm: _env.KEYCLOAK_REALM ?? "healthpoint",
  keycloakClientId: _env.KEYCLOAK_CLIENT_ID ?? "healthpoint-app",
  keycloakClientSecret: _env.KEYCLOAK_CLIENT_SECRET ?? "placeholder-secret",
  // App URL & email
  appUrl: _env.VITE_APP_URL ?? "https://healthpoint.manus.space",
  resendApiKey: _env.RESEND_API_KEY ?? "",
  leadNotificationEmail: _env.LEAD_NOTIFICATION_EMAIL ?? "team@healthpoint.io",
  leadFromEmail: _env.LEAD_FROM_EMAIL ?? "HealthPoint <onboarding@resend.dev>",
};
