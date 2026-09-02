import { createHash, randomBytes } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  eventLog,
  settlementProviderReports,
  settlementReconciliations,
  settlementTransfers,
  tigerbeetleFinalityAccountMappings,
  tigerbeetleFinalityAttempts,
  tigerbeetleFinalityIntents,
  tigerbeetleFinalitySubmissionAuthorizations,
  stakeholderClaimEvidenceArtifacts,
  stakeholderClaimEvidenceBundles,
  stakeholderClaimReviewerAttestations,
  stakeholderClaimSigningKeys,
  type SettlementTransfer,
  type TigerBeetleFinalityIntent,
} from "../drizzle/schema";
import { getDb } from "./db";
import { LedgerIntegrityError, recordPaymentInTransaction } from "./ledger";
import { dispatchOutboxBatch } from "./outbox";
import { submitTigerBeetleFinalityTransfer, type TigerBeetleFinalityTransfer } from "./tigerbeetle";

const U128_MAX = (1n << 128n) - 1n;
const canonicalU128Schema = z.string().regex(/^[1-9]\d{0,38}$/, "must be a non-zero canonical unsigned 128-bit integer").transform(value => {
  const parsed = BigInt(value);
  if (parsed >= U128_MAX) throw new Error("must be less than 2^128 - 1");
  return parsed;
});

export const tigerBeetleFinalityMappingSchema = z.object({
  provider: z.string().trim().min(2).max(64),
  currency: z.literal("USD"),
  debitAccountId: canonicalU128Schema,
  creditAccountId: canonicalU128Schema,
  ledger: z.number().int().min(1).max(0xffff_ffff),
  code: z.number().int().min(1).max(0xffff),
  mappingVersion: z.number().int().min(1),
  approvalReference: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/, "approvalReference must be an opaque reference"),
});
export type TigerBeetleFinalityMappingInput = z.input<typeof tigerBeetleFinalityMappingSchema>;

export type TigerBeetleFinalityRuntimeConfig = {
  maxAttempts: number;
  leaseSeconds: number;
  workerIntervalMs: number;
};

function runtimeConfig(): TigerBeetleFinalityRuntimeConfig {
  const maxAttempts = Number(process.env.TIGERBEETLE_FINALITY_MAX_ATTEMPTS);
  const leaseSeconds = Number(process.env.TIGERBEETLE_FINALITY_LEASE_SECONDS);
  const workerIntervalMs = Number(process.env.TIGERBEETLE_FINALITY_WORKER_INTERVAL_MS);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
    throw new TigerBeetleFinalityError("TIGERBEETLE_FINALITY_MAX_ATTEMPTS must be an integer from 1 through 20");
  }
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 900) {
    throw new TigerBeetleFinalityError("TIGERBEETLE_FINALITY_LEASE_SECONDS must be an integer from 30 through 900");
  }
  if (!Number.isInteger(workerIntervalMs) || workerIntervalMs < 1_000 || workerIntervalMs > 60_000) {
    throw new TigerBeetleFinalityError("TIGERBEETLE_FINALITY_WORKER_INTERVAL_MS must be an integer from 1000 through 60000");
  }
  return { maxAttempts, leaseSeconds, workerIntervalMs };
}

export class TigerBeetleFinalityError extends LedgerIntegrityError {
  constructor(message: string) {
    super(message);
    this.name = "TigerBeetleFinalityError";
  }
}

export function isTigerBeetleFinalityRequired(): boolean {
  return process.env.TIGERBEETLE_FINALITY_REQUIRED === "true";
}

export function isTigerBeetleFinalityWorkerEnabled(): boolean {
  return process.env.TIGERBEETLE_FINALITY_WORKER_ENABLED === "true";
}

function canonicalU128(value: bigint): string {
  if (value <= 0n || value >= U128_MAX) throw new TigerBeetleFinalityError("TigerBeetle identifiers must be within the non-reserved u128 range");
  return value.toString();
}

function randomTransferId(): string {
  let value = 0n;
  while (value === 0n || value === U128_MAX) value = BigInt(`0x${randomBytes(16).toString("hex")}`);
  return canonicalU128(value);
}

function finalityPayloadDigest(input: {
  tigerbeetleTransferId: string;
  debitAccountId: string;
  creditAccountId: string;
  amountCents: bigint;
  ledger: number;
  code: number;
}): string {
  return createHash("sha256").update(JSON.stringify({
    tigerbeetleTransferId: input.tigerbeetleTransferId,
    debitAccountId: input.debitAccountId,
    creditAccountId: input.creditAccountId,
    amountCents: input.amountCents.toString(),
    ledger: input.ledger,
    code: input.code,
    flags: 0,
  })).digest("hex");
}

