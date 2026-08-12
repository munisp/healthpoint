/**
 * server/authz.ts
 * Permify-style Relationship-Based Access Control (ReBAC) authorization layer.
 *
 * In production this would call the Permify gRPC API. Here we implement the
 * same permission model in-process against PostgreSQL, providing a drop-in
 * interface that can be swapped for the Permify client without changing callers.
 *
 * Permission model:
 *   - admin: full access to all disputes, documents, and users
 *   - user: access only to disputes where they are the initiating party
 *           (disputes.initiatingPartyId === ctx.user.id)
 *           or where they have been explicitly granted access via dispute_access table
 *
 * Relations (Zanzibar-style):
 *   dispute#owner@user  — user who created the dispute
 *   dispute#viewer@user — user granted read access
 *   dispute#editor@user — user granted write access (e.g. payer reviewer)
 */

import { TRPCError } from "@trpc/server";
import { eq, or, and } from "drizzle-orm";
import { getDb } from "./db";
import { disputes, disputeAccess } from "../drizzle/schema";

// ── Types ────────────────────────────────────────────────────────────────────

export type AuthzPermission = "read" | "write" | "admin";

export interface AuthzSubject {
  id: string;
  role: "user" | "admin";
}

export interface AuthzContext {
  user: AuthzSubject;
}

// ── Core permission check ────────────────────────────────────────────────────

/**
 * Check if a user has the given permission on a dispute.
 * Returns true if allowed, false if denied.
 *
 * This is the core ReBAC check — equivalent to Permify's
 * `permify.check({ subject: user, permission, object: { type: "dispute", id } })`
 */
export async function canAccessDispute(
  userId: string,
  userRole: "user" | "admin",
  disputeId: string,
  permission: AuthzPermission
): Promise<boolean> {
  // Admins have full access
  if (userRole === "admin") return true;

  // For read/write: check ownership or explicit grant
  const db = await getDb();
  if (!db) return false;

  // Check if user is the owner (initiating party)
  const dispute = await db
    .select({ id: disputes.id, initiatingPartyId: disputes.initiatingPartyId })
    .from(disputes)
    .where(eq(disputes.id, disputeId))
    .limit(1);

  if (!dispute.length) return false;

  if (dispute[0].initiatingPartyId === userId) return true;

  // Check explicit access grants
  try {
    const access = await db
      .select({ permission: disputeAccess.permission })
      .from(disputeAccess)
      .where(
        and(
          eq(disputeAccess.disputeId, disputeId),
          eq(disputeAccess.userId, userId)
        )
      )
      .limit(1);

    if (!access.length) return false;

    const grantedPermission = access[0].permission as AuthzPermission;
    if (permission === "read") return true; // any grant allows read
    if (permission === "write") return grantedPermission === "write" || grantedPermission === "admin";
    if (permission === "admin") return grantedPermission === "admin";
  } catch {
    // dispute_access table may not exist yet — fall through to deny
  }

  return false;
}

/**
 * Assert that the user has the given permission on a dispute.
 * Throws a TRPC FORBIDDEN error if denied.
 */
export async function assertDisputeAccess(
  userId: string,
  userRole: "user" | "admin",
  disputeId: string,
  permission: AuthzPermission = "read"
): Promise<void> {
  const allowed = await canAccessDispute(userId, userRole, disputeId, permission);
  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `You do not have ${permission} access to dispute ${disputeId}`,
    });
  }
}

/**
 * Grant a user explicit access to a dispute.
 * Used when a payer reviewer is assigned to a dispute.
 */
export async function grantDisputeAccess(
  disputeId: string,
  userId: string,
  permission: AuthzPermission,
  grantedBy: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    await db.insert(disputeAccess).values({
      disputeId,
      userId,
      permission,
      grantedBy,
      grantedAt: new Date(),
    }).onConflictDoUpdate({
      target: [disputeAccess.disputeId, disputeAccess.userId],
      set: { permission, grantedBy, grantedAt: new Date() },
    });
  } catch (err) {
    console.warn("[Authz] grantDisputeAccess error:", err);
  }
}

/**
 * Revoke a user's explicit access to a dispute.
 */
export async function revokeDisputeAccess(
  disputeId: string,
  userId: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    await db.delete(disputeAccess)
      .where(
        and(
          eq(disputeAccess.disputeId, disputeId),
          eq(disputeAccess.userId, userId)
        )
      );
  } catch (err) {
    console.warn("[Authz] revokeDisputeAccess error:", err);
  }
}

/**
 * List all users with explicit access to a dispute.
 */
export async function listDisputeAccess(disputeId: string) {
  const db = await getDb();
  if (!db) return [];

  try {
    return await db
      .select()
      .from(disputeAccess)
      .where(eq(disputeAccess.disputeId, disputeId));
  } catch {
    return [];
  }
}

// ── Document access ──────────────────────────────────────────────────────────

/**
 * Documents inherit access from their parent dispute.
 * A user can access a document if they can access the dispute it belongs to.
 */
export async function canAccessDocument(
  userId: string,
  userRole: "user" | "admin",
  disputeId: string,
  permission: AuthzPermission = "read"
): Promise<boolean> {
  return canAccessDispute(userId, userRole, disputeId, permission);
}

export async function assertDocumentAccess(
  userId: string,
  userRole: "user" | "admin",
  disputeId: string,
  permission: AuthzPermission = "read"
): Promise<void> {
  const allowed = await canAccessDocument(userId, userRole, disputeId, permission);
  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `You do not have ${permission} access to documents for dispute ${disputeId}`,
    });
  }
}

// ── User management access ───────────────────────────────────────────────────

/**
 * Only admins can manage other users.
 */
export function assertAdminAccess(userRole: "user" | "admin", action = "perform this action"): void {
  if (userRole !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Admin role required to ${action}`,
    });
  }
}

// ── Filter helper ─────────────────────────────────────────────────────────────

/**
 * Returns a Drizzle WHERE condition that limits dispute queries to those
 * the user is allowed to see. Admins see all; users see their own.
 *
 * Usage: .where(disputeVisibilityFilter(userId, userRole))
 */
export function disputeVisibilityFilter(userId: string, userRole: "user" | "admin") {
  if (userRole === "admin") return undefined; // no filter — see all
  return eq(disputes.initiatingPartyId, userId);
}
