import { defineConfig } from "@playwright/test";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://idr_user:idr_pass123@127.0.0.1:5432/idr_demo";

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm run dev",
    url: "http://127.0.0.1:4173/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: "4173",
      DATABASE_URL: databaseUrl,
      SETTLEMENT_CALLBACK_PROVIDER: "mojaloop",
    },
  },
});
