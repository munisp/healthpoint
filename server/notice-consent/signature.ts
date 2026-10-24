/**
 * server/notice-consent/signature.ts — e-signature capture for the
 * notice-and-consent exception (W4-F4; 45 CFR 149.420(c)-(e) signature
 * requirement; ESIGN Act 15 U.S.C. § 7001).
 *
 * Flow:
 *   1. Provider issues a patient-portal signature link:
 *      noticeConsent.issueSignatureLink creates a patient_access_tokens row
 *      with scope 'consent_sign' (wave F-D table; the column is free varchar,
 *      the PATIENT_TOKEN_SCOPE doc-array is extended in code here). The raw
 *      bearer token is returned exactly once; only its sha256 hash persists.
 *      SEAM: patient_access_tokens.disputeId carries `nc:<caseId>` for
 *      consent-signing tokens (the table predates FSM cases); replace with a
 *      dedicated caseId column when the token table is next migrated.
 *   2. Patient opens the link and calls the PUBLIC proc
 *      noticeConsent.patientSignConsent({token, signerName, attestation,
 *      signatureText}). The token is validated (scope, expiry, single-use),
 *      stamped usedAt, and the FSM case transitions NOTICE_DELIVERED →
 *      CONSENT_SIGNED server-side (all existing guards still apply).
 *   3. A tamper-evident signature artifact is recorded:
 *      artifactHash = sha256_hex(canonical({caseId, signerName, timestamp, ip?}))
 *      stored in the case metadata (caseJson.signatureArtifact) AND in the
 *      consent_signatures table (migration 0040_wave_w4.sql), with the hash
 *      chained into the FSM event log (the CONSENT_SIGNED transition event
 *      detail carries the artifactHash, so verifyEventChain covers it).
 */

import crypto from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { patientAccessTokens } from "../../drizzle/schema-personas";
import { hashPatientToken } from "../personas/guards";
import { fsmCanonicalJson } from "../fsm-store/store";

/** Token TTL for consent-signature links (14 days, matches patient-portal). */
export const CONSENT_SIGNATURE_LINK_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const CONSENT_SIGN_SCOPE = "consent_sign";

/** Encode a notice-consent caseId into the token row's disputeId slot (seam). */
export function tokenCaseRef(caseId: string): string {
  return `nc:${caseId}`;
}
export function caseIdFromTokenRef(ref: string | null): string | null {
  return ref && ref.startsWith("nc:") ? ref.slice(3) : null;
}

export interface SignatureArtifact {
  caseId: string;
  signerName: string;
  signatureText: string;
  attestation: boolean;
  timestamp: string;
  ip?: string;
  /** sha256_hex over the canonical artifact WITHOUT this field. */
  artifactHash: string;
}

/** Compute the tamper-evident artifact hash (canonical JSON, sorted keys). */
export function computeArtifactHash(input: {
  caseId: string;
  signerName: string;
  signatureText: string;
  attestation: boolean;
  timestamp: string;
  ip?: string;
}): string {
  const canonical = fsmCanonicalJson({
    caseId: input.caseId,
    signerName: input.signerName,
    signatureText: input.signatureText,
    attestation: input.attestation,
    timestamp: input.timestamp,
    ...(input.ip ? { ip: input.ip } : {}),
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/** Build a signature artifact with its hash. */
export function buildSignatureArtifact(input: {
  caseId: string;
  signerName: string;
  signatureText: string;
  attestation: boolean;
  timestamp: Date;
  ip?: string;
}): SignatureArtifact {
  const base = {
    caseId: input.caseId,
    signerName: input.signerName,
    signatureText: input.signatureText,
    attestation: input.attestation,
    timestamp: input.timestamp.toISOString(),
    ...(input.ip ? { ip: input.ip } : {}),
  };
  return { ...base, artifactHash: computeArtifactHash(base) };
}

export interface ConsentSignTokenRow {
  id: string;
  caseId: string;
  patientName: string;
}

/**
 * Validate a consent_sign bearer token: exists, unexpired, correct scope,
 * single-use. Fail closed with a generic UNAUTHORIZED on any mismatch.
 */
export async function assertConsentSignToken(token: string): Promise<{
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
  tokenRow: ConsentSignTokenRow;
}> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const rows = await db
    .select()
    .from(patientAccessTokens)
    .where(
      and(
        eq(patientAccessTokens.tokenHash, hashPatientToken(token)),
        gt(patientAccessTokens.expiresAt, new Date()),
        eq(patientAccessTokens.scope, CONSENT_SIGN_SCOPE),
        isNull(patientAccessTokens.usedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  const caseId = row ? caseIdFromTokenRef(row.disputeId) : null;
  if (!row || !caseId) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Invalid, expired, or already-used consent signature token",
    });
  }
  return { db, tokenRow: { id: row.id, caseId, patientName: row.patientName } };
}

/** Persist the artifact row (consent_signatures, migration 0040_wave_w4.sql). */
export async function persistSignatureArtifact(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  tenantId: string,
  artifact: SignatureArtifact,
  prevEventHash: string,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO consent_signatures
      (id, "tenantId", "caseId", "signerName", "signatureTextHash", attestation,
       "artifactHash", "prevEventHash", ip, "signedAt")
    VALUES (
      ${crypto.randomUUID()}, ${tenantId}, ${artifact.caseId}, ${artifact.signerName},
      ${crypto.createHash("sha256").update(artifact.signatureText).digest("hex")},
      ${artifact.attestation}, ${artifact.artifactHash}, ${prevEventHash},
      ${artifact.ip ?? null}, ${artifact.timestamp}
    )
  `);
}

/** Verify an artifact row against a recomputed hash (tamper check). */
export function verifySignatureArtifact(artifact: SignatureArtifact): boolean {
  const { artifactHash, ...base } = artifact;
  return computeArtifactHash(base) === artifactHash;
}
