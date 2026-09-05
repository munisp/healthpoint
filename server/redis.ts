/**
 * server/redis.ts
 * Redis client, distributed locking (Redlock), session cache, and pub/sub helpers.
 *
 * In production: set REDIS_URL env var (e.g. redis://localhost:6379 or rediss://...),
 * or REDIS_SENTINELS + REDIS_MASTER_NAME for Sentinel-managed failover.
 * In development/test without Redis: all operations degrade gracefully to no-ops.
 */

import Redis from "ioredis";
import { createRequire } from "module";
const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Redlock: any = _require("redlock");

// ── Client singleton ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RedlockInstance = any;
let _redis: Redis | null = null;
let _redlock: RedlockInstance | null = null;

export class DistributedLockUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DistributedLockUnavailableError";
  }
}

function getRedisUrl(): string | null {
  return process.env.REDIS_URL ?? null;
}

type SentinelConfig = {
  sentinels: Array<{ host: string; port: number }>;
  name: string;
  password?: string;
  sentinelPassword?: string;
};

/**
 * Sentinel discovery (production HA). When REDIS_SENTINELS is set to a
 * comma-separated "host:port" list and REDIS_MASTER_NAME names the monitored
 * primary set, ioredis discovers the current primary through Sentinel and
 * re-resolves it automatically after a failover. REDIS_PASSWORD authenticates
 * against the data nodes; REDIS_SENTINEL_PASSWORD (optional) authenticates
 * against the sentinels. REDIS_URL is ignored when Sentinel is configured.
 */
function getSentinelConfig(): SentinelConfig | null {
  const raw = process.env.REDIS_SENTINELS?.trim();
  const name = process.env.REDIS_MASTER_NAME?.trim();
  if (!raw || !name) return null;
  const sentinels = raw
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .map(entry => {
      const idx = entry.lastIndexOf(":");
      const host = idx > 0 ? entry.slice(0, idx) : entry;
      const port = idx > 0 ? parseInt(entry.slice(idx + 1), 10) : 26379;
      if (!host || !Number.isFinite(port)) {
        throw new Error(`[Redis] Malformed REDIS_SENTINELS entry: "${entry}" (expected host:port)`);
      }
      return { host, port };
    });
  if (!sentinels.length) return null;
  return {
    sentinels,
    name,
    password: process.env.REDIS_PASSWORD || undefined,
    sentinelPassword: process.env.REDIS_SENTINEL_PASSWORD || undefined,
  };
}

export function getRedisClient(): Redis | null {
  if (_redis) return _redis;
  const sentinel = getSentinelConfig();
  const url = sentinel ? null : getRedisUrl();
  if (!sentinel && !url) return null;

  try {
    _redis = sentinel
      ? new Redis({
          sentinels: sentinel.sentinels,
          name: sentinel.name,
          password: sentinel.password,
          sentinelPassword: sentinel.sentinelPassword,
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          lazyConnect: false,
        })
      : new Redis(url as string, {
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          lazyConnect: false,
        });

    _redis.on("error", (err: Error) => {
      console.warn("[Redis] Connection error:", err.message);
    });

    _redis.on("connect", () => {
      console.info("[Redis] Connected");
    });

    return _redis;
  } catch (err) {
    console.warn("[Redis] Failed to initialize client:", err);
    return null;
  }
}

export function getRedlock(): RedlockInstance | null {
  if (_redlock) return _redlock;
  const client = getRedisClient();
  if (!client) return null;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  _redlock = new Redlock([client as unknown], {
    driftFactor: 0.01,
    retryCount: 5,
    retryDelay: 200,
    retryJitter: 100,
    automaticExtensionThreshold: 500,
  });

  _redlock.on("error", (err: Error) => {
    console.warn("[Redlock] Error:", err.message);
  });

  return _redlock;
}

// ── Distributed locking ──────────────────────────────────────────────────────

/**
 * Acquire a distributed lock for a dispute state transition.
 * Production state changes require a Redlock lease. Development and test
 * instances may use their PostgreSQL transaction controls without Redis.
 */
export async function withDisputeLock<T>(
  disputeId: string,
  ttlMs: number,
  fn: () => Promise<T>
): Promise<T> {
  const redlock = getRedlock();
  if (!redlock) {
    if (process.env.NODE_ENV === "production") {
      throw new DistributedLockUnavailableError("Redis/Redlock is unavailable; refusing an unprotected production dispute transition");
    }
    return fn();
  }

  const resource = `locks:dispute:${disputeId}`;
  let lock;
  try {
    lock = await redlock.acquire([resource], ttlMs);
  } catch (err) {
    console.warn(`[Redlock] Could not acquire lock for dispute ${disputeId}:`, err);
    if (process.env.NODE_ENV === "production") {
      throw new DistributedLockUnavailableError("Redis/Redlock lease was not acquired; refusing an unprotected production dispute transition");
    }
    return fn();
  }

  try {
    return await fn();
  } finally {
    try {
      await lock.release();
    } catch (err) {
      console.warn("[Redis] Failed to release lock for dispute ${disputeId}:", err);
    }
  }
}