function finalityOutboxKey(intentId: string, eventType: string): string {
  return `tb-finality:${createHash("sha256").update(`${intentId}:${eventType}`).digest("hex")}`;
}

function localLedgerIdempotencyKey(intentId: string): string {
  return `tbfin:${createHash("sha256").update(intentId).digest("hex").slice(0, 58)}`;
}

function retryDelaySeconds(attemptNumber: number): number {
  return Math.min(1_800, 30 * 2 ** Math.max(0, attemptNumber - 1));
}

async function enqueueFinalityEvent(tx: any, input: { intentId: string; disputeId: string; provider: string; eventType: string; actor: string; attemptNumber?: number; outcome?: string }) {
  const now = new Date();
  await tx.insert(eventLog).values({
    id: crypto.randomUUID(),
    topic: "idr.payments",
    eventType: input.eventType,
    aggregateId: input.disputeId,
    aggregateType: "tigerbeetle_finality",
    payload: { finalityIntentId: input.intentId, provider: input.provider, attemptNumber: input.attemptNumber, outcome: input.outcome },
    metadata: { userId: input.actor, source: "tigerbeetle_finality", timestamp: now.toISOString() },
    idempotencyKey: finalityOutboxKey(input.intentId, input.eventType),
    status: "pending",
    retryCount: 0,
    nextAttemptAt: now,
    createdAt: now,
  }).onConflictDoNothing();
}

export async function createTigerBeetleFinalityMappingDraft(input: TigerBeetleFinalityMappingInput, approvedBy: string) {
  const parsed = tigerBeetleFinalityMappingSchema.parse(input);
  if (parsed.debitAccountId === parsed.creditAccountId) throw new TigerBeetleFinalityError("TigerBeetle debit and credit account IDs must differ");
  const db = await getDb();
  if (!db) throw new TigerBeetleFinalityError("PostgreSQL is unavailable; finality mapping was not persisted");
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${parsed.provider}:${parsed.currency}`}))`);
    const matchingVersion = await tx.select().from(tigerbeetleFinalityAccountMappings).where(and(
      eq(tigerbeetleFinalityAccountMappings.provider, parsed.provider),
      eq(tigerbeetleFinalityAccountMappings.currency, parsed.currency),
      eq(tigerbeetleFinalityAccountMappings.mappingVersion, parsed.mappingVersion),
    )).limit(1);
    if (matchingVersion[0]) return matchingVersion[0];
    const now = new Date();
    const rows = await tx.insert(tigerbeetleFinalityAccountMappings).values({
      id: crypto.randomUUID(), provider: parsed.provider, currency: parsed.currency,
      debitAccountId: canonicalU128(parsed.debitAccountId), creditAccountId: canonicalU128(parsed.creditAccountId),
      ledger: parsed.ledger, code: parsed.code, mode: "single_phase_settlement", mappingVersion: parsed.mappingVersion,
      active: false, verifiedAt: null, approvedBy, approvalReference: parsed.approvalReference, createdAt: now, updatedAt: now,
    }).returning();
    if (!rows[0]) throw new TigerBeetleFinalityError("TigerBeetle finality mapping draft was not persisted");
    return rows[0];
  });
}

const REQUIRED_MAPPING_EVIDENCE_ROLES = new Set([
  "tigerbeetle_account_verification",
  "tigerbeetle_mtls_readiness",
  "tigerbeetle_topology_validation",
  "tigerbeetle_finality_sandbox_result",
]);

function mappingClaimId(mapping: { provider: string; currency: string; mappingVersion: number }): string {
  return `tigerbeetle-finality:${mapping.provider}:${mapping.currency}:${mapping.mappingVersion}`;
}

