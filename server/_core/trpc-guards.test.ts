/**
 * server/_core/trpc-guards.test.ts
 *
 * Phase 24:
 *  - F3: tRPC batch-size cap (reject > 10 comma-joined procedure paths).
 *  - F0 (interim): ollama.activeBackend requires an admin session until the
 *    procedure itself is restricted in routers.ts.
 *
 * The real middlewares are invoked with synthetic req/res objects. The
 * unauthenticated 401 branch needs no DB; the admin/role branches use a real
 * session token + the real DB (skipped when DATABASE_URL is absent, the
 * repo's DB-backed-test convention).
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { trpcBatchSizeGuard, ollamaActiveBackendGuard, TRPC_MAX_BATCH_SIZE } from "./trpc-guards";

// ── Synthetic express req/res ───────────────────────────────────────────────
function fakeReq(path: string, headers: Record<string, string> = {}): Request {
  return { path, headers, ip: "203.0.113.9" } as unknown as Request;
}
function fakeRes() {
  const state: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) { state.status = code; return res; },
    json(payload: unknown) { state.body = payload; return res; },
  } as unknown as Response;
  return { res, state };
}
const nextSpy = () => {
  const calls: unknown[] = [];
  const next: NextFunction = (err?: unknown) => { calls.push(err ?? null); };
  return { next, calls };
};

describe("trpcBatchSizeGuard (F3)", () => {
  it("passes a single-procedure call through", () => {
    const { res } = fakeRes();
    const { next, calls } = nextSpy();
    trpcBatchSizeGuard(fakeReq("/disputes.list"), res, next);
    expect(calls).toHaveLength(1);
  });
  it(`passes a batch of exactly ${TRPC_MAX_BATCH_SIZE} through`, () => {
    const path = "/" + Array.from({ length: TRPC_MAX_BATCH_SIZE }, (_, i) => `q.${i}`).join(",");
    const { res } = fakeRes();
    const { next, calls } = nextSpy();
    trpcBatchSizeGuard(fakeReq(path), res, next);
    expect(calls).toHaveLength(1);
  });
  it(`rejects a batch of ${TRPC_MAX_BATCH_SIZE + 1} with 400 before any procedure runs`, () => {
    const path = "/" + Array.from({ length: TRPC_MAX_BATCH_SIZE + 1 }, (_, i) => `q.${i}`).join(",");
    const { res, state } = fakeRes();
    const { next, calls } = nextSpy();
    trpcBatchSizeGuard(fakeReq(path), res, next);
    expect(calls).toHaveLength(0);
    expect(state.status).toBe(400);
    expect(String((state.body as { error: string }).error)).toContain(String(TRPC_MAX_BATCH_SIZE));
  });
  it("rejects a 500-procedure amplification batch", () => {
    const path = "/" + Array.from({ length: 500 }, () => "auth.me").join(",");
    const { res, state } = fakeRes();
    const { next, calls } = nextSpy();
    trpcBatchSizeGuard(fakeReq(path), res, next);
    expect(calls).toHaveLength(0);
    expect(state.status).toBe(400);
  });
});

describe("ollamaActiveBackendGuard (F0, interim)", () => {
  it("passes unrelated procedures through without touching auth", async () => {
    const { res } = fakeRes();
    const { next, calls } = nextSpy();
    await ollamaActiveBackendGuard(fakeReq("/disputes.list"), res, next);
    expect(calls).toHaveLength(1);
  });
  it("rejects an unauthenticated call with 401 JSON", async () => {
    const { res, state } = fakeRes();
    const { next, calls } = nextSpy();
    await ollamaActiveBackendGuard(fakeReq("/ollama.activeBackend"), res, next);
    expect(calls).toHaveLength(0);
    expect(state.status).toBe(401);
  });
  it("also catches the procedure inside a batch (comma-joined path)", async () => {
    const { res, state } = fakeRes();
    const { next, calls } = nextSpy();
    await ollamaActiveBackendGuard(fakeReq("/auth.me,ollama.activeBackend"), res, next);
    expect(calls).toHaveLength(0);
    expect(state.status).toBe(401);
  });
  it("rejects a garbage session cookie with 401", async () => {
    const { res, state } = fakeRes();
    const { next } = nextSpy();
    await ollamaActiveBackendGuard(fakeReq("/ollama.activeBackend", { cookie: "app_session_id=garbage" }), res, next);
    expect(state.status).toBe(401);
  });

  // Session-backed branches need the real DB (resolveSession → users table).
  const HAS_DB = !!process.env.DATABASE_URL;
  describe.skipIf(!HAS_DB)("session-backed branches (DB)", () => {
    const adminId = "p24-guard-admin";
    const nonAdminId = "p24-guard-nonadmin"; // auto-provisioned as role=user
    let cookieFor: (userId: string) => Promise<string>;
    let dbCleanup: () => Promise<void>;

    beforeAll(async () => {
      process.env.JWT_SECRET ??= "p24-trpc-guards-test-secret";
      const { createSessionToken } = await import("./keycloak");
      const { COOKIE_NAME } = await import("@shared/const");
      cookieFor = async (userId: string) => `${COOKIE_NAME}=${await createSessionToken(userId, "T", "t@example.com")}`;
      const { getDb } = await import("../db");
      const db = await getDb();
      const { users } = await import("../../drizzle/schema");
      const { inArray } = await import("drizzle-orm");
      await db!.delete(users).where(inArray(users.id, [adminId, nonAdminId]));
      await db!.insert(users).values({ id: adminId, name: "Guard Admin", email: "p24-guard-admin@example.com", role: "admin" });
      dbCleanup = async () => { await db!.delete(users).where(inArray(users.id, [adminId, nonAdminId])); };
    });
    afterAll(async () => { await dbCleanup?.(); });

    it("403s a non-admin session (auto-provisioned role=user)", async () => {
      const { res, state } = fakeRes();
      const { next, calls } = nextSpy();
      const cookie = await cookieFor(nonAdminId);
      await ollamaActiveBackendGuard(fakeReq("/ollama.activeBackend", { cookie }), res, next);
      expect(calls).toHaveLength(0);
      expect(state.status).toBe(403);
    });
    it("admits an admin session", async () => {
      const { res } = fakeRes();
      const { next, calls } = nextSpy();
      const cookie = await cookieFor(adminId);
      await ollamaActiveBackendGuard(fakeReq("/ollama.activeBackend", { cookie }), res, next);
      expect(calls).toHaveLength(1);
    });
  });
});
