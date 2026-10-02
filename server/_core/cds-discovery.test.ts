/**
 * CDS Hooks discovery endpoint tests.
 * DB-backed discovery-shape cases run when DATABASE_URL is set; auth-gate
 * cases always run (DB not reached on 401).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import postgres from "postgres";
import { SignJWT } from "jose";
import { registerCdsDiscovery } from "./cds-discovery";

const DB_URL = process.env.DATABASE_URL;
const SECRET = "cds-test-secret";

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  registerCdsDiscovery(app);
  server = createServer(app);
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise(r => server.close(r)));

async function get(path: string, token?: string) {
  const res = await fetch(`${base}${path}`, token ? { headers: { authorization: `Bearer ${token}` } } : undefined);
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe("GET /cds-services — auth gate", () => {
  it("401s without a token when CDS_JWT_REQUIRED=true", async () => {
    process.env.CDS_JWT_REQUIRED = "true";
    process.env.CDS_JWT_SECRET = SECRET;
    const r = await get("/cds-services");
    expect(r.status).toBe(401);
    delete process.env.CDS_JWT_REQUIRED;
    delete process.env.CDS_JWT_SECRET;
  });

  it("401s with a wrongly-signed token", async () => {
    process.env.CDS_JWT_REQUIRED = "true";
    process.env.CDS_JWT_SECRET = SECRET;
    const bad = await new SignJWT({ iss: "ehr" }).setProtectedHeader({ alg: "HS256" })
      .sign(new TextEncoder().encode("wrong-secret"));
    expect((await get("/cds-services", bad)).status).toBe(401);
    delete process.env.CDS_JWT_REQUIRED;
    delete process.env.CDS_JWT_SECRET;
  });
});

const describeDb = DB_URL ? describe : describe.skip;

describeDb("GET /cds-services — discovery document (DB)", () => {
  const sql = postgres(DB_URL!, { max: 1 });
  const hookId = `cds-disc-${Date.now()}`;

  beforeAll(async () => {
    await sql.unsafe(
      `INSERT INTO cds_hooks (id, "emrConnectionId", "hookId", title, description, prefetch, status)
       VALUES ($1, 'conn-x', 'order-select', 'W6 Test Hook', 'discovery shape test', '{}', 'active')`,
      [hookId],
    );
    await sql.unsafe(
      `INSERT INTO cds_hooks (id, "emrConnectionId", "hookId", title, description, prefetch, status)
       VALUES ($1, 'conn-x', 'order-select', 'Inactive Hook', 'should not appear', '{}', 'inactive')`,
      [`${hookId}-inactive`],
    );
  });

  afterAll(async () => {
    await sql.unsafe(`DELETE FROM cds_hooks WHERE id LIKE $1`, [`${hookId}%`]);
    await sql.end();
  });

  it("returns the CDS-spec discovery shape with only active hooks", async () => {
    delete process.env.CDS_JWT_REQUIRED;
    const r = await get("/cds-services");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.services)).toBe(true);
    const svc = r.body.services.find((s: any) => s.id === hookId);
    expect(svc).toBeDefined();
    expect(svc.hook).toBe("order-select");
    expect(svc.title).toBe("W6 Test Hook");
    expect(svc.description).toBe("discovery shape test");
    expect(r.body.services.find((s: any) => s.id === `${hookId}-inactive`)).toBeUndefined();
  });

  it("serves the document with a valid JWT when required", async () => {
    process.env.CDS_JWT_REQUIRED = "true";
    process.env.CDS_JWT_SECRET = SECRET;
    const token = await new SignJWT({ iss: "ehr-test" }).setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("5m").sign(new TextEncoder().encode(SECRET));
    const r = await get("/cds-services", token);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.services)).toBe(true);
    delete process.env.CDS_JWT_REQUIRED;
    delete process.env.CDS_JWT_SECRET;
  });
});