export async function activateTigerBeetleFinalityMapping(input: { mappingId: string; evidenceBundleId: string; verifiedBy: string }) {
  if (input.verifiedBy.length < 1 || input.evidenceBundleId.length < 1) throw new TigerBeetleFinalityError("Mapping activation requires authenticated verifier and evidence bundle IDs");
  const db = await getDb();
  if (!db) throw new TigerBeetleFinalityError("PostgreSQL is unavailable; finality mapping cannot be activated");
  return db.transaction(async tx => {
    const mapping = (await tx.select().from(tigerbeetleFinalityAccountMappings).where(eq(tigerbeetleFinalityAccountMappings.id, input.mappingId)).limit(1))[0];
    if (!mapping) throw new TigerBeetleFinalityError("TigerBeetle finality mapping draft was not found");
    if (mapping.active) throw new TigerBeetleFinalityError("TigerBeetle finality mapping is already active and cannot be reactivated");
    if (mapping.approvedBy === input.verifiedBy) throw new TigerBeetleFinalityError("A different independently authenticated reviewer must activate the finality mapping");

    const bundle = (await tx.select().from(stakeholderClaimEvidenceBundles).where(and(
      eq(stakeholderClaimEvidenceBundles.id, input.evidenceBundleId),
      eq(stakeholderClaimEvidenceBundles.status, "validated"),
      eq(stakeholderClaimEvidenceBundles.environment, "staging"),
      eq(stakeholderClaimEvidenceBundles.claimType, "tigerbeetle_finality_mapping"),
      eq(stakeholderClaimEvidenceBundles.claimId, mappingClaimId(mapping)),
    )).limit(1))[0];
    if (!bundle || !bundle.validationReportSha256) {
      throw new TigerBeetleFinalityError("Mapping activation requires a validated staging finality-mapping evidence bundle with a validation report hash");
    }

    const artifacts = await tx.select({ role: stakeholderClaimEvidenceArtifacts.artifactRole }).from(stakeholderClaimEvidenceArtifacts).where(eq(stakeholderClaimEvidenceArtifacts.bundleId, bundle.id));
    const artifactRoles = new Set(artifacts.map(item => item.role));
    const missingRoles = [...REQUIRED_MAPPING_EVIDENCE_ROLES].filter(role => !artifactRoles.has(role));
    if (missingRoles.length) throw new TigerBeetleFinalityError(`Mapping activation evidence is missing required artifact roles: ${missingRoles.join(", ")}`);

    const attestations = await tx.select({
      kind: stakeholderClaimReviewerAttestations.kind,
      reviewerIdentity: stakeholderClaimReviewerAttestations.reviewerIdentity,
      cryptographicallyVerifiedAt: stakeholderClaimReviewerAttestations.cryptographicallyVerifiedAt,
      signingKeyId: stakeholderClaimReviewerAttestations.signingKeyId,
      signingKeyStatus: stakeholderClaimSigningKeys.status,
    }).from(stakeholderClaimReviewerAttestations)
      .innerJoin(stakeholderClaimSigningKeys, eq(stakeholderClaimReviewerAttestations.signingKeyId, stakeholderClaimSigningKeys.id))
      .where(eq(stakeholderClaimReviewerAttestations.bundleId, bundle.id));
    const usable = attestations.filter(item => item.cryptographicallyVerifiedAt && item.signingKeyId && item.signingKeyStatus === "active");
    const owner = usable.find(item => item.kind === "owner" && item.reviewerIdentity === mapping.approvedBy);
    const independent = usable.find(item => item.kind === "independent_reviewer" && item.reviewerIdentity === input.verifiedBy);
    if (!owner || !independent) throw new TigerBeetleFinalityError("Mapping activation requires valid owner and independently verified reviewer attestations tied to active signing keys");

    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${mapping.provider}:${mapping.currency}`}))`);
    await tx.update(tigerbeetleFinalityAccountMappings).set({ active: false, updatedAt: new Date() }).where(and(
      eq(tigerbeetleFinalityAccountMappings.provider, mapping.provider),
      eq(tigerbeetleFinalityAccountMappings.currency, mapping.currency),
      eq(tigerbeetleFinalityAccountMappings.active, true),
    ));
    const now = new Date();
    const activated = await tx.update(tigerbeetleFinalityAccountMappings).set({
      active: true,
      verifiedAt: now,
      verifiedBy: input.verifiedBy,
      verificationEvidenceSha256: bundle.manifestSha256,
      activationEvidenceBundleId: bundle.id,
      updatedAt: now,
    }).where(and(eq(tigerbeetleFinalityAccountMappings.id, mapping.id), eq(tigerbeetleFinalityAccountMappings.active, false))).returning();
    if (!activated[0]) throw new TigerBeetleFinalityError("Finality mapping activation was not persisted");
    return activated[0];
  });
}

