import { defineConfig } from "drizzle-kit";

const rawUrl = process.env.DATABASE_URL ?? "";
const isPostgres = rawUrl.startsWith("postgresql://") || rawUrl.startsWith("postgres://");
if (!isPostgres) {
  throw new Error("DATABASE_URL must be an explicit PostgreSQL URI before running Drizzle migrations");
}

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: rawUrl,
  },
});
