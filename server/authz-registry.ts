/**
 * server/authz-registry.ts
 *
 * Central object-level authorization registry for the tRPC API.
 *
 * server/routers.ts is too large to patch procedure-by-procedure through the
 * GitHub API, so object-level authorization (IDOR protection) is enforced by a
 * middleware in server/_core/trpc.ts that runs AFTER authentication and looks
 * up the called procedure path in this registry.
 *
 * Design:
 *   - Each entry maps a procedure path (e.g. "disputes.rejectOffer") to a
 *     checker receiving (ctx, rawInput). Checkers call the helpers in
 *     server/authz.ts (assertDisputeAccess / assertAdminAccess) or perform
 *     direct ownership resolution against the database.
 *   - Paths ending in "*" are treated as prefixes (longest prefix wins).
 *   - Unmapped protected paths DEFAULT-ALLOW (reference data, self-scoped
 *     procedures) but emit a once-per-path audit log line so coverage gaps
 *     are observable in production logs.
 *   - FAIL CLOSED: checkers throw TRPCError (FORBIDDEN / NOT_FOUND); a
 *     database outage during a check denies the request; any unexpected
 *     checker error is wrapped into FORBIDDEN by enforcePathAuthz().
 *
 * Checkers run BEFORE zod input validation (tRPC middleware order), so a
 * missing/malformed resource id is skipped here and rejected downstream by
 * the procedure's own input schema (BAD_REQUEST) — the checker always sees
 * the same rawInput the schema validates, so no valid request can slip past.
 */

import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import {
  disputeDocuments,
  disputeComments,
  disputeEscalations,
  disputeNarratives,
  documentExpiryAlerts,
  documentAnalyses,
  emrConnections,
  notifications,
  webhooks,
  payerContacts,
  smartTokens,
  bulkFhirExportJobs,
  cdsHooks,
} from "../drizzle/schema";
import { assertDisputeAccess, type AuthzPermission } from "./authz";

// ── Types ────────────────────────────────────────────────────────────────────

export interface AuthzRequestUser {
  id: string;
  role: "user" | "admin";
}

export interface AuthzRequestContext {
  user: AuthzRequestUser;
}

export type AuthzChecker = (ctx: AuthzRequestContext, rawInput: unknown) => Promise<void>;

// ── Small utilities ──────────────────────────────────────────────────────────

