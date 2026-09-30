/**
 * server/routers/submitter-billing.ts
 *
 * Phase 18: submitter billing. Generates per-client invoices FROM platform
 * determination outcomes:
 *   - billingModel "contingency": charge = contingencyPct% of the award
 *     (disputes.determinationAmount) for disputes WON by the initiating party
 *     (the submitter's client side) in the invoice period;
 *   - billingModel "flat": flatFeeUsd per DETERMINED dispute in the period.
 *
 * Honest totals: every invoice line names the dispute, the award it was
 * computed from, and the charge; invoice computation notes snapshot the
 * model/rate inputs. Disputes without a determination are NEVER billed.
 *
 * NO PAYMENT PROCESSING: this module manages the invoice lifecycle only
 * (draft → sent → paid, or void). "paid" is recorded manually by the
 * submitter; nothing here charges a card, initiates ACH, or integrates a
 * payment processor. Payment collection is out of scope and out of system.
 *
 * AuthZ: owner/staff of the submitter org (viewer read-only).
 * Registered via rootRouter merge in server/app-router.ts.
 */
import crypto from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { createAuditEntry } from "../db";
import { disputes } from "../../drizzle/schema";
import { organizations, orgMemberships } from "../../drizzle/schema-personas";
import {
  submitterClients,
  submitterInvoices,
  submitterInvoiceLines,
} from "../../drizzle/schema-submitter";
import { requireDb } from "../personas/guards";

type Db = Awaited<ReturnType<typeof requireDb>>;

async function assertOrgMember(db: Db, userId: string, orgId: string, roles: string[] = ["owner", "staff"]) {
  const rows = await db
    .select()
    .from(orgMemberships)
    .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)))
    .limit(1);
  const m = rows[0];
  if (!m || !roles.includes(m.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You are not an authorized member of this organization" });
  }
  const org = (await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1))[0];
  if (!org) throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
  if (org.status !== "active" && roles.includes("owner")) {
    throw new TRPCError({ code: "FORBIDDEN", message: `Organization "${org.name}" is ${org.status}; mutations blocked` });
  }
  return { membership: m, org };
}

async function loadClientLink(db: Db, submitterClientId: string) {
  const rows = await db.select().from(submitterClients).where(eq(submitterClients.id, submitterClientId)).limit(1);
  const link = rows[0];
  if (!link) throw new TRPCError({ code: "NOT_FOUND", message: "Submitter client link not found" });
  return link;
}

