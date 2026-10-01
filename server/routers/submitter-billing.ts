/**
 * server/routers/submitter-billing.ts
 *
 * Phase 18-BE: submitter invoicing. Third-party submitters bill their
 * provider clients for IDR work; invoices are computed FROM platform
 * determination data so the numbers are auditable and reproducible:
 *
 *  - flat model:        flatFeeUsd × determined disputes in the period
 *  - contingency model: contingencyPct% × Σ determinationAmount won
 *
 * Honesty constraints: generation is deterministic and re-derivable from
 * disputes.determinationWinner/determinationAmount; NO payment processing
 * exists here — the lifecycle is draft → sent → paid (or void), recorded
 * manually by the submitter ("paid" means money moved outside the platform).
 */
import { TRPCError } from "@trpc/server";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { createAuditEntry, getDb } from "../db";
import { disputes } from "../../drizzle/schema";
import { orgMemberships } from "../../drizzle/schema-personas";
import {
  submitterClients,
  submitterInvoiceLines,
  submitterInvoices,
} from "../../drizzle/schema-submitter";
import { protectedProcedure, router } from "../_core/trpc";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function requireDb(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
  return db;
}

async function assertOrgMember(
  db: Db, userId: string, orgId: string, roles: string[] = ["owner", "staff"]
): Promise<void> {
  const m = await db
    .select()
    .from(orgMemberships)
    .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)))
    .limit(1);
  if (m.length > 0 && (roles.includes(m[0].role) || m[0].role === "admin")) return;
  throw new TRPCError({ code: "FORBIDDEN", message: `Requires ${roles.join("/")} role on the organization` });
}

async function loadClientLink(db: Db, submitterClientId: string) {
  const rows = await db.select().from(submitterClients).where(eq(submitterClients.id, submitterClientId)).limit(1);
  if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Submitter client link not found" });
  return rows[0];
}

