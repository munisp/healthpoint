/**
 * server/routers/fee-schedules.ts
 *
 * Wave W5-4: admin CRUD over the DB-backed IDR administrative fee schedule
 * (table `fee_schedules`, migration 0041_wave_w5.sql). Merged into the app
 * router at server/app-router.ts as `feeSchedules`.
 */
import crypto from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { getDb, createAuditEntry } from "../db";
import { listFeeSchedules } from "../fee-schedule";
import { router, protectedProcedure } from "../_core/trpc";

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next({ ctx });
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date yyyy-mm-dd required");

export const feeSchedulesRouter = router({
  list: adminProcedure.query(async () => listFeeSchedules()),

  upsert: adminProcedure
    .input(z.object({
      id: z.string().optional(), // present → update
      effectiveYear: z.number().int().min(2020).max(2100),
      tier: z.enum(["single", "batched"]),
      effectiveFrom: isoDate,
      effectiveTo: isoDate.nullable().optional(),
      amountUsd: z.number().nonnegative(),
      citation: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      if (input.effectiveTo && input.effectiveTo <= input.effectiveFrom) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "effectiveTo must be after effectiveFrom" });
      }
      const id = input.id ?? `fee-${crypto.randomUUID()}`;
      await db.execute(sql`
        INSERT INTO fee_schedules (id, "effectiveYear", tier, "effectiveFrom", "effectiveTo", "amountUsd", citation, "updatedBy", "createdAt", "updatedAt")
        VALUES (${id}, ${input.effectiveYear}, ${input.tier}, ${input.effectiveFrom}, ${input.effectiveTo ?? null}, ${input.amountUsd}, ${input.citation ?? null}, ${ctx.user.id}, NOW(), NOW())
        ON CONFLICT (id) DO UPDATE SET
          "effectiveYear" = EXCLUDED."effectiveYear",
          tier = EXCLUDED.tier,
          "effectiveFrom" = EXCLUDED."effectiveFrom",
          "effectiveTo" = EXCLUDED."effectiveTo",
          "amountUsd" = EXCLUDED."amountUsd",
          citation = EXCLUDED.citation,
          "updatedBy" = EXCLUDED."updatedBy",
          "updatedAt" = NOW()
      `);
      await createAuditEntry({
        userId: ctx.user.id, action: input.id ? "fee_schedule.update" : "fee_schedule.create",
        entityType: "fee_schedule", entityId: id,
        oldValue: null, newValue: JSON.stringify(input), ipAddress: null, userAgent: null,
      });
      return { id };
    }),

  remove: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db.execute(sql`DELETE FROM fee_schedules WHERE id = ${input.id}`);
      await createAuditEntry({
        userId: ctx.user.id, action: "fee_schedule.delete", entityType: "fee_schedule", entityId: input.id,
        oldValue: null, newValue: null, ipAddress: null, userAgent: null,
      });
      return { success: true };
    }),
});
