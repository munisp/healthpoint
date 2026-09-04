import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { disputeAccess, disputes } from "../drizzle/schema";
import { observeDependencyOperation } from "./_core/telemetry";
import { getDb } from "./db";

const PERMIFY_URL = process.env.PERMIFY_URL?.replace(/\/$/, "");
const PERMIFY_TENANT = process.env.PERMIFY_TENANT || "t1";
const PERMIFY_AUTH_TOKEN = process.env.PERMIFY_AUTH_TOKEN;
const isProduction = process.env.NODE_ENV === "production";

export type AuthzPermission = "read" | "write" | "admin";
export interface AuthzSubject { id: string; role: "user" | "admin"; }
export interface AuthzContext { user: AuthzSubject; }

class AuthorizationInfrastructureError extends Error {}

function headers(): Record<string, string> {
  if (!PERMIFY_AUTH_TOKEN) {
    if (isProduction) throw new AuthorizationInfrastructureError("PERMIFY_AUTH_TOKEN is required in production");
    return { "content-type": "application/json" };
  }
  return { "content-type": "application/json", authorization: `Bearer ${PERMIFY_AUTH_TOKEN}` };
}

function requirePermify(): string {
  if (!PERMIFY_URL) throw new AuthorizationInfrastructureError("PERMIFY_URL is required in production");
  return PERMIFY_URL;
}

async function requestPermify(path: string, body: Record<string, unknown>): Promise<Response> {
  const url = `${requirePermify()}/v1/tenants/${encodeURIComponent(PERMIFY_TENANT)}${path}`;
  return observeDependencyOperation("permify", "relationship_api", () => fetch(url, {
    method: "POST", headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(3_000),
  }));
}

async function checkPermify(entity: string, entityId: string, permission: string, subjectId: string): Promise<boolean> {
  const res = await requestPermify("/permissions/check", {
    metadata: { schema_version: "", snap_token: "", depth: 20 },
    entity: { type: entity, id: entityId }, permission, subject: { type: "user", id: subjectId },
  });
  if (!res.ok) throw new AuthorizationInfrastructureError(`Permify permission check returned HTTP ${res.status}`);
  const data = (await res.json()) as { can?: string };
  return data.can === "RESULT_ALLOWED";
}

async function mirrorCanAccess(userId: string, disputeId: string, permission: AuthzPermission): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const dispute = await db.select({ initiatingPartyId: disputes.initiatingPartyId }).from(disputes).where(eq(disputes.id, disputeId)).limit(1);
  if (dispute[0]?.initiatingPartyId === userId) return permission !== "admin";
  const grant = await db.select({ permission: disputeAccess.permission }).from(disputeAccess)
    .where(and(eq(disputeAccess.disputeId, disputeId), eq(disputeAccess.userId, userId))).limit(1);
  const granted = grant[0]?.permission as AuthzPermission | undefined;
  return permission === "read" ? Boolean(granted) : permission === "write" ? granted === "write" || granted === "admin" : granted === "admin";
}

function relationship(permission: AuthzPermission): string {
  return permission === "read" ? "viewer" : permission === "write" ? "editor" : "administrator";
}

async function writePermifyRelationship(entity: string, entityId: string, relation: string, subjectId: string): Promise<void> {
  const res = await requestPermify("/relationships/write", {
    metadata: { schema_version: "" },
    tuples: [{ entity: { type: entity, id: entityId }, relation, subject: { type: "user", id: subjectId } }],
  });
  if (!res.ok) throw new AuthorizationInfrastructureError(`Permify relationship write returned HTTP ${res.status}`);
}

async function deletePermifyRelationship(entity: string, entityId: string, relation: string, subjectId: string): Promise<void> {
  const res = await requestPermify("/relationships/delete", {
    metadata: { schema_version: "" },
    tuple_filter: { entity: { type: entity, id: entityId }, relation, subject: { type: "user", id: subjectId } },
  });
  if (!res.ok) throw new AuthorizationInfrastructureError(`Permify relationship deletion returned HTTP ${res.status}`);
}

export async function registerDisputeOwner(disputeId: string, ownerId: string): Promise<void> {
  if (!PERMIFY_URL && !isProduction) return;
  await writePermifyRelationship("dispute", disputeId, "owner", ownerId);
}