async function loadInvoice(db: Db, invoiceId: string) {
  const rows = await db.select().from(submitterInvoices).where(eq(submitterInvoices.id, invoiceId)).limit(1);
  if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
  return rows[0];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const submitterBillingRouter = router({
  updateBillingConfig: protectedProcedure
    .input(
      z.object({
        submitterClientId: z.string().min(1),
        billingModel: z.enum(["flat", "contingency"]),
        flatFeeUsd: z.number().nonnegative().optional(),
        contingencyPct: z.number().min(0).max(100).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const link = await loadClientLink(db, input.submitterClientId);
      await assertOrgMember(db, ctx.user.id, link.submitterOrgId);
      if (input.billingModel === "flat" && !(input.flatFeeUsd! > 0)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "flat model requires a positive flatFeeUsd" });
      }
      if (input.billingModel === "contingency" && !(input.contingencyPct! > 0)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "contingency model requires contingencyPct in (0,100]" });
      }
      await db
        .update(submitterClients)
        .set({
          billingModel: input.billingModel,
          flatFeeUsd: input.billingModel === "flat" ? String(input.flatFeeUsd) : link.flatFeeUsd,
          contingencyPct: input.billingModel === "contingency" ? String(input.contingencyPct) : link.contingencyPct,
          updatedAt: new Date(),
        })
        .where(eq(submitterClients.id, link.id));
      await createAuditEntry({
        userId: ctx.user.id,
        action: "submitterBilling.updateBillingConfig",
        entityType: "submitter_client",
        entityId: link.id,
        oldValue: JSON.stringify({ billingModel: link.billingModel, flatFeeUsd: link.flatFeeUsd, contingencyPct: link.contingencyPct }),
        newValue: JSON.stringify(input),
        ipAddress: null,
        userAgent: null,
      });
      return { submitterClientId: link.id, billingModel: input.billingModel };
    }),

  generateInvoice: protectedProcedure
    .input(
      z.object({
        submitterClientId: z.string().min(1),
        periodStart: z.coerce.date(),
        periodEnd: z.coerce.date(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const link = await loadClientLink(db, input.submitterClientId);
      await assertOrgMember(db, ctx.user.id, link.submitterOrgId);
      if (!(input.periodEnd > input.periodStart)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "periodEnd must be after periodStart" });
      }
      // Determined disputes attributable to this client org in the period.
      // Attribution: disputes.orgId = client org (provider org) when set,
      // else the submitter org (bulk-initiated drafts pre-acceptance land on
      // the submitter org — those are excluded until the client accepts).
      const clientOrgId = link.clientOrgId;
      const notes: string[] = [];
      const periodLabel = `${input.periodStart.toISOString().slice(0, 10)}..${input.periodEnd.toISOString().slice(0, 10)}`;
      let rows: Array<{ id: string; referenceNumber: string | null; determinationAmount: number | null }>;
      if (clientOrgId) {
        const res = await db.execute(sql`
          SELECT d.id, d."referenceNumber", d."determinationAmount"
          FROM disputes d
          WHERE d."orgId" = ${clientOrgId}
            AND d.status IN ('determined','settled')
            AND d."determinationWinner" IS NOT NULL
            AND d."determinationDate" >= ${input.periodStart}
            AND d."determinationDate" < ${input.periodEnd}
          ORDER BY d."referenceNumber"
        `);
        rows = (Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows ?? []) as typeof rows;
      } else {
        rows = [];
        notes.push("clientOrgId not set (invite not accepted) — invoice computed with zero lines; accept the invite first");
      }
      const invoiceNumber = `INV-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
      const invoiceId = crypto.randomUUID();
      let totalUsd = 0;
      const lineValues: Array<Record<string, unknown>> = [];
      for (const r of rows) {
        let charge = 0;
        let description: string;
        if (link.billingModel === "flat") {
          charge = Number(link.flatFeeUsd ?? 0);
          description = `Flat IDR service fee — dispute ${r.referenceNumber ?? r.id}`;
        } else {
          const award = Number(r.determinationAmount ?? 0);
          charge = round2((award * Number(link.contingencyPct ?? 0)) / 100);
          description = `Contingency ${link.contingencyPct}% of award — dispute ${r.referenceNumber ?? r.id}`;
        }
        totalUsd = round2(totalUsd + charge);
        lineValues.push({
          id: crypto.randomUUID(),
          invoiceId,
          disputeId: r.id,
          referenceNumber: r.referenceNumber,
          awardUsd: r.determinationAmount != null ? String(r.determinationAmount) : null,
          chargeUsd: String(charge),
          description,
        });
      }
      notes.push(`model=${link.billingModel}; determined disputes in ${periodLabel}: ${rows.length}`);
      await db.insert(submitterInvoices).values({
        id: invoiceId,
        submitterClientId: link.id,
        invoiceNumber,
        billingModel: link.billingModel,
        status: "draft",
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        totalUsd: String(totalUsd),
        lineCount: lineValues.length,
        computationNotes: notes,
        createdByUserId: ctx.user.id,
      });
      if (lineValues.length) {
        await db.insert(submitterInvoiceLines).values(lineValues as never[]);
      }
      await createAuditEntry({
        userId: ctx.user.id,
        action: "submitterBilling.generateInvoice",
        entityType: "submitter_invoice",
        entityId: invoiceId,
        oldValue: null,
        newValue: JSON.stringify({ submitterClientId: link.id, invoiceNumber, totalUsd, lineCount: lineValues.length, periodLabel }),
        ipAddress: null,
        userAgent: null,
      });
      return { invoiceId, invoiceNumber, totalUsd, lineCount: lineValues.length, notes };
    }),

  updateInvoiceStatus: protectedProcedure
    .input(
      z.object({
        invoiceId: z.string().min(1),
        status: z.enum(["sent", "paid", "void"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const inv = await loadInvoice(db, input.invoiceId);
      const link = await loadClientLink(db, inv.submitterClientId);
      await assertOrgMember(db, ctx.user.id, link.submitterOrgId);
      const allowed: Record<string, string[]> = {
        draft: ["sent", "void"],
        sent: ["paid", "void"],
        paid: [],
        void: [],
      };
      if (!allowed[inv.status]?.includes(input.status)) {
        throw new TRPCError({ code: "CONFLICT", message: `Invoice is ${inv.status}; cannot transition to ${input.status}` });
      }
      await db
        .update(submitterInvoices)
        .set({
          status: input.status,
          issuedAt: input.status === "sent" ? new Date() : inv.issuedAt,
          paidAt: input.status === "paid" ? new Date() : inv.paidAt,
          voidedAt: input.status === "void" ? new Date() : inv.voidedAt,
          updatedAt: new Date(),
        })
        .where(eq(submitterInvoices.id, inv.id));
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

  voidInvoice: protectedProcedure
    .input(z.object({ invoiceId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const inv = await loadInvoice(db, input.invoiceId);
      const link = await loadClientLink(db, inv.submitterClientId);
      await assertOrgMember(db, ctx.user.id, link.submitterOrgId);
      if (inv.status === "paid" || inv.status === "void") {
        throw new TRPCError({ code: "CONFLICT", message: `Invoice is ${inv.status}; cannot void` });
      }
      await db
        .update(submitterInvoices)
        .set({ status: "void", voidedAt: new Date(), updatedAt: new Date() })
        .where(eq(submitterInvoices.id, inv.id));
      await createAuditEntry({
        userId: ctx.user.id,
        action: "submitterBilling.voidInvoice",
        entityType: "submitter_invoice",
        entityId: inv.id,
        oldValue: JSON.stringify({ status: inv.status }),
        newValue: JSON.stringify({ status: "void" }),
        ipAddress: null,
        userAgent: null,
      });
      return { invoiceId: inv.id, status: "void" };
    }),

  // ── Stripe collection (Phase 20-C) ─────────────────────────────────────────
  // Stripe Checkout Sessions (card + us_bank_account ACH) as an ADDITIONAL
  // collection rail over this router's invoice lifecycle. Fee policy
  // (user-locked): the platform ABSORBS Stripe processing fees, ACH is the
  // preferred rail, and there is NO surcharge/pass-through flag anywhere.
  // updateInvoiceStatus is deliberately NOT modified: manual 'paid'
  // (external collection) remains legal even in configured mode; the audit
  // trail distinguishes the path (submitterBilling.updateInvoiceStatus vs
  // submitterBilling.stripeWebhook.paid). MOCK-VERIFIED only — live Stripe
  // collection is STATIC-ONLY (no live keys in any environment).
  createInvoicePaymentLink: protectedProcedure
    .input(z.object({ invoiceId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const inv = await loadInvoice(db, input.invoiceId);
      const link = await loadClientLink(db, inv.submitterClientId);
      await assertOrgMember(db, ctx.user.id, link.submitterOrgId);
      if (inv.status === "draft") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invoice is still draft — call updateInvoiceStatus(sent) before creating a payment link" });
      }
      if (inv.status !== "sent") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Invoice is ${inv.status}; payment links can only be created for sent invoices` });
      }
      const { getStripeClient, StripeBillingUnavailableError } = await import("../billing/stripe");
      const stripe = getStripeClient();
      if (stripe.mode === "disabled") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Stripe billing is DISABLED — STRIPE_* env not configured; this invoice remains externally collected (mark paid manually via updateInvoiceStatus)",
        });
      }
      // Reuse an existing open session — never create duplicate payment pages.
      if (inv.stripeSessionId) {
        try {
          const existing = await stripe.retrieveSession(inv.stripeSessionId);
          if (existing.status === "open") {
            return {
              url: existing.url,
              sessionId: existing.id,
              stripeStatus: "unpaid" as const,
              reused: true,
            };
          }
        } catch (err) {
          if (!(err instanceof StripeBillingUnavailableError)) throw err;
          // Transport failure on refresh → treat as expired and create new.
        }
      }
      const amountCents = Math.round(Number(inv.totalUsd) * 100);
      const base = process.env.STRIPE_CHECKOUT_RETURN_BASE_URL?.trim() || "https://app.localhost/billing";
      const session = await stripe.createInvoicePaymentSession({
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        amountCents,
        clientLabel: link.label,
        successUrl: `${base}/invoices/${inv.id}?paid=1`,
        cancelUrl: `${base}/invoices/${inv.id}?canceled=1`,
      });
      await db.update(submitterInvoices).set({
        stripeSessionId: session.sessionId,
        stripeStatus: "unpaid",
        updatedAt: new Date(),
      }).where(eq(submitterInvoices.id, inv.id));
      await createAuditEntry({
        userId: ctx.user.id,
        action: "submitterBilling.createInvoicePaymentLink",
        entityType: "submitter_invoice",
        entityId: inv.id,
        oldValue: null,
        newValue: JSON.stringify({ stripeSessionId: session.sessionId, stripeStatus: "unpaid" }),
        ipAddress: null,
        userAgent: null,
      });
      return { url: session.url, sessionId: session.sessionId, stripeStatus: "unpaid" as const, reused: false };
    }),

  getInvoicePaymentStatus: protectedProcedure
    .input(z.object({ invoiceId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const inv = await loadInvoice(db, input.invoiceId);
      const link = await loadClientLink(db, inv.submitterClientId);
      await assertOrgMember(db, ctx.user.id, link.submitterOrgId, ["owner", "staff", "viewer"]);
      const { getStripeClient } = await import("../billing/stripe");
      const stripe = getStripeClient();
      let stripeStatus = inv.stripeStatus;
      // Refresh from Stripe for a sent+unpaid invoice in configured mode.
      // paidAt is NEVER set from a refresh — paidAt is webhook-only.
      if (stripe.mode === "configured" && inv.status === "sent" && inv.stripeSessionId && inv.stripeStatus !== "paid") {
        try {
          const s = await stripe.retrieveSession(inv.stripeSessionId);
          const refreshed = s.status === "expired" ? "expired" : s.paymentStatus === "paid" ? "paid" : "unpaid";
          if (refreshed !== inv.stripeStatus) {
            await db.update(submitterInvoices).set({ stripeStatus: refreshed, updatedAt: new Date() })
              .where(eq(submitterInvoices.id, inv.id));
            await createAuditEntry({
              userId: ctx.user.id,
              action: "submitterBilling.paymentStatusRefresh",
              entityType: "submitter_invoice",
              entityId: inv.id,
              oldValue: JSON.stringify({ stripeStatus: inv.stripeStatus }),
              newValue: JSON.stringify({ stripeStatus: refreshed, note: "refresh never sets paidAt (webhook-only)" }),
              ipAddress: null,
              userAgent: null,
            });
            stripeStatus = refreshed;
          }
        } catch {
          // Transport failure on refresh: report the stored state honestly.
        }
      }
      return {
        stripeEnabled: stripe.mode === "configured",
        stripeStatus,
        stripeSessionId: inv.stripeSessionId,
        paidAt: inv.paidAt,
        manualCollection: stripe.mode !== "configured",
      };
    }),

  listInvoicePayments: protectedProcedure
    .input(z.object({ submitterClientId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const link = await loadClientLink(db, input.submitterClientId);
      await assertOrgMember(db, ctx.user.id, link.submitterOrgId, ["owner", "staff", "viewer"]);
      const rows = await db.select().from(submitterInvoices).where(eq(submitterInvoices.submitterClientId, link.id));
      return rows.map(i => ({
        invoiceId: i.id,
        invoiceNumber: i.invoiceNumber,
        status: i.status,
        totalUsd: i.totalUsd,
        stripeStatus: i.stripeStatus,
        stripeSessionId: i.stripeSessionId,
        paidAt: i.paidAt,
        issuedAt: i.issuedAt,
      }));
    }),
});
