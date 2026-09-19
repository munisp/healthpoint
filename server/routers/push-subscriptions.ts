/**
 * server/routers/push-subscriptions.ts
 * Web Push subscription plumbing: exposes the server's VAPID public key and
 * persists per-user browser push subscriptions (push_subscriptions table,
 * drizzle/schema-push.ts).
 *
 * REGISTRATION: merged into the root router in server/app-router.ts (NOT in
 * server/routers.ts, which is owned by another workstream).
 */

import crypto from "crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { pushSubscriptions } from "../../drizzle/schema-push";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  return db;
}

export const pushSubscriptionsRouter = router({
  /** VAPID public key for browser pushManager.subscribe; null when unconfigured. */
  getVapidPublicKey: publicProcedure.query(() => {
    const key = process.env.VAPID_PUBLIC_KEY ?? null;
    return { key: key && key.length > 0 ? key : null };
  }),

  /** Persist (upsert) a browser push subscription for the current user. */
  subscribe: protectedProcedure
    .input(
      z.object({
        subscription: z.object({
          endpoint: z.string().url().max(2000),
          keys: z.object({
            p256dh: z.string().min(1).max(512),
            auth: z.string().min(1).max(512),
          }),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const now = new Date();
      await db
        .insert(pushSubscriptions)
        .values({
          id: crypto.randomUUID(),
          userId: ctx.user.id,
          endpoint: input.subscription.endpoint,
          p256dh: input.subscription.keys.p256dh,
          auth: input.subscription.keys.auth,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [pushSubscriptions.userId, pushSubscriptions.endpoint],
          set: {
            p256dh: input.subscription.keys.p256dh,
            auth: input.subscription.keys.auth,
            updatedAt: now,
          },
        });
      return { ok: true as const };
    }),

  /** Remove a push subscription (matched by endpoint) for the current user. */
  unsubscribe: protectedProcedure
    .input(z.object({ endpoint: z.string().url().max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await db
        .delete(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.userId, ctx.user.id),
            eq(pushSubscriptions.endpoint, input.endpoint)
          )
        );
      return { ok: true as const };
    }),

  /**
   * W7-1 (mobile parity): persist an Expo push token for the React-Native
   * app. Web-push subscriptions need VAPID keys that Expo tokens do not
   * have, so tokens are stored in the expo_push_tokens table (migration
   * 0043_wave_w7.sql) via raw SQL (drizzle/schema.ts is wave-owned).
   * Idempotent per (userId, token).
   */
  registerExpoToken: protectedProcedure
    .input(
      z.object({
        token: z.string().min(10).max(512),
        platform: z.enum(["ios", "android", "web"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await db.execute(sql`
        INSERT INTO expo_push_tokens (id, "userId", token, platform, "createdAt", "updatedAt")
        VALUES (${crypto.randomUUID()}, ${ctx.user.id}, ${input.token}, ${input.platform ?? null}, NOW(), NOW())
        ON CONFLICT ("userId", token) DO UPDATE SET "updatedAt" = NOW(), platform = EXCLUDED.platform
      `);
      return { ok: true as const };
    }),

  /** Remove an Expo push token for the current user (e.g. on logout). */
  unregisterExpoToken: protectedProcedure
    .input(z.object({ token: z.string().min(1).max(512) }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await db.execute(sql`
        DELETE FROM expo_push_tokens WHERE "userId" = ${ctx.user.id} AND token = ${input.token}
      `);
      return { ok: true as const };
    }),
});

export type PushSubscriptionsRouter = typeof pushSubscriptionsRouter;
