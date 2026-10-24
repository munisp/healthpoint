/**
 * server/permify-write.ts
 * Mirror-only Permify write path, gated by PERMIFY_WRITE_ENABLED (default
 * false — see .env.example).
 *
 * When enabled, organization membership creation (a user profile carrying an
 * organization) and dispute/case creation mirror their relationship tuples
 * into Permify through the Write API
 * (POST {PERMIFY_URL}/v1/tenants/{PERMIFY_TENANT}/relationships/write),
 * reusing the same PERMIFY_URL / PERMIFY_TENANT configuration and payload
 * shape as the existing client in server/authz.ts.
 *
 * IMPORTANT: Permify is a MIRROR ONLY until a product decision flips the read
 * path — every authorization read/decision stays on the Postgres authz path
 * (server/authz.ts canAccessDispute & friends). This module therefore FAILS
 * OPEN: a write failure is logged and recorded as an event_log audit row, and
 * is never thrown to the caller. Postgres remains the system of record.
 */
import { createHash } from "crypto";
import { eventLog } from "../drizzle/schema";
import { getDb } from "./db";

export type PermifyTuple = {
  entity: { type: string; id: string };
  relation: string;
  subject: { type: string; id: string };
};

export type PermifyWriteResult = "disabled" | "written" | "failed";

const WRITE_TIMEOUT_MS = 3_000;

export function isPermifyWriteEnabled(): boolean {
  return process.env.PERMIFY_WRITE_ENABLED === "true";
}

function permifyConfig(): { url: string; tenant: string } | null {
  const url = process.env.PERMIFY_URL;
  if (!url) return null;
  return { url: url.replace(/\/+$/, ""), tenant: process.env.PERMIFY_TENANT || "t1" };
}

/** Payload for POST /v1/tenants/{tenant}/relationships/write (matches server/authz.ts). */
export function buildRelationshipWritePayload(tuples: PermifyTuple[]): {
  metadata: { schema_version: string };
  tuples: PermifyTuple[];
} {
  return {
    metadata: { schema_version: "" },
    tuples: tuples.map(tuple => ({
      entity: { type: tuple.entity.type, id: tuple.entity.id },
      relation: tuple.relation,
      subject: { type: tuple.subject.type, id: tuple.subject.id },
    })),
  };
}

/** Stable key dedupes repeated failure audits for the same tuple batch. */
function failureAuditKey(context: string, tuples: PermifyTuple[]): string {
  const hash = createHash("sha256").update(JSON.stringify(tuples)).digest("hex").slice(0, 32);
  return `permify-mirror-failed:${context}:${hash}`.slice(0, 191);
}

async function auditFailure(context: string, tuples: PermifyTuple[], message: string): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const now = new Date();
    await db.insert(eventLog).values({
      id: crypto.randomUUID(),
      topic: "idr.authz",
      eventType: "authz.permify_mirror_failed",
      aggregateId: context.slice(0, 64),
      aggregateType: "permify_mirror",
      payload: { context, tuples, error: message.slice(0, 1000) },
      metadata: { userId: "system", source: "permify_write", timestamp: now.toISOString() },
      idempotencyKey: failureAuditKey(context, tuples),
      // Audit-only: "skipped" rows are never dispatched to Kafka by the outbox worker.
      status: "skipped",
      retryCount: 0,
      nextAttemptAt: now,
      createdAt: now,
    }).onConflictDoNothing();
  } catch (auditError) {
    console.error("[permify-write] failed to record audit event", auditError);
  }
}

/**
 * Writes tuples to Permify. Returns "disabled" (flag off), "written", or
 * "failed" (error logged + audit row recorded). Never throws.
 */
export async function writePermifyTuples(context: string, tuples: PermifyTuple[]): Promise<PermifyWriteResult> {
  if (!isPermifyWriteEnabled()) return "disabled";
  if (tuples.length === 0) return "written";
  const config = permifyConfig();
  if (!config) {
    const message = "PERMIFY_WRITE_ENABLED=true but PERMIFY_URL is unset";
    console.error(`[permify-write] ${message}`, { context });
    await auditFailure(context, tuples, message);
    return "failed";
  }
  try {
    const response = await fetch(`${config.url}/v1/tenants/${config.tenant}/relationships/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildRelationshipWritePayload(tuples)),
      signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
    });
    if (!response.ok) {
      const body = (await response.text().catch(() => "")).slice(0, 500);
      throw new Error(`Permify write failed with HTTP ${response.status}: ${body}`);
    }
    console.info("[permify-write] mirrored tuples", { context, count: tuples.length });
    return "written";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Permify write failed";
    console.error(`[permify-write] mirror failed for ${context}: ${message}`);
    await auditFailure(context, tuples, message);
    return "failed";
  }
}

/** Mirrors dispute/case creation: dispute#owner@initiator (+ #owner@creator when distinct). */
export async function mirrorDisputeCreation(
  disputeId: string,
  initiatingPartyId: string,
  createdBy?: string,
): Promise<PermifyWriteResult> {
  const tuples: PermifyTuple[] = [
    { entity: { type: "dispute", id: disputeId }, relation: "owner", subject: { type: "user", id: initiatingPartyId } },
  ];
  if (createdBy && createdBy !== initiatingPartyId) {
    tuples.push({ entity: { type: "dispute", id: disputeId }, relation: "owner", subject: { type: "user", id: createdBy } });
  }
  return writePermifyTuples(`dispute:${disputeId}`, tuples);
}

/** Mirrors organization membership: organization#member@user (or #admin). */
export async function mirrorOrgMembership(
  organizationId: string,
  userId: string,
  relation: "member" | "admin" = "member",
): Promise<PermifyWriteResult> {
  return writePermifyTuples(`organization:${organizationId}:${userId}`, [
    { entity: { type: "organization", id: organizationId }, relation, subject: { type: "user", id: userId } },
  ]);
}
