import express from "express";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { isOriginAllowed } from "./cors-policy";

const prod = { isProduction: true, configuredOrigins: ["https://app.example.com"] };

describe("isOriginAllowed", () => {
  it("allows requests without an Origin header", () => {
    expect(isOriginAllowed({ origin: undefined, host: "app.example.com" }, prod)).toBe(true);
  });

  it("allows every origin in development", () => {
    expect(isOriginAllowed({ origin: "https://evil.tld", host: "localhost:3000" }, { ...prod, isProduction: false })).toBe(true);
  });

  it("allows configured origins by exact match only", () => {
    expect(isOriginAllowed({ origin: "https://app.example.com", host: "api.internal" }, prod)).toBe(true);
    expect(isOriginAllowed({ origin: "https://app.example.com.evil.tld", host: "api.internal" }, prod)).toBe(false);
  });

  it("allows the app's own origin even when it is not configured", () => {
    // The live bug: healthpoint.newfire.app was not in ALLOWED_ORIGINS, so the
    // browser's same-origin module-script requests were rejected.
    expect(isOriginAllowed({ origin: "https://healthpoint.newfire.app", host: "healthpoint.newfire.app" }, prod)).toBe(true);
    expect(isOriginAllowed({ origin: "https://HealthPoint.newfire.app", host: "healthpoint.newfire.app" }, prod)).toBe(true);
    expect(isOriginAllowed({ origin: "http://localhost:3000", host: "localhost:3000" }, prod)).toBe(true);
  });

  it("denies other origins, a different port, and unparseable or non-http origins", () => {
    expect(isOriginAllowed({ origin: "https://evil.tld", host: "healthpoint.newfire.app" }, prod)).toBe(false);
    expect(isOriginAllowed({ origin: "https://healthpoint.newfire.app:8443", host: "healthpoint.newfire.app" }, prod)).toBe(false);
    expect(isOriginAllowed({ origin: "null", host: "healthpoint.newfire.app" }, prod)).toBe(false);
    expect(isOriginAllowed({ origin: "file://healthpoint.newfire.app", host: "healthpoint.newfire.app" }, prod)).toBe(false);
    expect(isOriginAllowed({ origin: "https://healthpoint.newfire.app", host: undefined }, prod)).toBe(false);
  });
});

describe("CORS gate as middleware", () => {
  async function request(origin: string | undefined): Promise<number> {
    const app = express();
    app.use((req, res, next) => {
      if (isOriginAllowed({ origin: req.headers.origin, host: req.headers.host }, prod)) return next();
      res.status(403).json({ error: "Origin not allowed" });
    });
    app.get("/assets/app.js", (_req, res) => res.type("text/javascript").send("ok"));
    const server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not expose a TCP address");
    try {
      const headers: Record<string, string> = {};
      if (origin) headers.Origin = origin;
      const res = await fetch(`http://127.0.0.1:${address.port}/assets/app.js`, { headers });
      return res.status;
    } finally {
      await new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
    }
  }

  it("serves a same-origin request that carries an Origin header", async () => {
    // fetch sets Host to 127.0.0.1:<port>; a same-origin browser request sends the matching Origin.
    const app = express();
    let port = 0;
    app.use((req, res, next) => {
      if (isOriginAllowed({ origin: req.headers.origin, host: req.headers.host }, prod)) return next();
      res.status(403).json({ error: "Origin not allowed" });
    });
    app.get("/", (_req, res) => res.send("ok"));
    const server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not expose a TCP address");
    port = address.port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { headers: { Origin: `http://127.0.0.1:${port}` } });
      expect(res.status).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
    }
  });

  it("answers a disallowed cross-origin request with 403, not 500", async () => {
    expect(await request("https://evil.tld")).toBe(403);
  });

  it("serves requests without an Origin header", async () => {
    expect(await request(undefined)).toBe(200);
  });
});
