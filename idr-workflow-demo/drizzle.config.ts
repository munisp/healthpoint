import { defineConfig } from "drizzle-kit";

const LOCAL_PG_URL = "postgresql://idr_user:idr_pass123@localhost:5432/idr_demo";

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: LOCAL_PG_URL,
  },
});
