/**
 * server/authz-enforce.test.ts — Phase 15 FB (B2): PERMIFY_ENFORCE gate.
 *
 * MOCK-VERIFIED: Permify HTTP is a mocked fetch. Verifies fail-closed
 * semantics when enforcement is enabled and Permify is unconfigured or
 * unreachable, and that Permify's verdict governs when it answers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { canAccessDispute } from "./authz";

describe("Permify enforce mode (B2)", () => {
  const savedEnv = { ...process.env };
  beforeEach(() => {
    delete process.env.PERMIFY_URL;
    delete process.env.PERMIFY_ENFORCE;
  });
  afterEach(() => {
    process.env = { ...savedEnv };
    vi.restoreAllMocks();
  });

  it("fails closed (deny) when PERMIFY_ENFORCE=true and PERMIFY_URL is unset", async () => {
    process.env.PERMIFY_ENFORCE = "true";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const allowed = await canAccessDispute("user-1", "user", "dispute-1", "read");
    expect(allowed).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("honors Permify ALLOW when enforcement is on", async () => {
    process.env.PERMIFY_ENFORCE = "true";
    process.env.PERMIFY_URL = "http://permify.test";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ can: "CHECK_RESULT_ALLOWED" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const allowed = await canAccessDispute("user-1", "user", "dispute-1", "read");
    expect(allowed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://permify.test/v1/tenants/t1/permissions/check");
    expect(JSON.parse(init.body as string).permission).toBe("read");
  });

  it("honors Permify DENY when enforcement is on", async () => {
    process.env.PERMIFY_ENFORCE = "true";
    process.env.PERMIFY_URL = "http://permify.test";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ can: "CHECK_RESULT_DENIED" }), { status: 200 })));
    expect(await canAccessDispute("user-1", "user", "dispute-1", "read")).toBe(false);
  });

  it("fails closed when Permify is unreachable and enforcement is on", async () => {
    process.env.PERMIFY_ENFORCE = "true";
    process.env.PERMIFY_URL = "http://permify.test";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")));
    expect(await canAccessDispute("user-1", "user", "dispute-1", "read")).toBe(false);
  });

  it("fails closed when Permify returns a non-200 and enforcement is on", async () => {
    process.env.PERMIFY_ENFORCE = "true";
    process.env.PERMIFY_URL = "http://permify.test";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("err", { status: 500 })));
    expect(await canAccessDispute("user-1", "user", "dispute-1", "read")).toBe(false);
  });

  it("admins bypass the gate (unchanged behavior)", async () => {
    process.env.PERMIFY_ENFORCE = "true";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await canAccessDispute("admin-1", "admin", "dispute-1", "admin")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