async function loadInvoice(db: Db, invoiceId: string) {
  const rows = await db.select().from(submitterInvoices).where(eq(submitterInvoices.id, invoiceId)).limit(1);
  const inv = rows[0];
  if (!inv) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
  return inv;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export const submitterBillingRouter = router({
  /** Per-client billing configuration (billingModel + rate). */
  updateBillingConfig: protectedProcedure
    .input(z.object({
      submitterClientId: z.string().min(1),
      billingModel: z.enum(["flat", "contingency"]),
      /** Required when billingModel=contingency; percent of award (0–100). */
      contingencyPct: z.number().min(0).max(100).optional(),
      /** Required when billingModel=flat; USD per determined dispute. */
      flatFeeUsd: z.number().min(0).max(1_000_000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const link = await loadClientLink(db, input.submitterClientId);
      await assertOrgMember(db, ctx.user.id, link.submitterOrgId);
      if (input.billingModel === "contingency" && input.contingencyPct === undefined) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "contingencyPct is required for the contingency billing model" });
      }
      if (input.billingModel === "flat" && input.flatFeeUsd === undefined) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "flatFeeUsd is required for the flat billing model" });
      }
      await db.update(submitterClients).set({
        billingModel: input.billingModel,
        contingencyPct: input.contingencyPct !== undefined ? String(input.contingencyPct) : null,
        flatFeeUsd: input.flatFeeUsd !== undefined ? String(input.flatFeeUsd) : null,
        updatedAt: new Date(),
      }).where(eq(submitterClients.id, link.id));
      await createAuditEntry({
        userId: ctx.user.id,
        action: "submitterBilling.updateBillingConfig",
        entityType: "submitter_client",
        entityId: link.id,
        oldValue: JSON.stringify({ billingModel: link.billingModel, contingencyPct: link.contingencyPct, flatFeeUsd: link.flatFeeUsd }),
        newValue: JSON.stringify({ billingModel: input.billingModel, contingencyPct: input.contingencyPct ?? null, flatFeeUsd: input.flatFeeUsd ?? null }),
        ipAddress: null,
        userAgent: null,
      });
      return { submitterClientId: link.id, billingModel: input.billingModel };
    }),

  /**
   * Generate a DRAFT invoice from determination outcomes in the period.
   * Contingency: only disputes won by the initiating party contribute
   * (charge = pct × award). Flat: every determined dispute contributes
   * flatFeeUsd. Already-invoiced disputes (non-void invoices) are excluded.
   */
  generateInvoice: protectedProcedure
    .input(z.object({
      submitterClientId: z.string().min(1),
      periodStart: z.coerce.date(),
      periodEnd: z.coerce.date(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const link = await loadClientLink(db, input.submitterClientId);
      await assertOrgMember(db, ctx.user.id, link.submitterOrgId);
      if (input.periodEnd <= input.periodStart) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "periodEnd must be after periodStart" });
      }
      const model = link.billingModel === "contingency" ? "contingency" : "flat";
      const contingencyPct = link.contingencyPct !== null ? Number(link.contingencyPct) : null;
      const flatFeeUsd = link.flatFeeUsd !== null ? Number(link.flatFeeUsd) : null;
      if (model === "contingency" && (contingencyPct === null || !(contingencyPct >= 0))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Client billing model is contingency but contingencyPct is not configured" });
      }
      if (model === "flat" && (flatFeeUsd === null || !(flatFeeUsd >= 0))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Client billing model is flat but flatFeeUsd is not configured" });
      }

      // Determined disputes for this client in the period (determination
      // timestamp = updatedAt of the determination; closedAt when present).
      const determined = await db
        .select()
        .from(disputes)
        .where(and(
          eq(disputes.submitterClientId, link.id),
          sql`${disputes.determinationWinner} IS NOT NULL`,
          sql`COALESCE(${disputes.closedAt}, ${disputes.updatedAt}) >= ${input.periodStart.toISOString()}::timestamptz`,
          sql`COALESCE(${disputes.closedAt}, ${disputes.updatedAt}) < ${input.periodEnd.toISOString()}::timestamptz`,
        ));

      // Exclude disputes already billed on a non-void invoice.
      const already = determined.length
        ? await db.execute(sql`
            SELECT l."disputeId" FROM submitter_invoice_lines l
            JOIN submitter_invoices i ON i.id = l."invoiceId"
            WHERE i."submitterClientId" = ${link.id} AND i.status <> 'void'
          `)
        : { rows: [] as unknown[] };
      const billedIds = new Set(
        ((Array.isArray(already) ? already : (already as { rows?: unknown[] }).rows ?? []) as Array<Record<string, unknown>>)
          .map(r => String(r.disputeId))
      );

      const lines: Array<{ disputeId: string; referenceNumber: string | null; awardUsd: number | null; chargeUsd: number; description: string }> = [];
      const notes: string[] = [
        `Billing model: ${model}. Generated from platform determination data only; undetermined disputes are never billed.`,
        "No payment processing: this invoice is a record of charges; collection happens outside the platform.",
      ];
      for (const d of determined) {
        if (billedIds.has(d.id)) continue;
        const award = d.determinationAmount !== null ? Number(d.determinationAmount) : null;
        if (model === "contingency") {
          if (d.determinationWinner !== "initiating_party") continue; // lost disputes: no contingency fee
          if (award === null) continue;
          const charge = round2((contingencyPct! / 100) * award);
          lines.push({
            disputeId: d.id,
            referenceNumber: d.referenceNumber,
            awardUsd: award,
            chargeUsd: charge,
            description: `Contingency fee ${contingencyPct}% × $${award.toFixed(2)} award — ${d.referenceNumber}`,
          });
        } else {
          lines.push({
            disputeId: d.id,
            referenceNumber: d.referenceNumber,
            awardUsd: award,
            chargeUsd: round2(flatFeeUsd!),
            description: `Flat per-dispute fee — ${d.referenceNumber} (determined ${d.determinationWinner === "initiating_party" ? "won" : "lost"})`,
          });
        }
      }
      notes.push(
        model === "contingency"
          ? `Rate: ${contingencyPct}% of initiating-party awards; ${lines.length} won dispute(s) billed of ${determined.length} determined in period.`
          : `Rate: $${flatFeeUsd} per determined dispute; ${lines.length} dispute(s) billed of ${determined.length} determined in period.`
      );

      const total = round2(lines.reduce((s, l) => s + l.chargeUsd, 0));
      const invoiceId = crypto.randomUUID();
      const invoiceNumber = `INV-${input.periodEnd.toISOString().slice(0, 10)}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
      await db.insert(submitterInvoices).values({
        id: invoiceId,
        submitterClientId: link.id,
        invoiceNumber,
        billingModel: model,
        status: "draft",
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        totalUsd: String(total),
        lineCount: lines.length,
        computationNotes: notes,
        createdByUserId: ctx.user.id,
      });
      for (const l of lines) {
        await db.insert(submitterInvoiceLines).values({
          id: crypto.randomUUID(),
          invoiceId,
          disputeId: l.disputeId,
          referenceNumber: l.referenceNumber,
          awardUsd: l.awardUsd !== null ? String(l.awardUsd) : null,
          chargeUsd: String(l.chargeUsd),
          description: l.description,
        });
      }
      await createAuditEntry({
        userId: ctx.user.id,
        action: "submitterBilling.generateInvoice",
        entityType: "submitter_invoice",
        entityId: invoiceId,
        oldValue: null,
        newValue: JSON.stringify({ submitterClientId: link.id, invoiceNumber, billingModel: model, lineCount: lines.length, totalUsd: total }),
        ipAddress: null,
        userAgent: null,
      });
      return { invoiceId, invoiceNumber, status: "draft" as const, billingModel: model, lineCount: lines.length, totalUsd: total, notes };
    }),

  listInvoices: protectedProcedure
    .input(z.object({ submitterClientId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const link = await loadClientLink(db, input.submitterClientId);
      await assertOrgMember(db, ctx.user.id, link.submitterOrgId, ["owner", "staff", "viewer"]);
      return db.select().from(submitterInvoices).where(eq(submitterInvoices.submitterClientId, link.id));
    }),

  getInvoice: protectedProcedure
    .input(z.object({ invoiceId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const inv = await loadInvoice(db, input.invoiceId);
      const link = await loadClientLink(db, inv.submitterClientId);
      await assertOrgMember(db, ctx.user.id, link.submitterOrgId, ["owner", "staff", "viewer"]);
      const lines = await db.select().from(submitterInvoiceLines).where(eq(submitterInvoiceLines.invoiceId, inv.id));
      return { invoice: inv, lines };
    }),

  /** Lifecycle transitions: draft→sent, sent→paid, any-open→void. */
  updateInvoiceStatus: protectedProcedure
    .input(z.object({
      invoiceId: z.string().min(1),
      status: z.enum(["sent", "paid", "void"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const inv = await loadInvoice(db, input.invoiceId);
      const link = await loadClientLink(db, inv.submitterClientId);
      await assertOrgMember(db, ctx.user.id, link.submitterOrgId);
      const allowed: Record<string, string[]> = { draft: ["sent", "void"], sent: ["paid", "void"], paid: [], void: [] };
      if (!allowed[inv.status]?.includes(input.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid invoice transition ${inv.status} -> ${input.status}` });
      }
      const now = new Date();
      await db.update(submitterInvoices).set({
        status: input.status,
        issuedAt: input.status === "sent" ? now : inv.issuedAt,
        paidAt: input.status === "paid" ? now : inv.paidAt,
        voidedAt: input.status === "void" ? now : inv.voidedAt,
        updatedAt: now,
      }).where(eq(submitterInvoices.id, inv.id));
      await createAuditEntry({
        userId: ctx.user.id,
        action: "submitterBilling.updateInvoiceStatus",
        entityType: "submitter_invoice",
        entityId: inv.id,
        oldValue: JSON.stringify({ status: inv.status }),
        newValue: JSON.stringify({ status: input.status }),
        ipAddress: null,
        userAgent: null,
      });
      return { invoiceId: inv.id, status: input.status };
    }),
});

export type SubmitterBillingRouter = typeof submitterBillingRouter;
