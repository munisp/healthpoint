import { createHash, randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://idr_user:idr_pass123@127.0.0.1:5432/idr_demo";
const jwtSecret = new TextEncoder().encode("visual-e2e-session-secret-32-characters-minimum");
const userId = `visual-ops-${randomUUID()}`.slice(0, 64);
const email = `visual-ops-${createHash("sha256").update(userId).digest("hex").slice(0, 10)}@example.invalid`;
const sql = postgres(databaseUrl, { max: 1 });

async function makeSession() {
  return new SignJWT({ sub: userId, name: "Visual Operations Administrator", email, type: "session", jti: randomUUID() })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("8h")
    .sign(jwtSecret);
}

test.beforeAll(async () => {
  await sql`insert into users (id, name, email, "loginMethod", role) values (${userId}, ${"Visual Operations Administrator"}, ${email}, ${"e2e"}, ${"admin"}) on conflict (id) do update set role = excluded.role`;
});

test.afterAll(async () => {
  await sql`delete from users where id = ${userId}`;
  await sql.end({ timeout: 5 });
});

test.beforeEach(async ({ context }) => {
  await context.addCookies([{ name: "app_session_id", value: await makeSession(), domain: "127.0.0.1", path: "/", httpOnly: true }]);
});

test("renders the Heartbeat operations dashboard with durable proof controls", async ({ page }, testInfo) => {
  await page.goto("/admin/heartbeat");
  await expect(page.getByRole("heading", { name: "Heartbeat & Balance Proofs" })).toBeVisible();
  await expect(page.getByText("Heartbeat execution state")).toBeVisible();
  await expect(page.getByText("Durable balance-proof evidence")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search Heartbeat records" })).toBeVisible();
  await expect(page.getByText("All schedule states")).toBeVisible();
  await expect(page.getByText("All proof statuses")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("heartbeat-operations.png"), fullPage: true });
});

test("renders the provider dispute workspace with filters and CSV export", async ({ page }, testInfo) => {
  await page.goto("/provider/disputes");
  await expect(page.getByRole("heading", { name: "My Disputes" })).toBeVisible();
  await expect(page.getByPlaceholder("Search reference number or party")).toBeVisible();
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("provider-disputes.png"), fullPage: true });
});