export async function requestTigerBeetleFinalitySubmissionAuthorization(input: { intentId: string; changeTicket: string; requestReason: string; requestedBy: string }) {
  if (!/^CHG-[A-Za-z0-9._-]{3,120}$/.test(input.changeTicket)) throw new TigerBeetleFinalityError("A valid approved change ticket is required for finality submission authorization");
  if (input.requestReason.trim().length < 12 || input.requestReason.length > 1_000) throw new TigerBeetleFinalityError("Finality submission reason must be 12 through 1000 characters");
  const db = await getDb();
  if (!db) throw new TigerBeetleFinalityError("PostgreSQL is unavailable; finality submission authorization was not persisted");
  return db.transaction(async tx => {
    const intent = (await tx.select().from(tigerbeetleFinalityIntents).where(eq(tigerbeetleFinalityIntents.id, input.intentId)).limit(1))[0];
    if (!intent || !["queued", "retryable"].includes(intent.status)) throw new TigerBeetleFinalityError("Only queued or retryable finality intents can be authorized");
    const active = (await tx.select({ id: tigerbeetleFinalityAccountMappings.id }).from(tigerbeetleFinalityAccountMappings).where(and(
      eq(tigerbeetleFinalityAccountMappings.id, intent.mappingId),
      eq(tigerbeetleFinalityAccountMappings.provider, intent.provider),
      eq(tigerbeetleFinalityAccountMappings.currency, intent.currency),
      eq(tigerbeetleFinalityAccountMappings.active, true),
    )).limit(1))[0];
    if (!active) throw new TigerBeetleFinalityError("No active independently verified mapping exists for this finality intent");
    const existing = (await tx.select().from(tigerbeetleFinalitySubmissionAuthorizations).where(and(
      eq(tigerbeetleFinalitySubmissionAuthorizations.intentId, intent.id),
      eq(tigerbeetleFinalitySubmissionAuthorizations.status, "pending_approval"),
    )).limit(1))[0];
    if (existing) return existing;
    const now = new Date();
    const rows = await tx.insert(tigerbeetleFinalitySubmissionAuthorizations).values({
      id: crypto.randomUUID(), intentId: intent.id, changeTicket: input.changeTicket, requestReason: input.requestReason.trim(), requestedBy: input.requestedBy, requestedAt: now, status: "pending_approval",
    }).returning();
    if (!rows[0]) throw new TigerBeetleFinalityError("Finality submission authorization request was not persisted");
    await enqueueFinalityEvent(tx, { intentId: intent.id, disputeId: (await tx.select({ disputeId: settlementTransfers.disputeId }).from(settlementTransfers).where(eq(settlementTransfers.id, intent.settlementTransferId)).limit(1))[0]?.disputeId ?? "unknown", provider: intent.provider, eventType: "transfer.finality_authorization_requested", actor: input.requestedBy });
    return rows[0];
  });
}

export async function approveTigerBeetleFinalitySubmissionAuthorization(input: { authorizationId: string; approvedBy: string; expiresInMinutes: number }) {
  if (!Number.isInteger(input.expiresInMinutes) || input.expiresInMinutes < 5 || input.expiresInMinutes > 30) throw new TigerBeetleFinalityError("Finality execution authorization expiry must be an integer from 5 through 30 minutes");
  const db = await getDb();
  if (!db) throw new TigerBeetleFinalityError("PostgreSQL is unavailable; finality submission authorization cannot be approved");
  return db.transaction(async tx => {
    const authorization = (await tx.select().from(tigerbeetleFinalitySubmissionAuthorizations).where(eq(tigerbeetleFinalitySubmissionAuthorizations.id, input.authorizationId)).limit(1))[0];
    if (!authorization || authorization.status !== "pending_approval") throw new TigerBeetleFinalityError("Only a pending finality submission authorization can be approved");
    if (authorization.requestedBy === input.approvedBy) throw new TigerBeetleFinalityError("Finality submission approval requires a different authenticated approver");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.expiresInMinutes * 60_000);
    const rows = await tx.update(tigerbeetleFinalitySubmissionAuthorizations).set({ status: "approved", approvedBy: input.approvedBy, approvedAt: now, expiresAt }).where(and(
      eq(tigerbeetleFinalitySubmissionAuthorizations.id, authorization.id),
      eq(tigerbeetleFinalitySubmissionAuthorizations.status, "pending_approval"),
    )).returning();
    if (!rows[0]) throw new TigerBeetleFinalityError("Finality submission approval was not persisted");
    return rows[0];
  });
}

export async function cancelTigerBeetleFinalitySubmissionAuthorization(input: { authorizationId: string; cancelledBy: string }) {
  const db = await getDb();
  if (!db) throw new TigerBeetleFinalityError("PostgreSQL is unavailable; finality submission authorization cannot be cancelled");
  const rows = await db.update(tigerbeetleFinalitySubmissionAuthorizations).set({ status: "cancelled", cancelledBy: input.cancelledBy, cancelledAt: new Date() }).where(and(
    eq(tigerbeetleFinalitySubmissionAuthorizations.id, input.authorizationId),
    inArray(tigerbeetleFinalitySubmissionAuthorizations.status, ["pending_approval", "approved"]),
  )).returning();
  if (!rows[0]) throw new TigerBeetleFinalityError("Only a pending or approved unconsumed finality submission authorization can be cancelled");
  return rows[0];
}

