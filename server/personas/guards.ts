/**
 * server/personas/guards.ts — shared authorization guards for the missing
 * stakeholder personas (payer, patient, IDRE, org).
 *
 * Payer resolution (v1): a platform user acts as a payer when their email
 * matches a payer account's contactEmail AND a payer_case_links row links
 * that account to the dispute. Every payer procedure asserts membership
 * through assertPayerLink (fail closed).
 */
import crypto from "node:crypto";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { payerAccounts, payerCaseLinks, patientAccessTokens, type PatientAccessToken } from "../../drizzle/schema-personas";
import { disputes } from "../../drizzle/schema";

export async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  return db;
}

export async function loadDispute(db: Awaited<ReturnType<typeof requireDb>>, disputeId: string) {
  const rows = await db.select().from(disputes).where(eq(disputes.id, disputeId)).limit(1);
  if (!rows.length) throw new TRPCError({ code: "NOT_FOUND", message: "Dispute not found" });
  return rows[0];
}

/** Resolve the payer account for a platform user via contactEmail match. */
export async function resolvePayerAccountForUser(user: { id: string; email: string | null }) {
  if (!user.email) {
    throw new TRPCError({ code: "FORBIDDEN", message: "No payer account is associated with this user" });
  }
  const db = await requireDb();
  const rows = await db.select().from(payerAccounts).where(eq(payerAccounts.contactEmail, user.email)).limit(1);
  if (!rows.length) {
    throw new TRPCError({ code: "FORBIDDEN", message: "No payer account is associated with this user" });
  }
  return { db, account: rows[0] };
}

/**
 * Assert the user (as a payer) is linked to the dispute with an
 * invited/active payer_case_links row. Returns { db, account, link, dispute }.
 */
export async function assertPayerLink(user: { id: string; email: string | null }, disputeId: string) {
  const { db, account } = await resolvePayerAccountForUser(user);
  const links = await db
    .select()
    .from(payerCaseLinks)
    .where(
      and(
        eq(payerCaseLinks.payerAccountId, account.id),
        eq(payerCaseLinks.disputeId, disputeId),
        or(eq(payerCaseLinks.status, "invited"), eq(payerCaseLinks.status, "active"))
      )
    )
    .limit(1);
  if (!links.length) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Payer is not linked to this dispute" });
  }
  const dispute = await loadDispute(db, disputeId);
  return { db, account, link: links[0], dispute };
}

export function hashPatientToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Validate a public patient access token: exists, not expired, scope match.
 * Single-use semantics: usedAt is stamped on first successful use for the
 * "view" scope (link access), while ppdr_intake tokens stay reusable until
 * expiry for the intake wizard.
 */
export async function assertPatientToken(token: string, requiredScope: "view" | "ppdr_intake") {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(patientAccessTokens)
    .where(
      and(
        eq(patientAccessTokens.tokenHash, hashPatientToken(token)),
        gt(patientAccessTokens.expiresAt, new Date()),
        eq(patientAccessTokens.scope, requiredScope),
        isNull(patientAccessTokens.usedAt)
      )
    )
    .limit(1);
  if (!rows.length) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid, expired, or already-used patient access token" });
  }
  return { db, tokenRow: rows[0] as PatientAccessToken };
}

export async function markPatientTokenUsed(db: Awaited<ReturnType<typeof requireDb>>, id: string) {
  await db.update(patientAccessTokens).set({ usedAt: new Date() }).where(eq(patientAccessTokens.id, id));
}
