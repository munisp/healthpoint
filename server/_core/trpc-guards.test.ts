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

  // ── Phase-24 fix-wave: interior path segment must NOT shadow the procedure ─
  // @trpc/server's express adapter resolves the procedure from the LAST URL
  // segment only, so /api/trpc/x/ollama.activeBackend (req.path here is
  // "/x/ollama.activeBackend" after the /api/trpc mount strip) still reaches
  // ollama.activeBackend. The guard must parse identically.
  it("blocks an interior-segment bypass (/x/ollama.activeBackend)", async () => {
    const { res, state } = fakeRes();
    const { next, calls } = nextSpy();
    await ollamaActiveBackendGuard(fakeReq("/x/ollama.activeBackend"), res, next);
    expect(calls).toHaveLength(0);
    expect(state.status).toBe(401);
  });
  it("blocks a deep interior-segment bypass (/foo/bar/ollama.activeBackend)", async () => {
    const { res, state } = fakeRes();
    const { next, calls } = nextSpy();
    await ollamaActiveBackendGuard(fakeReq("/foo/bar/ollama.activeBackend"), res, next);
    expect(calls).toHaveLength(0);
    expect(state.status).toBe(401);
  });
  it("blocks the guarded procedure batched behind an interior segment", async () => {
    const { res, state } = fakeRes();
    const { next, calls } = nextSpy();
    await ollamaActiveBackendGuard(fakeReq("/x/auth.me,ollama.activeBackend"), res, next);
    expect(calls).toHaveLength(0);
    expect(state.status).toBe(401);
  });
  it("still passes an unrelated procedure behind an interior segment", async () => {
    const { res } = fakeRes();
    const { next, calls } = nextSpy();
    await ollamaActiveBackendGuard(fakeReq("/x/disputes.list"), res, next);
    expect(calls).toHaveLength(1);
  });
  it("batch-size guard counts only the last segment's procedures", () => {
    // 11 procedures in the last segment behind an interior prefix → reject.
    const path = "/x/" + Array.from({ length: TRPC_MAX_BATCH_SIZE + 1 }, (_, i) => `q.${i}`).join(",");
    const { res, state } = fakeRes();
    const { next, calls } = nextSpy();
    trpcBatchSizeGuard(fakeReq(path), res, next);
    expect(calls).toHaveLength(0);
    expect(state.status).toBe(400);
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

// ── Real Express mount: exercise the guards with Express's own req.path ──────
// The Phase-24 review bypass was empirical: GET /api/trpc/x/ollama.activeBackend
// reached the procedure because Express strips the /api/trpc mount prefix and
// the tRPC adapter reads only the LAST segment. These tests mount the real
// guards exactly like server/_core/index.ts and drive real HTTP requests.
describe("guards mounted on a real Express app (mount-prefix semantics)", () => {
  let server: import("node:http").Server;
  let base: string;

  beforeAll(async () => {
    const { default: express } = await import("express");
    const app = express();
    // Same mount as server/_core/index.ts.
    app.use("/api/trpc", trpcBatchSizeGuard, ollamaActiveBackendGuard);
    // Stand-in for the tRPC handler: anything a guard lets through lands here.
    app.use("/api/trpc", (_req, res) => {
      res.status(200).json({ reached: "trpc-handler" });
    });
    await new Promise<void>(resolve => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    if (typeof addr === "string" || !addr) throw new Error("no listen address");
    base = `http://127.0.0.1:${addr.port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close(err => (err ? reject(err) : resolve()))
    );
  });

  it("REVIEW REPRO: /api/trpc/x/ollama.activeBackend is blocked (401)", async () => {
    const res = await fetch(`${base}/api/trpc/x/ollama.activeBackend`);
    expect(res.status).toBe(401);
  });
  it("REVIEW REPRO: /api/trpc/foo/bar/ollama.activeBackend?batch=1 is blocked (401)", async () => {
    const res = await fetch(`${base}/api/trpc/foo/bar/ollama.activeBackend?batch=1`);
    expect(res.status).toBe(401);
  });
  it("canonical /api/trpc/ollama.activeBackend is still blocked (401)", async () => {
    const res = await fetch(`${base}/api/trpc/ollama.activeBackend`);
    expect(res.status).toBe(401);
  });
  it("canonical batch /api/trpc/auth.me,ollama.activeBackend?batch=1 is still blocked (401)", async () => {
    const res = await fetch(`${base}/api/trpc/auth.me,ollama.activeBackend?batch=1`);
    expect(res.status).toBe(401);
  });
  it("unrelated procedures still reach the handler (200), direct and interior", async () => {
    expect((await fetch(`${base}/api/trpc/disputes.list`)).status).toBe(200);
    expect((await fetch(`${base}/api/trpc/x/disputes.list`)).status).toBe(200);
  });

  // ── Phase-24 fix-wave 3: percent-encoding bypass class ─────────────────────
  // tRPC v11 resolveResponse decodes the procedure path BEFORE batch-splitting
  // (decodePath(opts.path) → path.split(",")), so percent-encoding can smuggle
  // both the procedure name and the batch separator past a guard that never
  // decodes. The guard now decodes first, splits second, and fails closed
  // (400) on malformed encoding — the same outcome tRPC's decodePath gives.
  it("REPRO: /api/trpc/ollama%2EactiveBackend is blocked (401, not a key leak)", async () => {
    const res = await fetch(`${base}/api/trpc/ollama%2EactiveBackend`);
    expect(res.status).toBe(401);
  });
  it("REPRO: /api/trpc/ollama.active%42ackend is blocked (401)", async () => {
    const res = await fetch(`${base}/api/trpc/ollama.active%42ackend`);
    expect(res.status).toBe(401);
  });
  it("REPRO: /api/trpc/ollama.activeBackend%2Cauth.me?batch=1 is blocked (401)", async () => {
    const res = await fetch(`${base}/api/trpc/ollama.activeBackend%2Cauth.me?batch=1`);
    expect(res.status).toBe(401);
  });
  it("REPRO: %2C-encoded batch of 12 is rejected by the size guard (400)", async () => {
    const encoded = Array.from({ length: TRPC_MAX_BATCH_SIZE + 2 }, (_, i) => `q${i}`).join("%2C");
    const res = await fetch(`${base}/api/trpc/${encoded}?batch=1`);
    expect(res.status).toBe(400);
  });
  it("malformed encoding (%ZZ) is blocked (400), never passed through", async () => {
    const res = await fetch(`${base}/api/trpc/ollama%ZZactiveBackend`);
    expect(res.status).toBe(400);
  });
  it("malformed encoding (trailing %) is blocked (400), never passed through", async () => {
    const res = await fetch(`${base}/api/trpc/ollama.activeBackend%`);
    expect(res.status).toBe(400);
  });
  it("a normal encoded batch within the cap still reaches the handler (200)", async () => {
    const res = await fetch(`${base}/api/trpc/auth.me%2Cdisputes.list?batch=1`);
    expect(res.status).toBe(200);
  });
});

// ── Framework-layer batch cap (F3 defense in depth) ─────────────────────────
// server/_core/index.ts passes maxBatchSize: TRPC_MAX_BATCH_SIZE to
// createExpressMiddleware, so the cap holds even if guard/adapter parsing
// ever diverges again. Prove the framework option works as configured: real
// createExpressMiddleware, real router, real HTTP.
describe("createExpressMiddleware maxBatchSize (framework layer)", () => {
  let server: import("node:http").Server;
  let base: string;

  beforeAll(async () => {
    const { default: express } = await import("express");
    const { initTRPC } = await import("@trpc/server");
    const { createExpressMiddleware } = await import("@trpc/server/adapters/express");
    const t = initTRPC.create();
    const router = t.router({
      ping: t.procedure.query(() => "pong"),
    });
    const app = express();
    app.use("/api/trpc", createExpressMiddleware({ router, maxBatchSize: TRPC_MAX_BATCH_SIZE }));
    await new Promise<void>(resolve => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    if (typeof addr === "string" || !addr) throw new Error("no listen address");
    base = `http://127.0.0.1:${addr.port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close(err => (err ? reject(err) : resolve()))
    );
  });

  it("serves a normal batched request within the cap (2 calls → 200, 2 results)", async () => {
    const res = await fetch(`${base}/api/trpc/ping,ping?batch=1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(2);
    for (const item of body) {
      expect((item as { result: { data: string } }).result.data).toBe("pong");
    }
  });
  it("rejects a batch larger than the cap (11 calls → 400)", async () => {
    const path = Array.from({ length: TRPC_MAX_BATCH_SIZE + 1 }, () => "ping").join(",");
    const res = await fetch(`${base}/api/trpc/${path}?batch=1`);
    expect(res.status).toBe(400);
  });
  it("rejects a %2C-encoded batch larger than the cap (400, decode-before-split)", async () => {
    const encoded = Array.from({ length: TRPC_MAX_BATCH_SIZE + 1 }, () => "ping").join("%2C");
    const res = await fetch(`${base}/api/trpc/${encoded}?batch=1`);
    expect(res.status).toBe(400);
  });
});
