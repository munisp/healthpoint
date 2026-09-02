import { afterEach, describe, expect, it } from "vitest";
import { DistributedLockUnavailableError, withDisputeLock } from "./redis";

const originalNodeEnv = process.env.NODE_ENV;
const originalRedisUrl = process.env.REDIS_URL;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = originalRedisUrl;
});

describe("withDisputeLock production fail-closed behavior", () => {
  it("rejects an unprotected production transition when Redis is unavailable", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.REDIS_URL;
    await expect(withDisputeLock("dispute-production-lock-test", 1_000, async () => "unsafe"))
      .rejects.toBeInstanceOf(DistributedLockUnavailableError);
  });

  it("permits isolated development execution without Redis", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.REDIS_URL;
    await expect(withDisputeLock("dispute-development-lock-test", 1_000, async () => "safe"))
      .resolves.toBe("safe");
  });
});
