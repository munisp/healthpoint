import { defineConfig } from "drizzle-kit";

// Use DATABASE_URL when it is a PostgreSQL URL; fall back to local dev PG.
// The platform injects DATABASE_URL at runtime; for local dev a PostgreSQL
// instance is expected at localhost:5432 (see README for setup instructions).
const rawUrl = process.env.DATABASE_URL ?? "";
const isPostgres = rawUrl.startsWith("postgresql://") || rawUrl.startsWith("postgres://");
const dbUrl = isPostgres ? rawUrl : "postgresql://idr_user:idr_pass123@localhost:5432/idr_demo";

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: dbUrl,
  },
});