function asRecord(raw: unknown): Record<string, unknown> {
  return raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

/** Extract a string field from raw input; undefined when absent/malformed (zod rejects later). */
function strField(raw: unknown, key: string): string | undefined {
  const v = asRecord(raw)[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function strArrayField(raw: unknown, key: string): string[] {
  const v = asRecord(raw)[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.length > 0);
}

function forbidden(message: string): TRPCError {
  return new TRPCError({ code: "FORBIDDEN", message });
}

function isAdmin(ctx: AuthzRequestContext): boolean {
  return ctx.user.role === "admin";
}

/** Owner-or-admin check on a resolved row's owner column. */
function assertOwnerOrAdmin(ctx: AuthzRequestContext, ownerId: string | null | undefined, resource: string): void {
  if (isAdmin(ctx)) return;
  if (!ownerId || ownerId !== ctx.user.id) {
    throw forbidden(`You do not own this ${resource}`);
  }
}

/**
 * Fetch a single row by primary id for ownership/dispute resolution.
 * FAIL CLOSED: when the database is unavailable the check cannot be
 * performed, so the request is denied with FORBIDDEN.
 */
async function findById<T extends Record<string, unknown>>(
  table: any,
  idColumn: any,
  id: string,
  resource: string
): Promise<T | null> {
  const db = await getDb();
  if (!db) {
    throw forbidden(`Cannot verify ${resource} access: authorization store unavailable`);
  }
  const rows = await db.select().from(table).where(eq(idColumn, id)).limit(1);
  return (rows[0] as T) ?? null;
}

async function assertDispute(
  ctx: AuthzRequestContext,
  disputeId: string,
  permission: AuthzPermission
): Promise<void> {
  await assertDisputeAccess(ctx.user.id, ctx.user.role, disputeId, permission);
}

// ── Checker factories ────────────────────────────────────────────────────────

/** Require `permission` on the dispute referenced by input[key]. */
function disputeCheck(key: string, permission: AuthzPermission, opts?: { optional?: boolean }): AuthzChecker {
  return async (ctx, raw) => {
    const id = strField(raw, key);
    if (!id) return; // missing/malformed → the zod schema rejects with BAD_REQUEST
    await assertDispute(ctx, id, permission);
  };
}

/** Require dispute read access when input[key] is present; deny non-admins when absent. */
function disputeCheckOrAdminOnlyList(key: string): AuthzChecker {
  return async (ctx, raw) => {
    const id = strField(raw, key);
    if (id) {
      await assertDispute(ctx, id, "read");
      return;
    }
    // Unscoped listing would leak every tenant's rows; the in-procedure
    // scoping fix cannot land via the GitHub API (routers.ts exceeds the
    // push limit), so fail closed for non-admins until it does.
    if (!isAdmin(ctx)) {
      throw forbidden(`A ${key} filter is required to list these records`);
    }
  };
}

/** Require ownership (or admin) of the EMR connection referenced by input[key]. */
function emrConnectionCheck(key: string): AuthzChecker {
  return async (ctx, raw) => {
    const connectionId = strField(raw, key);
    if (!connectionId) return;
    const conn = await findById<{ createdBy: string }>(emrConnections, emrConnections.id, connectionId, "EMR connection");
    if (!conn) return; // procedure handles the not-found case; nothing is leaked
    assertOwnerOrAdmin(ctx, conn.createdBy, "EMR connection");
  };
}

/** Resolve a row by input[key], then require dispute access on its disputeId column. */
function nestedDisputeCheck(
  table: any,
  idColumn: any,
  key: string,
  permission: AuthzPermission,
  resource: string
): AuthzChecker {
  return async (ctx, raw) => {
    const id = strField(raw, key);
    if (!id) return;
    const row = await findById<{ disputeId: string }>(table, idColumn, id, resource);
    if (!row) return; // non-existent resource → procedure NOT_FOUNDs; no data exposed
    await assertDispute(ctx, row.disputeId, permission);
  };
}

/** Resolve a row by input[key], then require ownership of its owner column. */
function nestedOwnerCheck(
  table: any,
  idColumn: any,
  key: string,
  ownerColumn: string,
  resource: string
): AuthzChecker {
  return async (ctx, raw) => {
    const id = strField(raw, key);
    if (!id) return;
    const row = await findById<Record<string, unknown>>(table, idColumn, id, resource);
    if (!row) return;
    assertOwnerOrAdmin(ctx, row[ownerColumn] as string | null, resource);
  };
}

/** Admin-only gate (used to fail closed on cross-tenant exports). */
function adminOnlyCheck(action: string): AuthzChecker {
  return async (ctx) => {
    if (!isAdmin(ctx)) {
      throw forbidden(`Admin role required to ${action}`);
    }
  };
}

/** Require dispute write access on every id in an input array (bulk operations). */
function bulkDisputeCheck(key: string, permission: AuthzPermission): AuthzChecker {
  return async (ctx, raw) => {
    for (const id of strArrayField(raw, key)) {
      await assertDispute(ctx, id, permission);
    }
  };
}

function allOf(...checkers: AuthzChecker[]): AuthzChecker {
  return async (ctx, raw) => {
    for (const c of checkers) await c(ctx, raw);
  };
}

// ── The registry ─────────────────────────────────────────────────────────────

export const authzCheckers: Record<string, AuthzChecker> = {
  // ── Disputes (mutations not protected in-procedure) ──────────────────────
  "disputes.findDuplicates": disputeCheck("disputeId", "read"),
  "disputes.rejectOffer": disputeCheck("disputeId", "write"),
  "disputes.sendNotification": disputeCheck("disputeId", "read"),
  "disputes.clone": disputeCheck("disputeId", "read"),
  "disputes.merge": allOf(
    disputeCheck("primaryDisputeId", "write"),
    disputeCheck("secondaryDisputeId", "write")
  ),

  // ── Documents (inherit dispute-level access) ─────────────────────────────
  "documents.upload": disputeCheck("disputeId", "write"),
  "documents.list": disputeCheck("disputeId", "read"),
  "documents.listVersions": nestedDisputeCheck(disputeDocuments, disputeDocuments.id, "documentId", "read", "document"),
  "documents.uploadVersion": async (ctx, raw) => {
    const documentId = strField(raw, "documentId");
    const disputeId = strField(raw, "disputeId");
    if (documentId) {
      const doc = await findById<{ disputeId: string }>(disputeDocuments, disputeDocuments.id, documentId, "document");
      if (doc && disputeId && doc.disputeId !== disputeId) {
        // Version must attach to the dispute that owns the parent document.
        throw forbidden("Document does not belong to this dispute");
      }
    }
    if (disputeId) await assertDispute(ctx, disputeId, "write");
  },

  // ── AI procedures that read dispute context or EMR connections (PHI) ─────
  "ai.analyzeDocument": disputeCheck("disputeId", "read", { optional: true }),
  "ai.generateCMSSubmission": disputeCheck("disputeId", "read"),
  "ai.askAssistant": disputeCheck("disputeId", "read", { optional: true }),
  "ai.pullDisputeData": emrConnectionCheck("connectionId"),
  "ai.searchPatients": emrConnectionCheck("connectionId"),

  // ── Dispute-linked analysis / compliance reads ───────────────────────────
  "stateLaws.checkCompliance": disputeCheck("disputeId", "read"),
  "expertReview.request": disputeCheck("disputeId", "write"),
  "expertReview.getAnalysis": disputeCheck("disputeId", "read"),
  "predictions.get": disputeCheck("disputeId", "read"),
  "predictions.generate": disputeCheck("disputeId", "write"),
  "uscdi.getCompleteness": disputeCheck("disputeId", "read"),
  "uscdi.updateCompleteness": disputeCheck("disputeId", "write"),
  "compliance.list": disputeCheck("disputeId", "read"),
  "compliance.upsert": disputeCheck("disputeId", "write"),
  "compliance.reset": disputeCheck("disputeId", "write"),

  // ── Document intelligence (extracted PHI) ────────────────────────────────
  "docIntelligence.analyze": disputeCheck("disputeId", "read", { optional: true }),
  "docIntelligence.get": nestedOwnerCheck(documentAnalyses, documentAnalyses.id, "id", "userId", "document analysis"),
  "docIntelligence.getDownloadUrl": nestedOwnerCheck(documentAnalyses, documentAnalyses.id, "id", "userId", "document analysis"),

  // ── Case notes / comments ────────────────────────────────────────────────
  "comments.list": disputeCheck("disputeId", "read"),
  "comments.add": disputeCheck("disputeId", "write"),
  "comments.replies": nestedDisputeCheck(disputeComments, disputeComments.id, "parentId", "read", "comment"),
  "comments.summarize": disputeCheck("disputeId", "read"),

  // ── Payer contact book (creator-owned) ───────────────────────────────────
  "payerContacts.update": nestedOwnerCheck(payerContacts, payerContacts.id, "id", "createdBy", "payer contact"),
  "payerContacts.delete": nestedOwnerCheck(payerContacts, payerContacts.id, "id", "createdBy", "payer contact"),

  // ── SLA monitoring ───────────────────────────────────────────────────────
  "sla.breaches": disputeCheckOrAdminOnlyList("disputeId"),
  "sla.check": disputeCheck("disputeId", "read"),

  // ── Bulk dispute operations ──────────────────────────────────────────────
  "bulkActions.changeStatus": bulkDisputeCheck("ids", "write"),
  "bulkActions.addNote": bulkDisputeCheck("ids", "write"),

  // ── Watchlist / escalations / appeals / narratives / doc expiry ──────────
  "watchlist.add": disputeCheck("disputeId", "read"),
  "watchlist.remove": disputeCheck("disputeId", "read"),
  "watchlist.isWatching": disputeCheck("disputeId", "read"),
  "escalations.list": disputeCheck("disputeId", "read", { optional: true }),
  "escalations.create": disputeCheck("disputeId", "read"),
  "escalations.resolve": nestedDisputeCheck(disputeEscalations, disputeEscalations.id, "id", "write", "escalation"),
  "appeals.list": disputeCheck("disputeId", "read", { optional: true }),
  "appeals.create": disputeCheck("disputeId", "write"),
  "narratives.list": disputeCheck("disputeId", "read"),
  "narratives.generate": disputeCheck("disputeId", "write"),
  "narratives.approve": nestedDisputeCheck(disputeNarratives, disputeNarratives.id, "id", "write", "narrative"),
  "narratives.delete": nestedDisputeCheck(disputeNarratives, disputeNarratives.id, "id", "write", "narrative"),
  "docExpiry.list": disputeCheckOrAdminOnlyList("disputeId"),
  "docExpiry.add": disputeCheck("disputeId", "write"),
  "docExpiry.dismiss": nestedDisputeCheck(documentExpiryAlerts, documentExpiryAlerts.id, "id", "write", "document expiry alert"),

  // ── SMART/FHIR integrations (connection-owner scoped PHI) ────────────────
  "fhirCapability.fetch": emrConnectionCheck("emrConnectionId"),
  "fhirCapability.list": emrConnectionCheck("emrConnectionId"),
  "smartAuth.listTokens": emrConnectionCheck("emrConnectionId"),
  "smartAuth.revokeToken": nestedOwnerCheck(smartTokens, smartTokens.id, "tokenId", "userId", "SMART token"),
  "bulkFhir.startExport": emrConnectionCheck("emrConnectionId"),
  "bulkFhir.cancelJob": nestedOwnerCheck(bulkFhirExportJobs, bulkFhirExportJobs.id, "jobId", "initiatedBy", "bulk export job"),
  "cdsHooksRouter.list": emrConnectionCheck("emrConnectionId"),
  "cdsHooksRouter.register": emrConnectionCheck("emrConnectionId"),
  "cdsHooksRouter.toggleStatus": async (ctx, raw) => {
    const id = strField(raw, "id");
    if (!id) return;
    const hook = await findById<{ emrConnectionId: string }>(cdsHooks, cdsHooks.id, id, "CDS hook");
    if (!hook) return;
    const conn = await findById<{ createdBy: string }>(emrConnections, emrConnections.id, hook.emrConnectionId, "EMR connection");
    if (!conn) return;
    assertOwnerOrAdmin(ctx, conn.createdBy, "EMR connection");
  },
  "daVinci.list": disputeCheckOrAdminOnlyList("disputeId"),
  "daVinci.submitPAS": allOf(
    disputeCheck("disputeId", "write", { optional: true }),
    emrConnectionCheck("emrConnectionId")
  ),
  "fhirCache.list": async (ctx, raw) => {
    const disputeId = strField(raw, "disputeId");
    const connectionId = strField(raw, "emrConnectionId");
    if (isAdmin(ctx)) return;
    if (disputeId) {
      await assertDispute(ctx, disputeId, "read");
      return;
    }
    if (connectionId) {
      const conn = await findById<{ createdBy: string }>(emrConnections, emrConnections.id, connectionId, "EMR connection");
      if (conn) assertOwnerOrAdmin(ctx, conn.createdBy, "EMR connection");
      return;
    }
    // Raw cached FHIR resources (PHI) — an unscoped query would dump every
    // tenant's cache, so fail closed for non-admins.
    throw forbidden("A disputeId or emrConnectionId filter is required");
  },
  "fhirCache.purge": emrConnectionCheck("emrConnectionId"),
  "smartForm.extract": disputeCheck("disputeId", "read", { optional: true }),

  // ── Notifications (object-level ownership) ───────────────────────────────
  "notifications.markRead": nestedOwnerCheck(notifications, notifications.id, "id", "userId", "notification"),

  // ── Webhooks (object-level ownership; db helpers also scope when given userId) ──
  "webhooks.update": nestedOwnerCheck(webhooks, webhooks.id, "id", "userId", "webhook"),
  "webhooks.delete": nestedOwnerCheck(webhooks, webhooks.id, "id", "userId", "webhook"),
  "webhooks.test": nestedOwnerCheck(webhooks, webhooks.id, "id", "userId", "webhook"),

  // ── Tenant-wide exports (PHI + financials) ────────────────────────────────
  // reports.exportCSV/exportPDF read the FULL disputes table with no tenant
  // filter in-procedure, and the input carries no resource id to check. The
  // correct fix (scope to the caller's disputes) requires editing
  // server/routers.ts, which exceeds the API push limit. Fail closed:
  // admin-only until the in-body scoping lands.
  "reports.exportCSV": adminOnlyCheck("export tenant-wide reports"),
  "reports.exportPDF": adminOnlyCheck("export tenant-wide reports"),
};

// ── Enforcement entry point (called from the tRPC middleware) ────────────────

const auditedPaths = new Set<string>();

/** Test hook: reset the once-per-path audit log dedup set. */
export function resetAuthzAuditLog(): void {
  auditedPaths.clear();
}

function lookupChecker(path: string): AuthzChecker | undefined {
  const exact = authzCheckers[path];
  if (exact) return exact;
  let best: AuthzChecker | undefined;
  let bestLen = -1;
  for (const key of Object.keys(authzCheckers)) {
    if (key.endsWith("*") && path.startsWith(key.slice(0, -1)) && key.length > bestLen) {
      best = authzCheckers[key];
      bestLen = key.length;
    }
  }
  return best;
}

/**
 * Enforce object-level authorization for a protected procedure call.
 *
 * - Mapped path: run the checker. TRPCError propagates (FORBIDDEN/NOT_FOUND);
 *   any other error is logged and converted to FORBIDDEN (fail closed).
 * - Unmapped path: default-allow (reference data, self-scoped procedures) and
 *   emit a once-per-path audit line so uncovered surface is observable.
 */
export async function enforcePathAuthz(
  path: string,
  ctx: AuthzRequestContext,
  rawInput: unknown
): Promise<void> {
  const checker = lookupChecker(path);
  if (!checker) {
    if (!auditedPaths.has(path)) {
      auditedPaths.add(path);
      console.warn(
        `[authz-registry] AUDIT: no object-level checker registered for protected path "${path}" — default-allow`
      );
    }
    return;
  }
  try {
    await checker(ctx, rawInput);
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    console.warn(`[authz-registry] checker for "${path}" threw unexpectedly; denying (fail closed):`, err);
    throw forbidden("Authorization check failed");
  }
}
