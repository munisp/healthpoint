/**
 * server/routers/idre-directory.ts
 *
 * Wave W5-1: admin CRUD over the IDR entity (IDRE) directory.
 * Merged into the app router at server/app-router.ts as `idreDirectory`.
 *
 * Fee-range columns (feeSingleUsd/feeBatchedUsd) arrive in migration
 * 0041_wave_w5.sql and are accessed via raw SQL because drizzle/schema.ts is
 * owned by another wave; everything else uses the drizzle table.
 *
 * decertify: sets isActive=false, writes an audit_log entry, and notifies
 * the initiating-party owner of every open dispute currently at entity
 * selection (STEP_06_IDR_ENTITY_SELECTION / STEP_07_IDR_ENTITY_SELECTED)
 * with this entity so re-selection can proceed.
 */
import crypto from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, inArray, sql } from "drizzle-orm";
import { getDb, createAuditEntry, createNotification } from "../db";
import { idrEntities, disputes } from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next({ ctx });
});

const entityInput = z.object({
  name: z.string().min(1).max(255),
  certificationNumber: z.string().min(1).max(64),
  states: z.array(z.string().length(2)).default([]),
  specialties: z.array(z.string()).default([]),
  certificationExpiry: z.coerce.date().optional(),
  feeSingleUsd: z.number().nonnegative().optional(),
  feeBatchedUsd: z.number().nonnegative().optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().max(20).optional(),
  website: z.string().url().max(512).optional(),
  maxConcurrentCases: z.number().int().positive().optional(),
  isActive: z.boolean().default(true),
});

async function setFeeColumns(id: string, feeSingleUsd?: number, feeBatchedUsd?: number) {
  if (feeSingleUsd === undefined && feeBatchedUsd === undefined) return;
  const db = await getDb();
  if (!db) return;
  await db.execute(sql`
    UPDATE idr_entities SET
      "feeSingleUsd" = COALESCE(${feeSingleUsd ?? null}::numeric, "feeSingleUsd"),
      "feeBatchedUsd" = COALESCE(${feeBatchedUsd ?? null}::numeric, "feeBatchedUsd")
    WHERE id = ${id}
  `);
}