// ── Session / token cache ────────────────────────────────────────────────────

const SESSION_TTL_SECONDS = 60 * 60 * 24; // 24 hours

/**
 * Store a session value (e.g. JWT revocation list entry, PKCE state).
 */
export async function sessionSet(key: string, value: string, ttlSeconds = SESSION_TTL_SECONDS): Promise<void> {
  const client = getRedisClient();
  if (!client) return;
  try {
    await client.set(`session:${key}`, value, "EX", ttlSeconds);
  } catch (err) {
    console.warn("[Redis] sessionSet error:", err);
  }
}

/**
 * Retrieve a session value.
 */
export async function sessionGet(key: string): Promise<string | null> {
  const client = getRedisClient();
  if (!client) return null;
  try {
    return await client.get(`session:${key}`);
  } catch (err) {
    console.warn("[Redis] sessionGet error:", err);
    return null;
  }
}

/**
 * Delete a session value (e.g. on logout / token revocation).
 */
export async function sessionDel(key: string): Promise<void> {
  const client = getRedisClient();
  if (!client) return;
  try {
    await client.del(`session:${key}`);
  } catch (err) {
    console.warn("[Redis] sessionDel error:", err);
  }
}

/**
 * Add a JWT JTI to the revocation list (blocklist).
 * The TTL should match the token's remaining lifetime.
 */
export async function revokeToken(jti: string, ttlSeconds: number): Promise<void> {
  const client = getRedisClient();
  if (!client) return;
  try {
    await client.set(`revoked:${jti}`, "1", "EX", ttlSeconds);
  } catch (err) {
    console.warn("[Redis] revokeToken error:", err);
  }
}

/**
 * Check if a JWT JTI has been revoked.
 *
 * Fail-closed in production: if Redis is unavailable or errors, the token is
 * treated as revoked (request rejected) rather than silently allowed through.
 * Development/test keep the graceful fail-open path with a warning, matching
 * the rest of this module's degradation behavior.
 */
export async function isTokenRevoked(jti: string): Promise<boolean> {
  const client = getRedisClient();
  if (!client) {
    if (process.env.NODE_ENV === "production") {
      console.error("[Redis] isTokenRevoked: Redis client unavailable in production — treating token as revoked");
      return true;
    }
    return false;
  }
  try {
    const val = await client.get(`revoked:${jti}`);
    return val === "1";
  } catch (err) {
    if (process.env.NODE_ENV === "production") {
      console.error("[Redis] isTokenRevoked error — treating token as revoked (fail-closed):", err);
      return true;
    }
    console.warn("[Redis] isTokenRevoked error:", err);
    return false;
  }
}

// ── Rate limiting state (Redis-backed) ──────────────────────────────────────

/**
 * Increment a rate limit counter for a given key (e.g. IP:endpoint).
 * Returns the current count after increment.
 */
export async function rateLimitIncr(key: string, windowSeconds: number): Promise<number> {
  const client = getRedisClient();
  if (!client) return 0;
  try {
    const fullKey = `ratelimit:${key}`;
    const count = await client.incr(fullKey);
    if (count === 1) {
      await client.expire(fullKey, windowSeconds);
    }
    return count;
  } catch (err) {
    console.warn("[Redis] rateLimitIncr error:", err);
    return 0;
  }
}

// ── Pub/Sub for real-time UI notifications ───────────────────────────────────

type NotificationPayload = {
  type: string;
  userId?: string;
  disputeId?: string;
  message: string;
  data?: Record<string, unknown>;
};

/**
 * Publish a real-time notification event to the Redis pub/sub channel.
 * Subscribers (e.g. SSE endpoint) receive these and push to connected clients.
 */
export async function publishNotification(payload: NotificationPayload): Promise<void> {
  const client = getRedisClient();
  if (!client) return;
  try {
    await client.publish("idr:notifications", JSON.stringify(payload));
  } catch (err) {
    console.warn("[Redis] publishNotification error:", err);
  }
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

/**
 * Generic cache get with JSON deserialization.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const client = getRedisClient();
  if (!client) return null;
  try {
    const raw = await client.get(`cache:${key}`);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn("[Redis] cacheGet error:", err);
    return null;
  }
}

/**
 * Generic cache set with JSON serialization.
 */
export async function cacheSet<T>(key: string, value: string, ttlSeconds = 300): Promise<void> {
  const client = getRedisClient();
  if (!client) return;
  try {
    await client.set(`cache:${key}`, JSON.stringify(value), "EX", ttlSeconds);
  } catch (err) {
    console.warn("[Redis] cacheSet error:", err);
  }
}

/**
 * Invalidate a cache entry.
 */
export async function cacheDel(key: string): Promise<void> {
  const client = getRedisClient();
  if (!client) return;
  try {
    await client.del(`cache:${key}`);
  } catch (err) {
    console.warn("[Redis] cacheDel error:", err);
  }
}

/**
 * Graceful shutdown — close the Redis connection.
 */
export async function closeRedis(): Promise<void> {
  if (_redis) {
    try {
      await _redis.quit();
    } catch {
      _redis.disconnect();
    }
    _redis = null;
    _redlock = null;
  }
}