export async function executeTigerBeetleFinalitySubmissionAuthorization(input: { authorizationId: string; executedBy: string }) {
  if (process.env.PAYMENT_EXECUTION_MODE !== "enabled" || process.env.TIGERBEETLE_FINALITY_EXECUTION !== "true") throw new TigerBeetleFinalityError("Finality execution is disabled outside an explicitly enabled approved environment");
  const db = await getDb();
  if (!db) throw new TigerBeetleFinalityError("PostgreSQL is unavailable; finality submission cannot be executed");
  const authorization = (await db.select().from(tigerbeetleFinalitySubmissionAuthorizations).where(eq(tigerbeetleFinalitySubmissionAuthorizations.id, input.authorizationId)).limit(1))[0];
  if (!authorization || authorization.status !== "approved" || !authorization.expiresAt) throw new TigerBeetleFinalityError("A current approved finality submission authorization is required");
  if (authorization.expiresAt <= new Date()) {
    await db.update(tigerbeetleFinalitySubmissionAuthorizations).set({ status: "expired" }).where(and(eq(tigerbeetleFinalitySubmissionAuthorizations.id, authorization.id), eq(tigerbeetleFinalitySubmissionAuthorizations.status, "approved")));
    throw new TigerBeetleFinalityError("Finality submission authorization expired before execution");
  }
  if (input.executedBy === authorization.requestedBy || input.executedBy === authorization.approvedBy) throw new TigerBeetleFinalityError("Finality execution requires a third independently authenticated operator");
  const result = await runTigerBeetleFinalityWorkerOnce(authorization.id, input.executedBy);
  if (result.claimed !== 1) throw new TigerBeetleFinalityError("Finality submission authorization was cancelled, expired, consumed, or no longer eligible before claim");
  return result;
}

export async function listTigerBeetleFinalitySubmissionAuthorizations(intentId: string) {
  const db = await getDb();
  if (!db) throw new TigerBeetleFinalityError("PostgreSQL is unavailable; finality submission authorization status cannot be read");
  return db.select({ id: tigerbeetleFinalitySubmissionAuthorizations.id, intentId: tigerbeetleFinalitySubmissionAuthorizations.intentId, changeTicket: tigerbeetleFinalitySubmissionAuthorizations.changeTicket, requestedBy: tigerbeetleFinalitySubmissionAuthorizations.requestedBy, requestedAt: tigerbeetleFinalitySubmissionAuthorizations.requestedAt, approvedBy: tigerbeetleFinalitySubmissionAuthorizations.approvedBy, approvedAt: tigerbeetleFinalitySubmissionAuthorizations.approvedAt, expiresAt: tigerbeetleFinalitySubmissionAuthorizations.expiresAt, consumedAt: tigerbeetleFinalitySubmissionAuthorizations.consumedAt, consumedBy: tigerbeetleFinalitySubmissionAuthorizations.consumedBy, cancelledAt: tigerbeetleFinalitySubmissionAuthorizations.cancelledAt, cancelledBy: tigerbeetleFinalitySubmissionAuthorizations.cancelledBy, status: tigerbeetleFinalitySubmissionAuthorizations.status }).from(tigerbeetleFinalitySubmissionAuthorizations).where(eq(tigerbeetleFinalitySubmissionAuthorizations.intentId, intentId)).orderBy(sql`${tigerbeetleFinalitySubmissionAuthorizations.requestedAt} DESC`);
}

export async function queueTigerBeetleFinalityIntentInTransaction(tx: any, input: {
  transfer: SettlementTransfer;
  providerReportId: string;
  disputeId: string;
}): Promise<TigerBeetleFinalityIntent> {
  if (!isTigerBeetleFinalityRequired()) throw new TigerBeetleFinalityError("TigerBeetle finality is not explicitly required for this environment");
  const existing = await tx.select().from(tigerbeetleFinalityIntents).where(eq(tigerbeetleFinalityIntents.providerReportId, input.providerReportId)).limit(1);
  if (existing[0]) return existing[0];
  const mappings = await tx.select().from(tigerbeetleFinalityAccountMappings).where(and(
    eq(tigerbeetleFinalityAccountMappings.provider, input.transfer.provider),
    eq(tigerbeetleFinalityAccountMappings.currency, input.transfer.currency),
    eq(tigerbeetleFinalityAccountMappings.active, true),
  )).limit(1);
  const mapping = mappings[0];
  if (!mapping || !mapping.verifiedAt) throw new TigerBeetleFinalityError("No active independently verified TigerBeetle finality mapping exists for this provider/currency");
  const tigerbeetleTransferId = randomTransferId();
  const payloadDigest = finalityPayloadDigest({ tigerbeetleTransferId, debitAccountId: mapping.debitAccountId, creditAccountId: mapping.creditAccountId, amountCents: input.transfer.amountCents, ledger: mapping.ledger, code: mapping.code });
  const now = new Date();
  const rows = await tx.insert(tigerbeetleFinalityIntents).values({
    id: crypto.randomUUID(),     settlementTransferId: input.transfer.id, providerReportId: input.providerReportId, mappingId: mapping.id,
    provider: input.transfer.provider, currency: input.transfer.currency, mode: mapping.mode,
    tigerbeetleTransferId, debitAccountId: mapping.debitAccountId, creditAccountId: mapping.creditAccountId,
    ledger: mapping.ledger, code: mapping.code, amountCents: input.transfer.amountCents, payloadDigest,
    status: "queued", attemptCount: 0, nextAttemptAt: now, createdAt: now, updatedAt: now,
  }).returning();
  if (!rows[0]) throw new TigerBeetleFinalityError("TigerBeetle finality intent was not persisted");
  await enqueueFinalityEvent(tx, { intentId: rows[0].id, disputeId: input.disputeId, provider: input.transfer.provider, eventType: "transfer.finality_queued", actor: "settlement-provider" });
  return rows[0];
}

