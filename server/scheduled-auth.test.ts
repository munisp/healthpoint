import { describe, expect, it, vi } from "vitest";
import { createScheduledAuth } from "./scheduled-auth";

function response() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { status, json } as any;
}

describe("scheduled callback authentication", () => {
  it("accepts an authenticated platform cron identity", async () => {
    const next = vi.fn();
    const middleware = createScheduledAuth(true, "internal", async () => ({ isCron: true, taskUid: "task-1" } as any));
    await middleware({ headers: {} } as any, response(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("rejects a regular request without cron identity or internal token", async () => {
    const next = vi.fn();
    const res = response();
    const middleware = createScheduledAuth(true, "internal", async () => ({ isCron: false } as any));
    await middleware({ headers: {} } as any, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
