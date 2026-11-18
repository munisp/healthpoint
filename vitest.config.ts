import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: path.resolve(import.meta.dirname),
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  test: {
    environment: "node",
    // server/_core/index.ts loads dotenv/config as its first line, but test
    // files import server modules (e.g. server/db.ts) directly without going
    // through that entrypoint, so process.env.DATABASE_URL etc. were never
    // populated here - tests failed with "not configured" even with a valid
    // local .env present.
    setupFiles: ["dotenv/config"],
    include: ["server/**/*.test.ts", "server/**/*.spec.ts", "client/**/*.test.ts", "client/**/*.test.tsx"],
  },
});
