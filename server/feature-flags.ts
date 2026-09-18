/**
 * server/feature-flags.ts
 *
 * Minimal DB-backed feature flags (wave W5-7).
 *
 * Table `feature_flags` (migration 0041_wave_w5.sql — accessed via raw SQL
 * because drizzle/schema.ts is owned by another wave):
 *   key (pk) | enabled | rolloutPercent (0..100) | description | updatedBy | timestamps
 *
 * Usage pattern
 * ─────────────
 * Server:   `await flags.isEnabled("personas.payerCases", ctx.user.id)`
 * Client:   `trpc.featureFlags.check.useQuery({ key })` — see
 *           client/src/components/FlagGate.tsx which gates persona routes.
 *
 * Semantics:
 *  - Unknown key → DEFAULT-ON (enabled). Flags are a rollout/permissions
 *    convenience, not a safety gate; a missing row must not break pages.
 *  - enabled=false → off for everyone.
 *  - rolloutPercent < 100 → deterministic per-user bucketing:
 *    bucket = sha1(key + ":" + userId)[0..7] % 100; user is in when
 *    bucket < rolloutPercent. The same (key, userId) pair always lands in
 *    the same bucket, so rollouts are stable and monotonic — increasing the
 *    percentage only ADDS users. Anonymous callers (no userId) are bucketed
 *    on the literal "anonymous" identity.
 */
import crypto from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { router, publicProcedure, protectedProcedure } from "./_core/trpc";

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  rolloutPercent: number;
  description: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

/** Deterministic bucket 0..99 for a (key, userId) pair. */
export function flagBucket(key: string, userId: string): number {
  const digest = crypto.createHash("sha1").update(`${key}:${userId}`).digest();
  return digest.readUInt32BE(0) % 100;
}

/** Pure evaluation given a flag row (or null for unknown keys). */
export function evaluateFlag(key: string, flag: Pick<FeatureFlag, "enabled" | "rolloutPercent"> | null, userId?: string): boolean {
  if (!flag) return true; // default-ON for unknown keys
  if (!flag.enabled) return false;
  const pct = Math.max(0, Math.min(100, flag.rolloutPercent));
  if (pct >= 100) return true;
  if (pct <= 0) return false;
  return flagBucket(key, userId ?? "anonymous") < pct;
}

async function getFlagRow(key: string): Promise<FeatureFlag | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.execute(sql`
    SELECT "key", "enabled", "rolloutPercent", "description", "updatedBy", "updatedAt"
    FROM feature_flags WHERE "key" = ${key} LIMIT 1
  `);
  const row = (result as any).rows?.[0] ?? (result as any)[0];
  return (row as FeatureFlag) ?? null;
}

export const flags = {
  /** Default-ON for unknown keys; deterministic bucketing per user. */
  async isEnabled(key: string, userId?: string): Promise<boolean> {
    const row = await getFlagRow(key);
    if (!row) return true;
    if (!row.enabled) return false;
    const pct = Math.max(0, Math.min(100, Number(row.rolloutPercent)));
    if (pct >= 100) return true;
    if (pct <= 0) return false;
    return flagBucket(key, userId ?? "anonymous") < pct;
  },
  async list(): Promise<FeatureFlag[]> {
    const db = await getDb();
    if (!db) return [];
    const result = await db.execute(sql`
      SELECT "key", "enabled", "rolloutPercent", "description", "updatedBy", "updatedAt"
      FROM feature_flags ORDER BY "key"
    `);
    return ((result as any).rows ?? result) as FeatureFlag[];
  },
  async set(key: string, enabled: boolean, rolloutPercent: number, description: string | null, updatedBy: string): Promise<void> {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const pct = Math.max(0, Math.min(100, Math.round(rolloutPercent)));
    await db.execute(sql`
      INSERT INTO feature_flags ("key", "enabled", "rolloutPercent", "description", "updatedBy", "createdAt", "updatedAt")
      VALUES (${key}, ${enabled}, ${pct}, ${description}, ${updatedBy}, NOW(), NOW())
      ON CONFLICT ("key") DO UPDATE SET
        "enabled" = EXCLUDED."enabled",
        "rolloutPercent" = EXCLUDED."rolloutPercent",
        "description" = EXCLUDED."description",
        "updatedBy" = EXCLUDED."updatedBy",
        "updatedAt" = NOW()
    `);
  },
  async remove(key: string): Promise<void> {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    await db.execute(sql`DELETE FROM feature_flags WHERE "key" = ${key}`);
  },
};

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next({ ctx });
});

export const featureFlagsRouter = router({
  /** Public check — pages gate themselves on this. Default-ON semantics. */
  check: publicProcedure
    .input(z.object({ key: z.string().min(1).max(128), userId: z.string().optional() }))
    .query(async ({ input, ctx }) => {
      const enabled = await flags.isEnabled(input.key, input.userId ?? ctx.user?.id);
      return { key: input.key, enabled };
    }),

  list: adminProcedure.query(async () => flags.list()),

  set: adminProcedure
    .input(z.object({
      key: z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/i, "Flag keys: alphanumeric plus . _ -"),
      enabled: z.boolean(),
      rolloutPercent: z.number().int().min(0).max(100).default(100),
      description: z.string().max(500).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await flags.set(input.key, input.enabled, input.rolloutPercent, input.description ?? null, ctx.user.id);
      return { success: true };
    }),

  remove: adminProcedure
    .input(z.object({ key: z.string().min(1).max(128) }))
    .mutation(async ({ input }) => {
      await flags.remove(input.key);
      return { success: true };
    }),
});
