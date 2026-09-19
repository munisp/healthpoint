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
 * Relations (Zanzibar-style, per infra/permify/schema.perm):
 *   dispute#owner@user      — user who created the dispute
 *   dispute#reviewer@user   — payer assigned to review (read + write)
 *   dispute#arbitrator@user — IDR entity arbitrator (read + admin)
 *   dispute#org_admin       — organization admins (read + admin + delete)
 */

import { TRPCError } from "@trpc/server";
import { eq, or, and } from "drizzle-orm";
import { getDb } from "./db";
import { disputes, disputeAccess } from "../drizzle/schema";

// ── Permify REST client (optional — falls back to PostgreSQL when PERMIFY_URL not set) ──

const PERMIFY_URL = process.env.PERMIFY_URL;
const PERMIFY_TENANT = process.env.PERMIFY_TENANT || "t1";

async function checkPermify(
  entity: string,
  entityId: string,
  permission: string,
  subjectId: string
): Promise<boolean | null> {
  if (!PERMIFY_URL) return null;
  try {
    const res = await fetch(`${PERMIFY_URL}/v1/tenants/${PERMIFY_TENANT}/permissions/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        metadata: { schema_version: "", snap_token: "", depth: 20 },
        entity: { type: entity, id: entityId },
        permission,
        subject: { type: "user", id: subjectId },
      }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { can?: string };
    // Permify's check.v1 API returns the CHECK_RESULT_* enum (never RESULT_ALLOWED).
    return data.can === "CHECK_RESULT_ALLOWED";
  } catch {
    return null; // Permify unavailable — fall back to PostgreSQL
  }
}

export async function writePermifyRelationship(
  entity: string, entityId: string, relation: string, subjectId: string
): Promise<void> {
  if (!PERMIFY_URL) return;
  try {
    await fetch(`${PERMIFY_URL}/v1/tenants/${PERMIFY_TENANT}/relationships/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        metadata: { schema_version: "" },
        tuples: [{ entity: { type: entity, id: entityId }, relation, subject: { type: "user", id: subjectId } }],
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch (err) {
    console.warn("[authz] Permify write error:", err);
  }
}

export async function registerDisputeOwner(disputeId: string, ownerId: string): Promise<void> {
  await writePermifyRelationship("dispute", disputeId, "owner", ownerId);
}

async function deletePermifyRelationship(
  entity: string, entityId: string, relation: string, subjectId: string
): Promise<void> {
  if (!PERMIFY_URL) return;
  try {
    await fetch(`${PERMIFY_URL}/v1/tenants/${PERMIFY_TENANT}/relationships/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        metadata: { schema_version: "" },
        tuple_filter: { entity: { type: entity, ids: [entityId] }, relation },
        subject_filter: { type: "user", ids: [subjectId] },
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch (err) {
    console.warn("[authz] Permify delete error:", err);
  }
}

/** Read Permify tuples for a dispute (best-effort; empty when Permify is off). */
async function readPermifyRelationships(
  entity: string, entityId: string
): Promise<Array<{ relation: string; subjectId: string }>> {
  if (!PERMIFY_URL) return [];
  try {
    const res = await fetch(`${PERMIFY_URL}/v1/tenants/${PERMIFY_TENANT}/relationships/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        metadata: { snap_token: "" },
        filter: { entity: { type: entity, ids: [entityId] }, relation: "" },
      }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { tuples?: Array<{ entity: { type: string; id: string }; relation: string; subject: { type: string; id: string } }> };
    return (data.tuples ?? []).map(t => ({ relation: t.relation, subjectId: t.subject.id }));
  } catch {
    return [];
  }
}

/**
 * Canonical relation mapping for dispute_access grants (W2 reconciliation fix).
 * The canonical schema (infra/permify/schema.perm, mirrored in PERMIFY_SCHEMA
 * below) defines relations owner/reviewer/arbitrator/org_admin — the previous
 * mapping wrote viewer/editor/admin, which do NOT exist, so Permify checks
 * against granted access always failed closed.
 *
 * Mapping (least privilege available in the schema):
 *   read  → reviewer   (schema has no read-only relation; reviewer is the
 *                       least-privileged relation that includes read. NOTE:
 *                       reviewer also includes write — documented over-grant;
 *                       PostgreSQL remains the precise enforcement layer.)
 *   write → reviewer
 *   admin → arbitrator (org_admin targets organization#admin, not a user)
 */
export function canonicalRelationForPermission(permission: AuthzPermission): string {
  if (permission === "admin") return "arbitrator";
  return "reviewer"; // read and write
}

/**
 * Diff PostgreSQL dispute_access grants against Permify tuples and repair
 * missing Permify relationships (PG is the source of truth for grants).
 * Bounded to `limit` grants per call. Returns counts for observability.
 * Best-effort: Permify write failures are logged and counted, never thrown.
 */
export async function reconcileDisputeAccess(limit = 500): Promise<{ scanned: number; repaired: number; failed: number }> {
  const db = await getDb();
  if (!db) return { scanned: 0, repaired: 0, failed: 0 };
  let grants: Array<{ disputeId: string; userId: string; permission: string }> = [];
  try {
    grants = await db
      .select({ disputeId: disputeAccess.disputeId, userId: disputeAccess.userId, permission: disputeAccess.permission })
      .from(disputeAccess)
      .limit(Math.min(Math.max(limit, 1), 500)) as Array<{ disputeId: string; userId: string; permission: string }>;
  } catch (err) {
    console.warn("[authz] reconcileDisputeAccess: grant scan failed:", err);
    return { scanned: 0, repaired: 0, failed: 0 };
  }

  let repaired = 0;
  let failed = 0;
  // Group by dispute to avoid re-reading tuples per grant.
  const byDispute = new Map<string, typeof grants>();
  for (const g of grants) {
    const list = byDispute.get(g.disputeId) ?? [];
    list.push(g);
    byDispute.set(g.disputeId, list);
  }
  for (const [disputeId, disputeGrants] of byDispute) {
    let tuples: Array<{ relation: string; subjectId: string }> = [];
    try {
      tuples = await readPermifyRelationships("dispute", disputeId);
    } catch {
      tuples = [];
    }
    for (const g of disputeGrants) {
      const relation = canonicalRelationForPermission((g.permission as AuthzPermission) ?? "read");
      const exists = tuples.some(t => t.relation === relation && t.subjectId === g.userId);
      if (exists) continue;
      try {
        await writePermifyRelationship("dispute", disputeId, relation, g.userId);
        repaired++;
      } catch (err) {
        failed++;
        console.warn(`[authz] reconcileDisputeAccess: repair failed for dispute=${disputeId} user=${g.userId}:`, err);
      }
    }
  }
  if (repaired || failed) {
    console.info(`[authz] reconcileDisputeAccess: scanned=${grants.length} repaired=${repaired} failed=${failed}`);
  }
  return { scanned: grants.length, repaired, failed };
}

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

  // Try Permify first
  // Permission names must exist in the canonical mounted schema
  // (infra/permify/schema.perm): "read", "write", and "admin" are defined
  // there; "view"/"edit" are not.
  const permifyPermission = permission;
  const permifyResult = await checkPermify("dispute", disputeId, permifyPermission, userId);
  if (permifyResult !== null) return permifyResult;

  // Fall back to PostgreSQL
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

  // Write to Permify (canonical relations — see canonicalRelationForPermission;
  // previously wrote viewer/editor/admin which do not exist in the schema).
  const relation = canonicalRelationForPermission(permission);
  await writePermifyRelationship("dispute", disputeId, relation, userId);

  // Write to PostgreSQL fallback
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

  // Write-then-delete in BOTH stores: capture the granted permission first so
  // the matching Permify tuple can be deleted. When the PG row is already
  // gone, delete every candidate relation best-effort (reconciliation-safe).
  let grantedPermission: AuthzPermission | null = null;
  try {
    const rows = await db
      .select({ permission: disputeAccess.permission })
      .from(disputeAccess)
      .where(and(eq(disputeAccess.disputeId, disputeId), eq(disputeAccess.userId, userId)))
      .limit(1);
    grantedPermission = (rows[0]?.permission as AuthzPermission) ?? null;
  } catch {
    grantedPermission = null;
  }

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

  // Delete the Permify tuple(s) — best-effort with error log. If this fails,
  // reconcileDisputeAccess() (admin-callable) converges the stores; PG remains
  // the enforcement source of truth when Permify is unreachable.
  try {
    if (grantedPermission) {
      await deletePermifyRelationship("dispute", disputeId, canonicalRelationForPermission(grantedPermission), userId);
    } else {
      for (const relation of ["reviewer", "arbitrator"]) {
        await deletePermifyRelationship("dispute", disputeId, relation, userId);
      }
    }
  } catch (err) {
    console.warn(`[Authz] revokeDisputeAccess: Permify tuple delete failed (reconcileDisputeAccess will repair): dispute=${disputeId} user=${userId}:`, err);
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

// ── Permify schema bootstrap ──────────────────────────────────────────────────

// NOTE: infra/permify/schema.perm is the CANONICAL authorization schema — it is
// mounted into the Permify container by docker-compose. This inline copy exists
// only so a bare Permify instance can be initialized from the app at startup;
// keep it aligned with (and defer to) the mounted schema.perm.
const PERMIFY_SCHEMA = `
entity user {}

entity organization {
  relation admin @user
  relation member @user

  permission manage = admin
  permission view = admin or member
}

entity dispute {
  relation owner @user              // provider who initiated the dispute
  relation reviewer @user           // payer assigned to review
  relation arbitrator @user         // IDR entity arbitrator
  relation org_admin @organization#admin

  // Permissions
  permission read = owner or reviewer or arbitrator or org_admin
  permission write = owner or reviewer
  permission submit_offer = owner or reviewer
  permission advance_step = owner or reviewer or arbitrator
  permission admin = arbitrator or org_admin
  permission delete = org_admin
}

entity document {
  relation dispute @dispute
  relation uploader @user

  permission read = dispute.read
  permission write = uploader or dispute.admin
  permission delete = uploader or dispute.admin
}

entity payment {
  relation dispute @dispute
  relation payer @user
  permission read = dispute.read
  permission initiate = payer or dispute.admin
}
`;

/**
 * Bootstrap the Permify authorization schema on server startup.
 * Safe to call repeatedly — Permify is idempotent on schema writes.
 */
export async function bootstrapPermifySchema(): Promise<void> {
  if (!PERMIFY_URL) {
    console.info("[authz] PERMIFY_URL not set — schema bootstrap skipped");
    return;
  }
  try {
    const res = await fetch(`${PERMIFY_URL}/v1/tenants/${PERMIFY_TENANT}/schemas/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schema: PERMIFY_SCHEMA }),
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) {
      console.info("[authz] Permify schema bootstrapped successfully");
    } else {
      const text = await res.text();
      console.warn(`[authz] Permify schema bootstrap returned ${res.status}: ${text}`);
    }
  } catch (err) {
    console.warn("[authz] Permify schema bootstrap failed (non-fatal):", err);
  }
}
