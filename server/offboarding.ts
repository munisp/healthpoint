/**
 * server/offboarding.ts
 *
 * Wave W5-5 / W5-8: user offboarding cascade + optional soft deletion.
 *
 * offboardUser({ adminId, userId, reason, anonymize }) performs, in order:
 *   1. Guard rails — cannot offboard yourself; cannot offboard the LAST
 *      remaining active admin. Idempotent: re-offboarding an already
 *      suspended user is a no-op that reports the previous state.
 *   2. Suspend the account (suspendedAt set, no expiry, reason recorded).
 *   3. Revoke all API keys (api_keys.revokedAt).
 *   4. Disable TOTP (totp_secrets.status='disabled', disabledAt).
 *   5. Revoke every dispute_access grant — via authz.revokeDisputeAccess so
 *      the matching Permify tuples are deleted too (best-effort; the W2
 *      reconcileDisputeAccess job converges any Permify drift).
 *   6. Optional soft-delete (anonymize): PII (name, email, passwordHash) is
 *      replaced with tombstone values; the row and its audit trail are kept.
 *   7. audit_log entry action='admin.offboardUser' (or 'admin.deleteUser').
 *
 * Returns per-step counts so callers (and tests) can verify the cascade.
 */
import { eq, and, isNull, ne } from "drizzle-orm";
import { getDb, createAuditEntry } from "./db";
import { users, apiKeys, totpSecrets, disputeAccess } from "../drizzle/schema";
import { revokeDisputeAccess } from "./authz";

export interface OffboardResult {
  success: boolean;
  alreadyOffboarded: boolean;
  userId: string;
  anonymized: boolean;
  counts: {
    apiKeysRevoked: number;
    totpDisabled: number;
    disputeAccessRevoked: number;
  };
}

export async function offboardUser(args: {
  adminId: string;
  userId: string;
  reason: string;
  anonymize?: boolean;
}): Promise<OffboardResult> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const { adminId, userId, reason, anonymize = false } = args;

  if (userId === adminId) {
    throw new Error("Cannot offboard yourself");
  }

  const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!target) throw new Error("User not found");

  // Last-admin guard: refuse to offboard the only remaining active admin.
  if (target.role === "admin") {
    const otherAdmins = await db.select({ id: users.id }).from(users)
      .where(and(
        eq(users.role, "admin"),
        ne(users.id, userId),
        isNull(users.suspendedAt),
      )).limit(1);
    if (!otherAdmins.length) {
      throw new Error("Cannot offboard the last active admin");
    }
  }

  const alreadyOffboarded = !!target.suspendedAt;
  const counts = { apiKeysRevoked: 0, totpDisabled: 0, disputeAccessRevoked: 0 };

  if (!alreadyOffboarded) {
    // 2. Suspend
    await db.update(users).set({
      suspendedAt: new Date(),
      suspendedUntil: null,
      suspendReason: `offboarded: ${reason}`,
    }).where(eq(users.id, userId));

    // 3. Revoke API keys
    const keys = await db.update(apiKeys).set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
      .returning({ id: apiKeys.id });
    counts.apiKeysRevoked = keys.length;

    // 4. Disable TOTP
    const totp = await db.update(totpSecrets).set({ status: "disabled", disabledAt: new Date(), updatedAt: new Date() })
      .where(and(eq(totpSecrets.userId, userId), ne(totpSecrets.status, "disabled")))
      .returning({ id: totpSecrets.id });
    counts.totpDisabled = totp.length;

    // 5. Revoke dispute access grants (DB rows + Permify tuples)
    const grants = await db.select({ disputeId: disputeAccess.disputeId }).from(disputeAccess)
      .where(eq(disputeAccess.userId, userId));
    for (const g of grants) {
      await revokeDisputeAccess(g.disputeId, userId);
      counts.disputeAccessRevoked++;
    }
  }

  // 6. Optional soft-delete: anonymize PII, keep the row + audit trail.
  if (anonymize && target.email !== `deleted-${userId}@anonymized.local`) {
    await db.update(users).set({
      name: "Deleted user",
      email: `deleted-${userId}@anonymized.local`,
      passwordHash: null,
      loginMethod: "deleted",
    }).where(eq(users.id, userId));
  }

  // 7. Audit
  await createAuditEntry({
    userId: adminId,
    action: anonymize ? "admin.deleteUser" : "admin.offboardUser",
    entityType: "user",
    entityId: userId,
    oldValue: JSON.stringify({ suspendedAt: target.suspendedAt, email: target.email, role: target.role }),
    newValue: JSON.stringify({ reason, anonymize, alreadyOffboarded, counts }),
    ipAddress: null,
    userAgent: null,
  });

  return { success: true, alreadyOffboarded, userId, anonymized: anonymize, counts };
}