type ClaimedIntent = TigerBeetleFinalityIntent & { disputeId: string; providerTransferId: string };

async function claimNextFinalityIntent(config: TigerBeetleFinalityRuntimeConfig, authorizationId: string, executedBy: string): Promise<ClaimedIntent | null> {
  const db = await getDb();
  if (!db) throw new TigerBeetleFinalityError("PostgreSQL is unavailable; finality intent cannot be claimed");
  const rows = await db.execute(sql`
    WITH candidate AS (
      SELECT intent."id", authorization."id" AS "authorizationId"
      FROM "tigerbeetle_finality_intents" intent
      JOIN "settlement_transfers" transfer ON transfer."id" = intent."settlementTransferId"
      JOIN "tigerbeetle_finality_submission_authorizations" authorization
        ON authorization."intentId" = intent."id"
      JOIN "tigerbeetle_finality_account_mappings" mapping
        ON mapping."id" = intent."mappingId" AND mapping."active" = true
      WHERE authorization."id" = ${authorizationId}
        AND authorization."status" = 'approved'
        AND authorization."expiresAt" > now()
        AND intent."status" IN ('queued', 'retryable')
        AND intent."nextAttemptAt" <= now()
        AND intent."attemptCount" < ${config.maxAttempts}
        AND transfer."status" IN ('submitted', 'accepted')
      FOR UPDATE OF intent, authorization SKIP LOCKED
    ), consumed_authorization AS (
      UPDATE "tigerbeetle_finality_submission_authorizations" authorization
      SET "status" = 'consumed', "consumedAt" = now(), "consumedBy" = ${executedBy}
      FROM candidate
      WHERE authorization."id" = candidate."authorizationId"
      RETURNING authorization."intentId"
    )
    UPDATE "tigerbeetle_finality_intents" intent
    SET "status" = 'claimed',
        "attemptCount" = intent."attemptCount" + 1,
        "leaseExpiresAt" = now() + (${config.leaseSeconds} * interval '1 second'),
        "updatedAt" = now()
    FROM consumed_authorization
    WHERE intent."id" = consumed_authorization."intentId"
    RETURNING intent.*, (SELECT "disputeId" FROM "settlement_transfers" WHERE "id" = intent."settlementTransferId") AS "disputeId", (SELECT "providerTransferId" FROM "settlement_transfers" WHERE "id" = intent."settlementTransferId") AS "providerTransferId"
  `);
  return (rows as unknown as ClaimedIntent[])[0] ?? null;
}

function intentTransfer(intent: TigerBeetleFinalityIntent): TigerBeetleFinalityTransfer {
  const transfer: TigerBeetleFinalityTransfer = {
    id: BigInt(intent.tigerbeetleTransferId), debitAccountId: BigInt(intent.debitAccountId), creditAccountId: BigInt(intent.creditAccountId),
    amountCents: intent.amountCents, ledger: intent.ledger, code: intent.code,
  };
  const digest = finalityPayloadDigest({ tigerbeetleTransferId: intent.tigerbeetleTransferId, debitAccountId: intent.debitAccountId, creditAccountId: intent.creditAccountId, amountCents: intent.amountCents, ledger: intent.ledger, code: intent.code });
  if (digest !== intent.payloadDigest) throw new TigerBeetleFinalityError("Finality intent payload digest mismatch; external submission is prohibited");
  return transfer;
}

