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
import { and, eq } from "drizzle-orm";
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
});

export type PushSubscriptionsRouter = typeof pushSubscriptionsRouter;