export async function canAccessDispute(userId: string, userRole: "user" | "admin", disputeId: string, permission: AuthzPermission): Promise<boolean> {
  if (userRole === "admin") return true;
  const permifyPermission = permission === "read" ? "view" : permission === "write" ? "edit" : "manage";
  if (PERMIFY_URL) return checkPermify("dispute", disputeId, permifyPermission, userId);
  if (isProduction) throw new AuthorizationInfrastructureError("Permify is unavailable; authorization fails closed");
  return observeDependencyOperation("postgresql", "authorization_mirror_check", () => mirrorCanAccess(userId, disputeId, permission));
}

export async function assertDisputeAccess(userId: string, userRole: "user" | "admin", disputeId: string, permission: AuthzPermission = "read"): Promise<void> {
  try {
    if (await canAccessDispute(userId, userRole, disputeId, permission)) return;
  } catch (error) {
    if (error instanceof AuthorizationInfrastructureError) {
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Authorization service is unavailable; access is denied" });
    }
    throw error;
  }
  throw new TRPCError({ code: "FORBIDDEN", message: "You do not have the required dispute access" });
}

export async function grantDisputeAccess(disputeId: string, userId: string, permission: AuthzPermission, grantedBy: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new AuthorizationInfrastructureError("PostgreSQL authorization mirror is unavailable");
  const relation = relationship(permission);
  if (PERMIFY_URL) await writePermifyRelationship("dispute", disputeId, relation, userId);
  else if (isProduction) throw new AuthorizationInfrastructureError("Permify is unavailable; access grant is denied");
  try {
    await db.insert(disputeAccess).values({ disputeId, userId, permission, grantedBy, grantedAt: new Date() })
      .onConflictDoUpdate({ target: [disputeAccess.disputeId, disputeAccess.userId], set: { permission, grantedBy, grantedAt: new Date() } });
  } catch (error) {
    if (PERMIFY_URL) {
      try { await deletePermifyRelationship("dispute", disputeId, relation, userId); } catch { /* retain original persistence failure */ }
    }
    throw error;
  }
}

export async function revokeDisputeAccess(disputeId: string, userId: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new AuthorizationInfrastructureError("PostgreSQL authorization mirror is unavailable");
  const existing = await db.select({ permission: disputeAccess.permission }).from(disputeAccess)
    .where(and(eq(disputeAccess.disputeId, disputeId), eq(disputeAccess.userId, userId))).limit(1);
  if (!existing[0]) return;
  if (PERMIFY_URL) await deletePermifyRelationship("dispute", disputeId, relationship(existing[0].permission as AuthzPermission), userId);
  else if (isProduction) throw new AuthorizationInfrastructureError("Permify is unavailable; access revocation is denied");
  await db.delete(disputeAccess).where(and(eq(disputeAccess.disputeId, disputeId), eq(disputeAccess.userId, userId)));
}

export async function listDisputeAccess(disputeId: string) {
  const db = await getDb();
  if (!db) throw new AuthorizationInfrastructureError("PostgreSQL authorization mirror is unavailable");
  return db.select().from(disputeAccess).where(eq(disputeAccess.disputeId, disputeId));
}

export async function canAccessDocument(userId: string, userRole: "user" | "admin", disputeId: string, permission: AuthzPermission = "read"): Promise<boolean> {
  return canAccessDispute(userId, userRole, disputeId, permission);
}

export async function assertDocumentAccess(userId: string, userRole: "user" | "admin", disputeId: string, permission: AuthzPermission = "read"): Promise<void> {
  return assertDisputeAccess(userId, userRole, disputeId, permission);
}

export function assertAdminAccess(userRole: "user" | "admin", action = "perform this action"): void {
  if (userRole !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: `Admin role required to ${action}` });
}

export function disputeVisibilityFilter(userId: string, userRole: "user" | "admin") {
  return userRole === "admin" ? undefined : eq(disputes.initiatingPartyId, userId);
}

export const PERMIFY_SCHEMA = `
entity user {}
entity dispute {
  relation owner @user
  relation reviewer @user
  relation viewer @user
  relation editor @user
  relation administrator @user
  action view = owner or reviewer or viewer or editor or administrator
  action edit = owner or editor or administrator
  action manage = administrator
}
`;

export async function bootstrapPermifySchema(): Promise<void> {
  if (!PERMIFY_URL) {
    if (isProduction) throw new AuthorizationInfrastructureError("PERMIFY_URL is required in production");
    return;
  }
  const res = await requestPermify("/schemas/write", { schema: PERMIFY_SCHEMA });
  if (!res.ok) throw new AuthorizationInfrastructureError(`Permify schema bootstrap returned HTTP ${res.status}`);
}