export const idreDirectoryRouter = router({
  /** Directory listing (admin sees inactive entities too). */
  list: adminProcedure
    .input(z.object({ includeInactive: z.boolean().default(true) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const rows = input.includeInactive
        ? await db.select().from(idrEntities).orderBy(idrEntities.name)
        : await db.select().from(idrEntities).where(eq(idrEntities.isActive, true)).orderBy(idrEntities.name);
      const fees = await db.execute(sql`SELECT id, "feeSingleUsd", "feeBatchedUsd" FROM idr_entities`);
      const feeRows = ((fees as any).rows ?? fees) as { id: string; feeSingleUsd: string | null; feeBatchedUsd: string | null }[];
      const feeMap = new Map(feeRows.map(r => [r.id, r]));
      return rows.map(r => ({
        ...r,
        feeSingleUsd: feeMap.get(r.id)?.feeSingleUsd ?? null,
        feeBatchedUsd: feeMap.get(r.id)?.feeBatchedUsd ?? null,
      }));
    }),

  create: adminProcedure
    .input(entityInput)
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const dup = await db.select({ id: idrEntities.id }).from(idrEntities)
        .where(eq(idrEntities.certificationNumber, input.certificationNumber)).limit(1);
      if (dup.length) throw new TRPCError({ code: "CONFLICT", message: "Certification number already registered" });
      const id = crypto.randomUUID();
      await db.insert(idrEntities).values({
        id,
        name: input.name,
        certificationNumber: input.certificationNumber,
        states: input.states,
        specialties: input.specialties,
        certificationExpiry: input.certificationExpiry ?? null,
        contactEmail: input.contactEmail ?? null,
        contactPhone: input.contactPhone ?? null,
        website: input.website ?? null,
        maxConcurrentCases: input.maxConcurrentCases ?? 50,
        isActive: input.isActive,
      });
      await setFeeColumns(id, input.feeSingleUsd, input.feeBatchedUsd);
      await createAuditEntry({
        userId: ctx.user.id, action: "idre.create", entityType: "idr_entity", entityId: id,
        oldValue: null, newValue: JSON.stringify(input), ipAddress: null, userAgent: null,
      });
      return { id };
    }),

  update: adminProcedure
    .input(entityInput.partial().extend({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [existing] = await db.select().from(idrEntities).where(eq(idrEntities.id, input.id)).limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "IDR entity not found" });
      if (input.certificationNumber && input.certificationNumber !== existing.certificationNumber) {
        const dup = await db.select({ id: idrEntities.id }).from(idrEntities)
          .where(eq(idrEntities.certificationNumber, input.certificationNumber)).limit(1);
        if (dup.length) throw new TRPCError({ code: "CONFLICT", message: "Certification number already registered" });
      }
      const { id, feeSingleUsd, feeBatchedUsd, ...fields } = input;
      await db.update(idrEntities).set({
        ...(fields.name !== undefined ? { name: fields.name } : {}),
        ...(fields.certificationNumber !== undefined ? { certificationNumber: fields.certificationNumber } : {}),
        ...(fields.states !== undefined ? { states: fields.states } : {}),
        ...(fields.specialties !== undefined ? { specialties: fields.specialties } : {}),
        ...(fields.certificationExpiry !== undefined ? { certificationExpiry: fields.certificationExpiry } : {}),
        ...(fields.contactEmail !== undefined ? { contactEmail: fields.contactEmail } : {}),
        ...(fields.contactPhone !== undefined ? { contactPhone: fields.contactPhone } : {}),
        ...(fields.website !== undefined ? { website: fields.website } : {}),
        ...(fields.maxConcurrentCases !== undefined ? { maxConcurrentCases: fields.maxConcurrentCases } : {}),
        ...(fields.isActive !== undefined ? { isActive: fields.isActive } : {}),
      }).where(eq(idrEntities.id, id));
      await setFeeColumns(id, feeSingleUsd, feeBatchedUsd);
      await createAuditEntry({
        userId: ctx.user.id, action: "idre.update", entityType: "idr_entity", entityId: id,
        oldValue: JSON.stringify(existing), newValue: JSON.stringify(input), ipAddress: null, userAgent: null,
      });
      return { success: true };
    }),

  /**
   * Decertify: active=false + audit + re-selection notification to the owner
   * of every open dispute at entity selection with this entity.
   */
  decertify: adminProcedure
    .input(z.object({ id: z.string().min(1), reason: z.string().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [entity] = await db.select().from(idrEntities).where(eq(idrEntities.id, input.id)).limit(1);
      if (!entity) throw new TRPCError({ code: "NOT_FOUND", message: "IDR entity not found" });

      await db.update(idrEntities).set({ isActive: false }).where(eq(idrEntities.id, input.id));

      const affected = await db.select({
        id: disputes.id,
        referenceNumber: disputes.referenceNumber,
        initiatingPartyId: disputes.initiatingPartyId,
      }).from(disputes).where(and(
        eq(disputes.idrEntityId, input.id),
        inArray(disputes.currentStep, ["STEP_06_IDR_ENTITY_SELECTION", "STEP_07_IDR_ENTITY_SELECTED"]),
      ));

      for (const d of affected) {
        await createNotification({
          userId: d.initiatingPartyId,
          disputeId: d.id,
          notificationType: "system",
          title: `IDR entity decertified — re-selection required (${d.referenceNumber})`,
          message: `The certified IDR entity "${entity.name}" (${entity.certificationNumber ?? "no cert #"}) assigned to dispute ${d.referenceNumber} has been decertified (${input.reason}). Please select a new certified IDR entity to continue the federal IDR process.`,
          dueDate: null,
        } as any);
      }

      await createAuditEntry({
        userId: ctx.user.id, action: "idre.decertify", entityType: "idr_entity", entityId: input.id,
        oldValue: JSON.stringify({ isActive: entity.isActive }),
        newValue: JSON.stringify({ isActive: false, reason: input.reason, affectedDisputes: affected.map(d => d.id) }),
        ipAddress: null, userAgent: null,
      });

      return { success: true, notifiedDisputes: affected.length };
    }),
});