async function persistAttemptAndCommit(intent: ClaimedIntent, outcome: "created" | "exists_verified", resultCode: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new TigerBeetleFinalityError("PostgreSQL is unavailable after TigerBeetle result; do not classify finality");
  await db.transaction(async tx => {
    const latest = (await tx.select().from(tigerbeetleFinalityIntents).where(eq(tigerbeetleFinalityIntents.id, intent.id)).limit(1))[0];
    if (!latest || latest.status !== "claimed") throw new TigerBeetleFinalityError("Finality intent lease was lost before result persistence");
    const now = new Date();
    await tx.insert(tigerbeetleFinalityAttempts).values({ id: crypto.randomUUID(), intentId: intent.id, attemptNumber: latest.attemptCount, outcome, resultCode, startedAt: now, completedAt: now });
    const entry = await recordPaymentInTransaction(tx, intent.disputeId, latest.amountCents, intent.providerTransferId, localLedgerIdempotencyKey(intent.id));
    const updated = await tx.update(tigerbeetleFinalityIntents).set({ status: "committed", leaseExpiresAt: null, finalityObservedAt: now, ledgerEntryId: entry.id, lastOutcome: outcome, lastErrorCode: null, updatedAt: now }).where(and(eq(tigerbeetleFinalityIntents.id, intent.id), eq(tigerbeetleFinalityIntents.status, "claimed"))).returning();
    if (!updated[0]) throw new TigerBeetleFinalityError("Finality commit state was not persisted");
    await tx.update(settlementTransfers).set({ status: "reconciled", settledAt: now, reconciledAt: now, updatedAt: now }).where(eq(settlementTransfers.id, intent.settlementTransferId));
    await tx.insert(settlementReconciliations).values({ id: crypto.randomUUID(), transferId: intent.settlementTransferId, providerReportId: intent.providerReportId, status: "matched", expectedAmountCents: latest.amountCents, reportedAmountCents: latest.amountCents, expectedStatus: "settled", reportedStatus: "settled", reconciledBy: "tigerbeetle-finality-worker", reconciledAt: now, createdAt: now }).onConflictDoNothing();
    await enqueueFinalityEvent(tx, { intentId: intent.id, disputeId: intent.disputeId, provider: intent.provider, eventType: "transfer.finality_committed", actor: "tigerbeetle-finality-worker", attemptNumber: latest.attemptCount, outcome });
  });
  await dispatchOutboxBatch(1);
}

async function persistFinalityFailure(intent: ClaimedIntent, outcome: "retryable_transport_error" | "permanent_rejection" | "payload_mismatch", resultCode: string, config: TigerBeetleFinalityRuntimeConfig): Promise<void> {
  const db = await getDb();
  if (!db) throw new TigerBeetleFinalityError("PostgreSQL is unavailable; finality failure cannot be audited");
  await db.transaction(async tx => {
    const latest = (await tx.select().from(tigerbeetleFinalityIntents).where(eq(tigerbeetleFinalityIntents.id, intent.id)).limit(1))[0];
    if (!latest || latest.status !== "claimed") return;
    const now = new Date();
    const terminal = outcome !== "retryable_transport_error" || latest.attemptCount >= config.maxAttempts;
    const nextStatus = terminal ? "exception" : "retryable";
    const nextAttemptAt = new Date(now.getTime() + retryDelaySeconds(latest.attemptCount) * 1_000);
    await tx.insert(tigerbeetleFinalityAttempts).values({ id: crypto.randomUUID(), intentId: intent.id, attemptNumber: latest.attemptCount, outcome, resultCode, startedAt: now, completedAt: now });
    await tx.update(tigerbeetleFinalityIntents).set({ status: nextStatus, leaseExpiresAt: null, nextAttemptAt, lastOutcome: outcome, lastErrorCode: resultCode, updatedAt: now }).where(eq(tigerbeetleFinalityIntents.id, intent.id));
    await enqueueFinalityEvent(tx, { intentId: intent.id, disputeId: intent.disputeId, provider: intent.provider, eventType: terminal ? "transfer.finality_exception" : "transfer.finality_retry_scheduled", actor: "tigerbeetle-finality-worker", attemptNumber: latest.attemptCount, outcome });
  });
  await dispatchOutboxBatch(1);
}

export async function runTigerBeetleFinalityWorkerOnce(authorizationId?: string, executedBy?: string): Promise<{ claimed: number; committed: number; retryable: number; exceptions: number }> {
  if (!isTigerBeetleFinalityWorkerEnabled()) return { claimed: 0, committed: 0, retryable: 0, exceptions: 0 };
  if (!isTigerBeetleFinalityRequired()) throw new TigerBeetleFinalityError("Finality worker is enabled but TIGERBEETLE_FINALITY_REQUIRED is not true");
  if (!authorizationId || !/^[0-9a-f-]{36}$/i.test(authorizationId) || !executedBy) throw new TigerBeetleFinalityError("A specific approved finality submission authorization and authenticated executor are required");
  const config = runtimeConfig();
  const intent = await claimNextFinalityIntent(config, authorizationId, executedBy);
  if (!intent) return { claimed: 0, committed: 0, retryable: 0, exceptions: 0 };
  try {
    const result = await submitTigerBeetleFinalityTransfer(intentTransfer(intent));
    if (result.outcome === "created" || result.outcome === "exists_verified") {
      await persistAttemptAndCommit(intent, result.outcome, result.resultCode);
      return { claimed: 1, committed: 1, retryable: 0, exceptions: 0 };
    }
    await persistFinalityFailure(intent, "permanent_rejection", result.resultCode, config);
    return { claimed: 1, committed: 0, retryable: 0, exceptions: 1 };
  } catch (error) {
    const code = error instanceof TigerBeetleFinalityError ? "payload_validation" : "transport_or_client_error";
    const outcome = code === "payload_validation" ? "payload_mismatch" : "retryable_transport_error";
    await persistFinalityFailure(intent, outcome, code, config);
    return { claimed: 1, committed: 0, retryable: outcome === "retryable_transport_error" ? 1 : 0, exceptions: outcome === "retryable_transport_error" ? 0 : 1 };
  }
}

