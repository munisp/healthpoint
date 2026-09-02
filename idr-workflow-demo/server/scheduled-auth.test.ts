import { describe, expect, it, vi } from "vitest";
import { createScheduledAuth } from "./_core/scheduled-auth";

function response() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { status, json } as any;
}

const secret = "a".repeat(32);

describe("scheduled callback authentication", () => {
  it("accepts only an authenticated scheduler bearer token", async () => {
    const next = vi.fn();
    const middleware = createScheduledAuth(true, secret);
    await middleware({ header: vi.fn(() => `Bearer ${secret}`) } as any, response(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("rejects a regular request without a scheduler bearer token", async () => {
    const next = vi.fn();
    const res = response();
    const middleware = createScheduledAuth(true, secret);
    await middleware({ header: vi.fn(() => undefined) } as any, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("fails closed when scheduler authorization is not configured", async () => {
    const next = vi.fn();
    const res = response();
    const middleware = createScheduledAuth(true, "invalid");
    await middleware({ header: vi.fn(() => "Bearer invalid") } as any, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
  });
});
