/**
 * server/auth/ratelimit.ts
 *
 * Redis-backed fixed-window rate limiter (INCR + EXPIRE per key/window).
 *
 * Failure modes:
 *   - failClosed: true  → auth/token/payment/PHI endpoints. When Redis is
 *     unavailable IN PRODUCTION the request is rejected (503) — an
 *     unauthenticated-throttling gap on those routes is not acceptable.
 *     Outside production (local dev without Redis) the limiter logs and
 *     allows, matching server/redis.ts's graceful-degradation convention.
 *   - failClosed: false → low-risk read paths (e.g. the general tRPC limiter).
 *     Backend outages are logged (fail-open-with-log) so a Redis blip cannot
 *     take down read traffic.
 *
 * All limits are configurable via env (see .env.example):
 *   RATE_LIMIT_AUTH_MAX / RATE_LIMIT_AUTH_WINDOW_SECONDS         (default 20/60)
 *   RATE_LIMIT_SENSITIVE_MAX / RATE_LIMIT_SENSITIVE_WINDOW_SECONDS (default 30/60)
 *   RATE_LIMIT_API_MAX / RATE_LIMIT_API_WINDOW_SECONDS           (default 300/60)
 */

import type { NextFunction, Request, Response } from "express";
import { getRedisClient } from "../redis";

/** Returns the post-increment count, or null when the backend is unavailable. */
export type IncrementFn = (key: string, windowSeconds: number) => Promise<number | null>;

const redisIncrement: IncrementFn = async (key, windowSeconds) => {
  const client = getRedisClient();
  if (!client) return null;
  try {
    const fullKey = `ratelimit:${key}`;
    const count = await client.incr(fullKey);
    if (count === 1) {
      await client.expire(fullKey, windowSeconds);
    }
    return count;
  } catch (err) {
    console.warn("[ratelimit] Redis increment error:", err);
    return null;
  }
};

export interface RateLimiterOptions {
  /** Bucket namespace, e.g. "auth" → ratelimit:auth:<ip> */
  name: string;
  max: number;
  windowSeconds: number;
  failClosed: boolean;
  /** Test seam: inject a fake incrementer instead of Redis. */
  increment?: IncrementFn;
}

export function createRateLimiter(options: RateLimiterOptions) {
  const increment = options.increment ?? redisIncrement;

  return async function rateLimiter(req: Request, res: Response, next: NextFunction): Promise<void> {
    const key = `${options.name}:${req.ip ?? "unknown"}`;
    const count = await increment(key, options.windowSeconds);

    if (count === null) {
      if (options.failClosed && process.env.NODE_ENV === "production") {
        console.error(`[ratelimit] backend unavailable for "${options.name}" — failing closed`);
        res.status(503).json({ error: "Rate limiter unavailable — please retry shortly" });
        return;
      }
      console.warn(
        `[ratelimit] backend unavailable for "${options.name}" — allowing request (fail-open${options.failClosed ? " outside production" : ""})`
      );
      next();
      return;
    }

    res.setHeader("X-RateLimit-Limit", String(options.max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, options.max - count)));

    if (count > options.max) {
      res.setHeader("Retry-After", String(options.windowSeconds));
      res.status(429).json({ error: "Too many requests — please slow down" });
      return;
    }
    next();
  };
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Strict limiter for /api/auth/* (login, register, session, token flows). */
export function authRateLimiter() {
  return createRateLimiter({
    name: "auth",
    max: envInt("RATE_LIMIT_AUTH_MAX", 20),
    windowSeconds: envInt("RATE_LIMIT_AUTH_WINDOW_SECONDS", 60),
    failClosed: true,
  });
}

/** Strict limiter for payment/settlement callbacks and PHI routes (/api/settlement/*, /api/fhir/*). */
export function sensitiveRateLimiter() {
  return createRateLimiter({
    name: "sensitive",
    max: envInt("RATE_LIMIT_SENSITIVE_MAX", 30),
    windowSeconds: envInt("RATE_LIMIT_SENSITIVE_WINDOW_SECONDS", 60),
    failClosed: true,
  });
}

/** General tRPC limiter — fail-open-with-log (documented above). */
export function apiRateLimiter() {
  return createRateLimiter({
    name: "api",
    max: envInt("RATE_LIMIT_API_MAX", 300),
    windowSeconds: envInt("RATE_LIMIT_API_WINDOW_SECONDS", 60),
    failClosed: false,
  });
}
