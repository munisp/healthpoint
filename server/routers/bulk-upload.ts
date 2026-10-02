/**
 * server/routers/bulk-upload.ts
 *
 * Phase 19: chunked, resumable million-claim ingestion — tRPC surface.
 *
 * Session lifecycle: createUploadSession -> raw chunk PUTs
 * (PUT /api/bulk-upload/:sessionId/chunks/:chunkIndex, see
 * server/ingest/chunk-handler.ts) -> finalizeUpload (completeness +
 * whole-file sha256 verification, then kicks the checkpointed runner in
 * server/ingest/bulk-ingest.ts) -> getUploadStatus polling ->
 * quarantine repair via listQuarantinedRows / repairQuarantinedRows /
 * discardQuarantinedRows.
 *
 * AuthZ: every procedure asserts org membership (owner/staff write;
 * viewer read) via the submitter.ts assertOrgMember precedent; every
 * query/mutation filters by org_id (IDOR-safe).
 *
 * Honesty: chunking, idempotent re-finalize, resume-after-restart, and the
 * quarantine flow are EXECUTED-VERIFIED at journey scale (thousands of
 * rows); million-row load behavior is UNPROVEN (no staging infra).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, lt, inArray } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { organizations, orgMemberships } from "../../drizzle/schema-personas";
import {
  bulkUploadSessions,
  claimQuarantine,
  type BulkUploadFileType,
} from "../../drizzle/schema-bulk-upload";
import { stageClaims } from "../emr/bulk-import";
import { requireDb } from "../personas/guards";
import { applyManualClaimFields, manualClaimFieldsSchema } from "./practice-audit";
import {
  assembleSha256,
  startIngestion,
  cancelIngestion,
  csvClaimRowToNormalized,
  remittance835ToNormalized,
} from "../ingest/bulk-ingest";
import { parseCsv } from "../csv-import";
import { parseNdjson, normalizeFhirResources } from "../emr/bulk-import";
import { parse837p, claim837ToNormalized } from "../edi/claim837";
import { parse835 } from "../edi/remittance835";

type Db = Awaited<ReturnType<typeof requireDb>>;

async function assertOrgMember(db: Db, userId: string, orgId: string, roles: string[] = ["owner", "staff"]) {
  const rows = await db
    .select()
    .from(orgMemberships)
    .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)))
    .limit(1);
  const m = rows[0];
  if (!m || !roles.includes(m.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You are not an authorized member of this organization" });
  }
  const org = (await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1))[0];
  if (!org) throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
  if (org.status !== "active") {
    throw new TRPCError({ code: "FORBIDDEN", message: `Organization "${org.name}" is ${org.status}; mutations blocked` });
  }
  return { membership: m, org };
}

const READ_ROLES = ["owner", "staff", "viewer"];

async function loadSession(db: Db, orgId: string, sessionId: string) {
  const s = (await db.select().from(bulkUploadSessions)
    .where(and(eq(bulkUploadSessions.id, sessionId), eq(bulkUploadSessions.orgId, orgId)))
    .limit(1))[0];
  if (!s) throw new TRPCError({ code: "NOT_FOUND", message: "Upload session not found in this org" });
  return s;
}

const CHUNK_SIZE_BYTES = 8 * 1024 * 1024; // 8 MiB (design §2.1)

export const bulkUploadRouter = router({
  createUploadSession: protectedProcedure
    .input(z.object({
      orgId: z.string(),
      fileName: z.string().min(1).max(255),
      fileType: z.enum(["csv", "ndjson", "837", "835"]),
      sizeBytes: z.number().int().positive().max(5_000_000_000),
      totalChunks: z.number().int().min(1).max(1000),
      sha256: z.string().length(64),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await assertOrgMember(db, ctx.user.id, input.orgId);
      if (input.totalChunks !== Math.ceil(input.sizeBytes / CHUNK_SIZE_BYTES)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `totalChunks (${input.totalChunks}) must equal ceil(sizeBytes / ${CHUNK_SIZE_BYTES})`,
        });
      }
      const [row] = await db.insert(bulkUploadSessions).values({
        orgId: input.orgId,
        createdByUserId: ctx.user.id,
        fileName: input.fileName,
        fileType: input.fileType,
        declaredSizeBytes: input.sizeBytes,
        chunkSizeBytes: CHUNK_SIZE_BYTES,
        totalChunks: input.totalChunks,
        assembledSha256: input.sha256.toLowerCase(),
        status: "uploading",
      }).returning({ id: bulkUploadSessions.id });
      return {
        sessionId: row.id,
        chunkSizeBytes: CHUNK_SIZE_BYTES,
        uploadUrlBase: `/api/bulk-upload/${row.id}/chunks`,
      };
    }),

  getChunkUploadUrl: protectedProcedure
    .input(z.object({ orgId: z.string(), sessionId: z.string(), chunkIndex: z.number().int().min(0) }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      await assertOrgMember(db, ctx.user.id, input.orgId, READ_ROLES);
      const s = await loadSession(db, input.orgId, input.sessionId);
      if (input.chunkIndex >= s.totalChunks) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "chunkIndex out of range" });
      }
      return {
        url: `/api/bulk-upload/${s.id}/chunks/${input.chunkIndex}`,
        headers: { "x-chunk-sha256": "required" },
      };
    }),

  finalizeUpload: protectedProcedure
    .input(z.object({ orgId: z.string(), sessionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await assertOrgMember(db, ctx.user.id, input.orgId);
      const s = await loadSession(db, input.orgId, input.sessionId);
      // Idempotent re-finalize: already past 'uploading' is a no-op success.
      if (["ready", "ingesting", "completed"].includes(s.status)) {
        return { status: "ready" as const, alreadyFinalized: true };
      }
      if (s.status !== "uploading") {
        throw new TRPCError({ code: "CONFLICT", message: `Session is ${s.status}; cannot finalize` });
      }
      if (s.chunksReceived !== s.totalChunks) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Missing chunks: received ${s.chunksReceived}/${s.totalChunks}`,
        });
      }
      const assembled = await assembleSha256(db, s.id);
      if (s.assembledSha256 && assembled !== s.assembledSha256) {
        await db.update(bulkUploadSessions).set({
          status: "failed",
          errorMessage: `assembled sha256 mismatch: declared ${s.assembledSha256}, computed ${assembled}`,
          updatedAt: new Date(),
        }).where(eq(bulkUploadSessions.id, s.id));
        throw new TRPCError({ code: "BAD_REQUEST", message: "Assembled file sha256 does not match declared hash" });
      }
      await db.update(bulkUploadSessions).set({
        status: "ready",
        finalizedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(eq(bulkUploadSessions.id, s.id), eq(bulkUploadSessions.status, "uploading")));
      await startIngestion(s.id);
      return { status: "ready" as const, alreadyFinalized: false };
    }),

  getUploadStatus: protectedProcedure
    .input(z.object({ orgId: z.string(), sessionId: z.string() }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      await assertOrgMember(db, ctx.user.id, input.orgId, READ_ROLES);
      const s = await loadSession(db, input.orgId, input.sessionId);
      return {
        status: s.status,
        chunksReceived: s.chunksReceived,
        totalChunks: s.totalChunks,
        rowsProcessed: s.rowsProcessed,
        rowsAccepted: s.rowsAccepted,
        rowsQuarantined: s.rowsQuarantined,
        watermarkChunk: s.watermarkChunk,
        errorMessage: s.errorMessage,
      };
    }),

  cancelUpload: protectedProcedure
    .input(z.object({ orgId: z.string(), sessionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await assertOrgMember(db, ctx.user.id, input.orgId);
      const s = await loadSession(db, input.orgId, input.sessionId);
      if (["completed", "failed"].includes(s.status)) {
        throw new TRPCError({ code: "CONFLICT", message: `Session is already ${s.status}` });
      }
      await cancelIngestion(s.id);
      return { status: "cancelled" as const };
    }),

  listUploadSessions: protectedProcedure
    .input(z.object({
      orgId: z.string(),
      limit: z.number().int().min(1).max(100).default(50),
      cursor: z.string().optional(), // session id of last row from prior page
    }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      await assertOrgMember(db, ctx.user.id, input.orgId, READ_ROLES);
      let where = eq(bulkUploadSessions.orgId, input.orgId);
      if (input.cursor) {
        const cur = (await db.select({ createdAt: bulkUploadSessions.createdAt }).from(bulkUploadSessions)
          .where(eq(bulkUploadSessions.id, input.cursor)).limit(1))[0];
        if (cur) where = and(where, lt(bulkUploadSessions.createdAt, cur.createdAt))!;
      }
      const rows = await db.select({
        id: bulkUploadSessions.id,
        fileName: bulkUploadSessions.fileName,
        fileType: bulkUploadSessions.fileType,
        status: bulkUploadSessions.status,
        chunksReceived: bulkUploadSessions.chunksReceived,
        totalChunks: bulkUploadSessions.totalChunks,
        rowsProcessed: bulkUploadSessions.rowsProcessed,
        rowsAccepted: bulkUploadSessions.rowsAccepted,
        rowsQuarantined: bulkUploadSessions.rowsQuarantined,
        errorMessage: bulkUploadSessions.errorMessage,
        createdAt: bulkUploadSessions.createdAt,
        completedAt: bulkUploadSessions.completedAt,
      }).from(bulkUploadSessions)
        .where(where)
        .orderBy(desc(bulkUploadSessions.createdAt))
        .limit(input.limit);
      return { sessions: rows, nextCursor: rows.length === input.limit ? rows[rows.length - 1].id : null };
    }),

  listQuarantinedRows: protectedProcedure
    .input(z.object({
      orgId: z.string(),
      sessionId: z.string().optional(),
      status: z.enum(["quarantined", "repaired", "discarded"]).default("quarantined"),
      limit: z.number().int().min(1).max(500).default(100),
      cursor: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      await assertOrgMember(db, ctx.user.id, input.orgId, READ_ROLES);
      const conds = [
        eq(claimQuarantine.orgId, input.orgId),
        eq(claimQuarantine.status, input.status),
      ];
      if (input.sessionId) conds.push(eq(claimQuarantine.sessionId, input.sessionId));
      if (input.cursor) {
        const cur = (await db.select({ createdAt: claimQuarantine.createdAt }).from(claimQuarantine)
          .where(eq(claimQuarantine.id, input.cursor)).limit(1))[0];
        if (cur) conds.push(lt(claimQuarantine.createdAt, cur.createdAt));
      }
      const rows = await db.select().from(claimQuarantine)
        .where(and(...conds))
        .orderBy(desc(claimQuarantine.createdAt))
        .limit(input.limit);
      return { rows, nextCursor: rows.length === input.limit ? rows[rows.length - 1].id : null };
    }),

  discardQuarantinedRows: protectedProcedure
    .input(z.object({ orgId: z.string(), ids: z.array(z.string()).min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await assertOrgMember(db, ctx.user.id, input.orgId);
      const updated = await db.update(claimQuarantine)
        .set({ status: "discarded", resolvedAt: new Date() })
        .where(and(
          eq(claimQuarantine.orgId, input.orgId),
          eq(claimQuarantine.status, "quarantined"),
          inArray(claimQuarantine.id, input.ids),
        ))
        .returning({ id: claimQuarantine.id });
      return { discarded: updated.length };
    }),

  repairQuarantinedRows: protectedProcedure
    .input(z.object({
      orgId: z.string(),
      updates: z.array(z.object({
        quarantineId: z.string(),
        fields: manualClaimFieldsSchema,
      })).min(1).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await assertOrgMember(db, ctx.user.id, input.orgId);
      const results = [];
      for (const u of input.updates) {
        const row = (await db.select().from(claimQuarantine)
          .where(and(eq(claimQuarantine.id, u.quarantineId), eq(claimQuarantine.orgId, input.orgId)))
          .limit(1))[0];
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `Quarantine row ${u.quarantineId} not found in this org` });
        if (row.status !== "quarantined") {
          throw new TRPCError({ code: "CONFLICT", message: `Quarantine row ${u.quarantineId} is ${row.status}` });
        }
        const session = (await db.select().from(bulkUploadSessions)
          .where(eq(bulkUploadSessions.id, row.sessionId)).limit(1))[0];
        // Stage a minimal claim from the repaired fields (the quarantined row
        // never produced a practice_claims row), then delegate to the exact
        // same apply+rescore helper as practiceAudit.bulkCompleteClaims.
        const staged = await stageClaims(db, input.orgId,
          session && session.fileType === "ndjson" ? "fhir_bulk" : session && session.fileType === "csv" ? "csv" : "x12_837",
          row.sessionId, null, [{
            claimId: u.fields.claimId ?? null,
            patientRef: null,
            planType: u.fields.planType ?? null,
            serviceCategory: u.fields.serviceCategory ?? null,
            patientState: u.fields.patientState ?? null,
            facilityState: u.fields.facilityState ?? null,
            serviceDate: u.fields.serviceDate ?? null,
            serviceEndDate: null,
            placeOfService: null,
            networkStatus: u.fields.networkStatus ?? null,
            noticeConsentStatus: u.fields.noticeConsentStatus ?? null,
            initialPaymentDate: u.fields.initialPaymentDate ?? null,
            denialDate: u.fields.denialDate ?? null,
            priorPaymentDeterminationDate: u.fields.priorPaymentDeterminationDate ?? null,
            cptCodes: u.fields.cptCodes ?? [],
            modifiers: [],
            diagnoses: [],
            payerId: u.fields.payerId ?? null,
            payerName: u.fields.payerName ?? null,
            planIdentifier: u.fields.planIdentifier ?? null,
            renderingNpi: u.fields.renderingNpi ?? null,
            billingNpi: u.fields.billingNpi ?? null,
            tin: u.fields.tin ?? null,
            billedCents: u.fields.billedCents ?? null,
            allowedCents: u.fields.allowedCents ?? null,
            paidCents: u.fields.paidCents ?? null,
            sourceProvenance: { repair: { source: "manual" as const, detail: `quarantine-repair row ${row.id}` } },
            sourceResourceRefs: [`quarantine:${row.id}`],
          }]);
        const claimDbId = staged.claimIds[0];
        if (!claimDbId) {
          throw new TRPCError({ code: "CONFLICT", message: "Repaired claim collided with an existing staged claim (content hash); supply a distinguishing field" });
        }
        const r = await applyManualClaimFields(db, input.orgId, claimDbId, u.fields);
        // Fail-closed: if the claim still fails gates (engine verdict not
        // QUALIFIES), keep the row quarantined with refreshed missingFields —
        // matching bulkCompleteClaims semantics.
        const stillMissing = Array.isArray(r.missingFields) && (r.missingFields as unknown[]).length > 0;
        if (stillMissing) {
          await db.update(claimQuarantine)
            .set({ missingFields: r.missingFields as never })
            .where(eq(claimQuarantine.id, row.id));
          results.push({ quarantineId: row.id, repaired: false, claimDbId, verdict: r.verdict, missingFields: r.missingFields });
        } else {
          await db.update(claimQuarantine)
            .set({ status: "repaired", repairedClaimId: claimDbId, resolvedAt: new Date(), missingFields: [] })
            .where(eq(claimQuarantine.id, row.id));
          results.push({ quarantineId: row.id, repaired: true, claimDbId, verdict: r.verdict, missingFields: r.missingFields });
        }
      }
      return { repaired: results.filter(r => r.repaired).length, results };
    }),
});

// Re-exported so tests can exercise the mappers without a live session.
export { csvClaimRowToNormalized, remittance835ToNormalized, parseCsv, parseNdjson, normalizeFhirResources, parse837p, claim837ToNormalized, parse835 };
export type { BulkUploadFileType };
