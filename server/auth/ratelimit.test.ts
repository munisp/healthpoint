import express from "express";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createRateLimiter, type IncrementFn } from "./ratelimit";

function memoryIncrementer(): { increment: IncrementFn; counts: Map<string, number> } {
  const counts = new Map<string, number>();
  return {
    counts,
    increment: async key => {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    },
  };
}

const unavailableIncrementer: IncrementFn = async () => null;

describe("Redis-backed rate limiter", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => server!.close(err => (err ? reject(err) : resolve())));
    }
    server = undefined;
  });

  async function startServer(app: express.Express): Promise<string> {
    server = createServer(app);
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not expose a TCP address");
    return `http://127.0.0.1:${address.port}`;
  }

  it("allows up to N requests per window, then blocks with 429 + Retry-After", async () => {
    const { increment } = memoryIncrementer();
    const app = express();
    app.use(createRateLimiter({ name: "test", max: 3, windowSeconds: 60, failClosed: true, increment }));
    app.get("/ping", (_req, res) => res.json({ ok: true }));
    const base = await startServer(app);

    const statuses: number[] = [];
    let last: Response | null = null;
    for (let i = 0; i < 4; i++) {
      last = await fetch(`${base}/ping`);
      statuses.push(last.status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
    expect(last!.headers.get("retry-after")).toBe("60");
    expect(last!.headers.get("x-ratelimit-limit")).toBe("3");
    expect(last!.headers.get("x-ratelimit-remaining")).toBe("0");
  });

  it("fails closed (503) on sensitive routes when Redis is unavailable in production", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const app = express();
      app.use(createRateLimiter({ name: "auth", max: 20, windowSeconds: 60, failClosed: true, increment: unavailableIncrementer }));
      app.get("/login", (_req, res) => res.json({ ok: true }));
      const base = await startServer(app);
      const res = await fetch(`${base}/login`);
      expect(res.status).toBe(503);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it("fail-open-with-log outside production when Redis is unavailable", async () => {
    const app = express();
    app.use(createRateLimiter({ name: "auth", max: 20, windowSeconds: 60, failClosed: true, increment: unavailableIncrementer }));
    app.get("/login", (_req, res) => res.json({ ok: true }));
    const base = await startServer(app);
    const res = await fetch(`${base}/login`);
    expect(res.status).toBe(200);
  });

  it("low-risk limiter (failClosed: false) fails open with a log even in production", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const app = express();
      app.use(createRateLimiter({ name: "api", max: 300, windowSeconds: 60, failClosed: false, increment: unavailableIncrementer }));
      app.get("/list", (_req, res) => res.json({ ok: true }));
      const base = await startServer(app);
      const res = await fetch(`${base}/list`);
      expect(res.status).toBe(200);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });
});
