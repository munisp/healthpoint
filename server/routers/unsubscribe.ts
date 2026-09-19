/**
 * server/routers/unsubscribe.ts
 *
 * W7-5: one-click unsubscribe for digest emails. Digest messages carry a
 * per-user, unguessable token (email_digest_preferences.unsubscribeToken,
 * migration 0043_wave_w7.sql — raw SQL because drizzle/schema.ts is
 * wave-owned). The /unsubscribe/:token page calls these public procedures;
 * no login is required (the token IS the credential, as with List-Unsubscribe
 * flows), and confirming sets digestFrequency='never', which the digest
 * scheduler already honors (server/scheduled/emailDigest.ts skips 'never').
 *
 * Registration: merged into rootRouter in server/app-router.ts.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { router, publicProcedure } from "../_core/trpc";
import { getDb } from "../db";

const tokenSchema = z.string().min(16).max(128);

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  return db;
}

async function findByToken(db: any, token: string) {
  const rows = await db.execute(sql`
    SELECT p.id, p."userId", p."digestFrequency", u.email
    FROM email_digest_preferences p
    JOIN users u ON u.id = p."userId"
    WHERE p."unsubscribeToken" = ${token}
    LIMIT 1
  `);
  return (((rows as any).rows ?? rows) as any[])[0] ?? null;
}

export const unsubscribeRouter = router({
  /**
   * Preview what an unsubscribe token controls. Deliberately returns NO
   * email address or user id — just the current state — so the link cannot
   * be used to enumerate accounts.
   */
  getInfo: publicProcedure
    .input(z.object({ token: tokenSchema }))
    .query(async ({ input }) => {
      const db = await requireDb();
      const row = await findByToken(db, input.token);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Invalid or expired unsubscribe link" });
      return {
        digestFrequency: row.digestFrequency as string,
        alreadyUnsubscribed: row.digestFrequency === "never",
      };
    }),

  /**
   * One-click confirm: disable ALL digest email for this preference row
   * (digestFrequency='never'). Idempotent.
   */
  confirm: publicProcedure
    .input(z.object({ token: tokenSchema }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const row = await findByToken(db, input.token);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Invalid or expired unsubscribe link" });
      await db.execute(sql`
        UPDATE email_digest_preferences
        SET "digestFrequency" = 'never', "updatedAt" = NOW()
        WHERE id = ${row.id}
      `);
      return { ok: true as const, digestFrequency: "never" as const };
    }),
});

export type UnsubscribeRouter = typeof unsubscribeRouter;