export function startTigerBeetleFinalityWorker(): void {
  // Deliberately no background scheduler: every external finality attempt must be
  // tied to a specific, short-lived, consumed two-person authorization.
  if (isTigerBeetleFinalityWorkerEnabled()) runtimeConfig();
}

export async function listTigerBeetleFinalityIntentsForDispute(disputeId: string) {
  const db = await getDb();
  if (!db) throw new TigerBeetleFinalityError("PostgreSQL is unavailable; finality intent status cannot be read");
  return db.execute(sql`
    SELECT intent."id", intent."settlementTransferId", intent."provider", intent."currency", intent."amountCents", intent."status", intent."attemptCount", intent."nextAttemptAt", intent."finalityObservedAt", intent."lastOutcome", intent."lastErrorCode", intent."createdAt", intent."updatedAt"
    FROM "tigerbeetle_finality_intents" intent
    JOIN "settlement_transfers" transfer ON transfer."id" = intent."settlementTransferId"
    WHERE transfer."disputeId" = ${disputeId}
    ORDER BY intent."createdAt" DESC
  `);
}

export async function getTigerBeetleFinalityMappingActivationReadiness(mappingId: string) {
  const db = await getDb();
  if (!db) throw new TigerBeetleFinalityError("PostgreSQL is unavailable; mapping readiness cannot be read");
  const mapping = (await db.select({ id: tigerbeetleFinalityAccountMappings.id, provider: tigerbeetleFinalityAccountMappings.provider, currency: tigerbeetleFinalityAccountMappings.currency, mappingVersion: tigerbeetleFinalityAccountMappings.mappingVersion, active: tigerbeetleFinalityAccountMappings.active, approvedBy: tigerbeetleFinalityAccountMappings.approvedBy }).from(tigerbeetleFinalityAccountMappings).where(eq(tigerbeetleFinalityAccountMappings.id, mappingId)).limit(1))[0];
  if (!mapping) throw new TigerBeetleFinalityError("TigerBeetle finality mapping draft was not found");
  const bundles = await db.select({ id: stakeholderClaimEvidenceBundles.id, status: stakeholderClaimEvidenceBundles.status, manifestSha256: stakeholderClaimEvidenceBundles.manifestSha256, validatedAt: stakeholderClaimEvidenceBundles.validatedAt }).from(stakeholderClaimEvidenceBundles).where(and(
    eq(stakeholderClaimEvidenceBundles.environment, "staging"),
    eq(stakeholderClaimEvidenceBundles.claimType, "tigerbeetle_finality_mapping"),
    eq(stakeholderClaimEvidenceBundles.claimId, mappingClaimId(mapping)),
  ));
  return { mapping, expectedClaimId: mappingClaimId(mapping), requiredArtifactRoles: [...REQUIRED_MAPPING_EVIDENCE_ROLES], evidenceBundles: bundles };
}

export async function listTigerBeetleFinalityMappingDrafts() {
  const db = await getDb();
  if (!db) throw new TigerBeetleFinalityError("PostgreSQL is unavailable; finality mapping drafts cannot be read");
  return db.select({ id: tigerbeetleFinalityAccountMappings.id, provider: tigerbeetleFinalityAccountMappings.provider, currency: tigerbeetleFinalityAccountMappings.currency, mappingVersion: tigerbeetleFinalityAccountMappings.mappingVersion, active: tigerbeetleFinalityAccountMappings.active, verifiedAt: tigerbeetleFinalityAccountMappings.verifiedAt, approvedBy: tigerbeetleFinalityAccountMappings.approvedBy, approvalReference: tigerbeetleFinalityAccountMappings.approvalReference, createdAt: tigerbeetleFinalityAccountMappings.createdAt }).from(tigerbeetleFinalityAccountMappings).orderBy(sql`${tigerbeetleFinalityAccountMappings.createdAt} DESC`);
}

export function stopTigerBeetleFinalityWorker(): void {
  // One-shot, explicitly authorized submissions have no background timer to stop.
}
