import { describe, it, expect, vi } from "vitest";
import { withEmrRetry, isTransientError, persistSyncLogWithRetry } from "./retry";

const noSleep = () => Promise.resolve();
const err = (msg: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(msg), extra);

describe("isTransientError", () => {
  it("treats 5xx as transient", () => {
    expect(isTransientError(err("boom", { status: 500 }))).toBe(true);
    expect(isTransientError(err("boom", { status: 503 }))).toBe(true);
  });
  it("treats 4xx as permanent", () => {
    expect(isTransientError(err("bad", { status: 400 }))).toBe(false);
    expect(isTransientError(err("nf", { status: 404 }))).toBe(false);
    expect(isTransientError(err("unauth", { status: 401 }))).toBe(false);
  });
  it("treats timeouts and network errors as transient", () => {
    expect(isTransientError(Object.assign(new Error("t"), { name: "TimeoutError" }))).toBe(true);
    expect(isTransientError(err("conn", { code: "ECONNREFUSED" }))).toBe(true);
    expect(isTransientError(err("rst", { code: "ECONNRESET" }))).toBe(true);
    expect(isTransientError(new TypeError("fetch failed"))).toBe(true);
  });
  it("treats generic errors as non-transient", () => {
    expect(isTransientError(new Error("parse error"))).toBe(false);
  });
});

describe("withEmrRetry", () => {
  it("returns immediately on success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    expect(await withEmrRetry(fn, { sleep: noSleep })).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures up to 3 attempts then succeeds", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(err("s1", { status: 502 }))
      .mockRejectedValueOnce(err("s2", { status: 503 }))
      .mockResolvedValue("recovered");
    expect(await withEmrRetry(fn, { sleep: noSleep })).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry 4xx", async () => {
    const fn = vi.fn().mockRejectedValue(err("nope", { status: 422 }));
    await expect(withEmrRetry(fn, { sleep: noSleep })).rejects.toThrow("nope");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("exhausts attempts on persistent transient failure", async () => {
    const fn = vi.fn().mockRejectedValue(err("down", { status: 500 }));
    await expect(withEmrRetry(fn, { sleep: noSleep })).rejects.toThrow("down");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("applies exponential backoff delays", async () => {
    const delays: number[] = [];
    const sleep = (ms: number) => { delays.push(ms); return Promise.resolve(); };
    const fn = vi.fn().mockRejectedValue(err("down", { status: 500 }));
    await expect(withEmrRetry(fn, { sleep, baseDelayMs: 100 })).rejects.toThrow();
    expect(delays).toEqual([100, 200]);
  });
});

describe("persistSyncLogWithRetry", () => {
  it("persists on first try", async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    await persistSyncLogWithRetry(insert, { sleep: noSleep });
    expect(insert).toHaveBeenCalledTimes(1);
  });
  it("retries the insert exactly once and succeeds", async () => {
    const insert = vi.fn().mockRejectedValueOnce(new Error("db blip")).mockResolvedValue(undefined);
    await persistSyncLogWithRetry(insert, { sleep: noSleep });
    expect(insert).toHaveBeenCalledTimes(2);
  });
  it("never throws even if both inserts fail", async () => {
    const insert = vi.fn().mockRejectedValue(new Error("db down"));
    await expect(persistSyncLogWithRetry(insert, { sleep: noSleep })).resolves.toBeUndefined();
    expect(insert).toHaveBeenCalledTimes(2);
  });
});
