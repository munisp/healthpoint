import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  cmsFeedbackEvents,
  cmsSubmissionOutbox,
  cmsSubmissions,
} from "../../drizzle/schema";
import { getDb } from "../db";
import {
  deserializeStoredSubmission,
  serializeSubmissionForStorage,
  type CmsSubmissionRecord,
  type CmsSubmissionStatus,
  type CmsSubmissionStore,
  type VerifiedCmsFeedback,
} from "./cms-adapter";

/**
 * PostgreSQL store for a CMS human-portal handoff. The outbox is a preparation
 * and reconciliation queue only. No worker in this module can post, poll, or
 * otherwise submit a dispute to CMS.
 */
export class PostgresCmsSubmissionStore implements CmsSubmissionStore {
  async findByIdempotency(
    disputeId: string,
    idempotencyKey: string
  ): Promise<CmsSubmissionRecord | null> {
    const db = await requiredDb();
    const rows = await db
      .select()
      .from(cmsSubmissions)
      .where(
        and(
          eq(cmsSubmissions.disputeId, disputeId),
          eq(cmsSubmissions.idempotencyKey, idempotencyKey)
        )
      )
      .limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async findBySubmissionId(
    submissionId: string
  ): Promise<CmsSubmissionRecord | null> {
    const db = await requiredDb();
    const rows = await db
      .select()
      .from(cmsSubmissions)
      .where(eq(cmsSubmissions.submissionId, submissionId))
      .limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async insert(record: CmsSubmissionRecord): Promise<CmsSubmissionRecord> {
    const db = await requiredDb();
    const [row] = await db
      .insert(cmsSubmissions)
      .values({
        submissionId: record.submissionId,
        disputeId: record.disputeId,
        idempotencyKey: record.idempotencyKey,
        payloadHash: record.payloadHash,
        pilotAuthorizationId: record.pilotAuthorizationId,
        handoffOperatorId: record.handoffOperatorId,
        status: record.status,
        cmsReference: record.cmsReference,
        attempts: record.attempts,
        lastError: record.lastError,
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
      })
      .returning();
    if (!row) throw new Error("CMS handoff insert returned no row");
    if (record.payload) {
      await db.insert(cmsSubmissionOutbox).values({
        outboxId: `cms-handoff-${randomUUID()}`,
        submissionId: record.submissionId,
        disputeId: record.disputeId,
        idempotencyKey: record.idempotencyKey,
        payload: serializeSubmissionForStorage(record.payload),
        status: "pending",
        availableAt: new Date(),
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
      });
    }
    return toRecord(row, record.payload);
  }

  async update(
    submissionId: string,
    patch: Partial<CmsSubmissionRecord>
  ): Promise<CmsSubmissionRecord> {
    const db = await requiredDb();
    const values = {
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.cmsReference !== undefined
        ? { cmsReference: patch.cmsReference }
        : {}),
      ...(patch.portalReceiptSha256 !== undefined
        ? { portalReceiptSha256: patch.portalReceiptSha256 }
        : {}),
      ...(patch.portalReceiptRecordedBy !== undefined
        ? { portalReceiptRecordedBy: patch.portalReceiptRecordedBy }
        : {}),
      ...(patch.portalReceiptReceivedAt !== undefined
        ? { portalReceiptReceivedAt: patch.portalReceiptReceivedAt }
        : {}),
      ...(patch.attempts !== undefined ? { attempts: patch.attempts } : {}),
      ...(patch.lastError !== undefined ? { lastError: patch.lastError } : {}),
      updatedAt: new Date(),
    };
    const [row] = await db
      .update(cmsSubmissions)
      .set(values)
      .where(eq(cmsSubmissions.submissionId, submissionId))
      .returning();
    if (!row) throw new Error("CMS handoff record was not found");
    return toRecord(row, patch.payload);
  }

  async appendFeedback(
    feedback: VerifiedCmsFeedback
  ): Promise<"inserted" | "duplicate"> {
    const db = await requiredDb();
    const rows = await db
      .insert(cmsFeedbackEvents)
      .values({
        eventId: feedback.eventId,
        cmsReference: feedback.cmsReference,
        disputeId: feedback.disputeId,
        type: feedback.type,
        occurredAt: new Date(feedback.occurredAt),
        keyId: "verified",
        payload: feedback.payload,
        payloadHash: feedback.payloadHash,
        processedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ eventId: cmsFeedbackEvents.eventId });
    return rows.length ? "inserted" : "duplicate";
  }

  async listPendingManualHandoffs(
    handoffOperatorId: string,
    limit = 25
  ): Promise<CmsSubmissionRecord[]> {
    const db = await requiredDb();
    const rows = await db
      .select({
        submission: cmsSubmissions,
        payload: cmsSubmissionOutbox.payload,
      })
      .from(cmsSubmissionOutbox)
      .innerJoin(
        cmsSubmissions,
        eq(cmsSubmissions.submissionId, cmsSubmissionOutbox.submissionId)
      )
      .where(
        and(
          eq(cmsSubmissionOutbox.status, "pending"),
          eq(cmsSubmissions.handoffOperatorId, handoffOperatorId)
        )
      )
      .orderBy(cmsSubmissionOutbox.createdAt)
      .limit(Math.max(1, Math.min(limit, 100)));
    return rows.map(row =>
      toRecord(row.submission, deserializeStoredSubmission(row.payload as Record<string, unknown>))
    );
  }
}

function toRecord(
  row: typeof cmsSubmissions.$inferSelect,
  payload?: CmsSubmissionRecord["payload"]
): CmsSubmissionRecord {
  return {
    submissionId: row.submissionId,
    disputeId: row.disputeId,
    idempotencyKey: row.idempotencyKey,
    payloadHash: row.payloadHash,
    pilotAuthorizationId: row.pilotAuthorizationId ?? "",
    handoffOperatorId: row.handoffOperatorId ?? "",
    status: row.status as CmsSubmissionStatus,
    cmsReference: row.cmsReference ?? undefined,
    attempts: row.attempts,
    lastError: row.lastError ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    payload,
  };
}

async function requiredDb() {
  const db = await getDb();
  if (!db) {
    throw new Error(
      "PostgreSQL is required for durable CMS human-portal handoff operations"
    );
  }
  return db;
}
