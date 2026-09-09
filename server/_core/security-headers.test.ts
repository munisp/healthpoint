import express from "express";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { securityHeaders } from "./security-headers";

async function fetchHeaders(isProduction: boolean): Promise<Headers> {
  const app = express();
  app.use(securityHeaders(isProduction));
  app.get("/", (_req, res) => res.json({ ok: true }));
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not expose a TCP address");
  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/`);
    return res.headers;
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
  }
}

describe("security headers", () => {
  it("sets CSP, HSTS, nosniff, referrer and frame headers in production", async () => {
    const headers = await fetchHeaders(true);

    const csp = headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    // Vite PWA client loads Google Fonts stylesheets (client/index.html)
    expect(csp).toContain("https://fonts.googleapis.com");
    expect(csp).toContain("https://fonts.gstatic.com");
    // Service worker (client/public/sw.js) is same-origin
    expect(csp).toContain("worker-src 'self'");

    expect(headers.get("strict-transport-security")).toContain("max-age=31536000");
    expect(headers.get("strict-transport-security")).toContain("includeSubDomains");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("referrer-policy")).toBe("no-referrer");
    expect(headers.get("x-frame-options")).toBe("DENY");
  });

  it("omits CSP and HSTS in development so Vite HMR keeps working", async () => {
    const headers = await fetchHeaders(false);
    expect(headers.get("content-security-policy")).toBeNull();
    expect(headers.get("strict-transport-security")).toBeNull();
    expect(headers.get("x-content-type-options")).toBe("nosniff");
  });
});
