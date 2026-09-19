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
 *   6. Persona cascade (Phase13-FA, G5):
 *      a. Revoke payer_case_links for the user's payer accounts (email match)
 *      b. Clear arbitratorUserId on proposed/accepted idre_assignments
 *      c. Revoke patient_access_tokens the user issued (revokedAt)
 *      d. Revoke invite_tokens the user issued or that target their email
 *      e. Delete the user's org_memberships
 *   7. Optional soft-delete (anonymize): PII (name, email, passwordHash) is
 *      replaced with tombstone values; the row and its audit trail are kept.
 *   8. audit_log entry action='admin.offboardUser' (or 'admin.deleteUser').
 *
 * Returns per-step counts so callers (and tests) can verify the cascade.
 */
import { eq, and, inArray, isNull, ne, or } from "drizzle-orm";
import { getDb, createAuditEntry } from "./db";
import { users, apiKeys, totpSecrets, disputeAccess } from "../drizzle/schema";
import {
  idreAssignments,
  inviteTokens,
  orgMemberships,
  payerAccounts,
  payerCaseLinks,
  patientAccessTokens,
} from "../drizzle/schema-personas";
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
    payerCaseLinksRevoked: number;
    idreAssignmentsCleared: number;
    patientTokensRevoked: number;
    inviteTokensRevoked: number;
    orgMembershipsRemoved: number;
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
  const counts = {
    apiKeysRevoked: 0,
    totpDisabled: 0,
    disputeAccessRevoked: 0,
    payerCaseLinksRevoked: 0,
    idreAssignmentsCleared: 0,
    patientTokensRevoked: 0,
    inviteTokensRevoked: 0,
    orgMembershipsRemoved: 0,
  };

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

    // 6a. Revoke payer case links for payer accounts bound to the user's
    // email (payer access resolves via contactEmail = user.email).
    if (target.email) {
      const payerAccts = await db.select({ id: payerAccounts.id }).from(payerAccounts)
        .where(eq(payerAccounts.contactEmail, target.email));
      const acctIds = payerAccts.map(a => a.id);
      if (acctIds.length) {
        const links = await db.update(payerCaseLinks).set({ status: "revoked" })
          .where(and(inArray(payerCaseLinks.payerAccountId, acctIds), ne(payerCaseLinks.status, "revoked")))
          .returning({ id: payerCaseLinks.id });
        counts.payerCaseLinksRevoked = links.length;
      }
    }

    // 6b. Clear arbitrator binding on non-terminal assignments so the queue
    // no longer surfaces work to the offboarded arbitrator.
    const assignments = await db.update(idreAssignments)
      .set({ arbitratorUserId: null })
      .where(and(
        eq(idreAssignments.arbitratorUserId, userId),
        inArray(idreAssignments.status, ["proposed", "accepted"]),
      ))
      .returning({ id: idreAssignments.id });
    counts.idreAssignmentsCleared = assignments.length;

    // 6c. Revoke patient access tokens the user issued (G4 revocation hook).
    const tokens = await db.update(patientAccessTokens).set({ revokedAt: new Date() })
      .where(and(eq(patientAccessTokens.createdByUserId, userId), isNull(patientAccessTokens.revokedAt)))
      .returning({ id: patientAccessTokens.id });
    counts.patientTokensRevoked = tokens.length;

    // 6d. Revoke outstanding invite tokens issued by the user or addressed
    // to their email.
    const invites = await db.update(inviteTokens).set({ revokedAt: new Date() })
      .where(and(
        or(eq(inviteTokens.invitedByUserId, userId), eq(inviteTokens.email, target.email ?? "")),
        isNull(inviteTokens.acceptedAt),
        isNull(inviteTokens.revokedAt),
      ))
      .returning({ id: inviteTokens.id });
    counts.inviteTokensRevoked = invites.length;

    // 6e. Remove org memberships (org_memberships has no status column;
    // removal is the deactivate semantic). Re-onboarding is a fresh invite.
    const memberships = await db.delete(orgMemberships)
      .where(eq(orgMemberships.userId, userId))
      .returning({ id: orgMemberships.id });
    counts.orgMembershipsRemoved = memberships.length;
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
