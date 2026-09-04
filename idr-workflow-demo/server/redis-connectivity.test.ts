import Redis from "ioredis";
import { afterAll, describe, expect, it } from "vitest";

const redisUrl = process.env.REDIS_URL;
const liveRedisConfigured = Boolean(redisUrl?.startsWith("rediss://"));
let client: Redis | null = null;
const describeLiveRedis = liveRedisConfigured ? describe : describe.skip;

describeLiveRedis("configured Redis endpoint", () => {
  it("authenticates and responds to a non-destructive PING", async () => {
    expect(redisUrl).toBeTruthy();
    client = new Redis(redisUrl!, { connectTimeout: 5_000, maxRetriesPerRequest: 1 });
    await expect(client.ping()).resolves.toBe("PONG");
  }, 10_000);
});

afterAll(async () => {
  if (client) await client.quit();
});
