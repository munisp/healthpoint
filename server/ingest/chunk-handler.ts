/**
 * server/ingest/chunk-handler.ts
 *
 * Phase 19: raw Express PUT handler for chunk uploads:
 *   PUT /api/bulk-upload/:sessionId/chunks/:chunkIndex
 *
 * Mounted in server/_core/index.ts with
 * `express.raw({ type: () => true, limit: "10mb" })` BEFORE express.json
 * (same precedent as /api/settlement/callbacks, which must stay ahead of
 * express.json for exact-byte signature coverage; a future
 * POST /api/billing/stripe-webhook raw route — Phase 20 — follows the same
 * mount-ordering convention).
 *
 * Auth: same cookie/Bearer context creation as tRPC (createContext), plus an
 * org-membership check against the session's org (owner/staff). Integrity:
 * the `x-chunk-sha256` header is verified against the exact body bytes;
 * chunks upsert on (session_id, chunk_index) so a re-PUT is idempotent and
 * `chunks_received` increments only on first insert.
 */
import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { createContext } from "../_core/context";
import { getDb } from "../db";
import { bulkUploadSessions, bulkUploadChunks } from "../../drizzle/schema-bulk-upload";
import { orgMemberships } from "../../drizzle/schema-personas";
import { sha256Hex } from "./bulk-ingest";

export const CHUNK_MAX_BYTES = 10 * 1024 * 1024; // express.raw limit "10mb"

async function assertOrgMemberForChunk(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, userId: string, orgId: string): Promise<boolean> {
  const rows = await db.select({ role: orgMemberships.role }).from(orgMemberships)
    .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)))
    .limit(1);
  const m = rows[0];
  return !!m && ["owner", "staff"].includes(m.role);
}

export async function handleChunkUpload(req: Request, res: Response): Promise<void> {
  try {
    const db = await getDb();
    if (!db) {
      res.status(503).json({ error: "Database unavailable" });
      return;
    }
    // Authenticate via the same context creation as tRPC (cookie or Bearer).
    let ctx;
    try {
      ctx = await createContext({ req, res } as Parameters<typeof createContext>[0]);
    } catch {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!ctx.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const sessionId = req.params.sessionId;
    const chunkIndex = Number.parseInt(req.params.chunkIndex, 10);
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
      res.status(400).json({ error: "Invalid chunk index" });
      return;
    }
    const session = (await db.select().from(bulkUploadSessions)
      .where(eq(bulkUploadSessions.id, sessionId)).limit(1))[0];
    if (!session) {
      res.status(404).json({ error: "Upload session not found" });
      return;
    }
    if (!(await assertOrgMemberForChunk(db, ctx.user.id, session.orgId))) {
      res.status(403).json({ error: "You are not an authorized member of this organization" });
      return;
    }
    if (session.status !== "uploading") {
      res.status(409).json({ error: `Session is ${session.status}; chunks only accepted while 'uploading'` });
      return;
    }
    if (chunkIndex >= session.totalChunks) {
      res.status(400).json({ error: `Chunk index ${chunkIndex} out of range (totalChunks=${session.totalChunks})` });
      return;
    }
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (body.length === 0 || body.length > CHUNK_MAX_BYTES) {
      res.status(400).json({ error: `Chunk body must be 1..${CHUNK_MAX_BYTES} bytes` });
      return;
    }
    const declared = (req.header("x-chunk-sha256") ?? "").toLowerCase();
    const actual = sha256Hex(body);
    if (!/^[0-9a-f]{64}$/.test(declared) || declared !== actual) {
      res.status(400).json({ error: "x-chunk-sha256 header missing or does not match body" });
      return;
    }

    // Idempotent upsert: re-PUT of the same chunk replaces bytes but only
    // increments chunks_received on first insert.
    const result = await db.transaction(async (tx) => {
      const existing = (await tx.select({ sha256: bulkUploadChunks.sha256 }).from(bulkUploadChunks)
        .where(and(eq(bulkUploadChunks.sessionId, sessionId), eq(bulkUploadChunks.chunkIndex, chunkIndex)))
        .limit(1))[0];
      if (existing) {
        if (existing.sha256 !== actual) {
          await tx.update(bulkUploadChunks)
            .set({ sha256: actual, byteLength: body.length, data: body, receivedAt: new Date() })
            .where(and(eq(bulkUploadChunks.sessionId, sessionId), eq(bulkUploadChunks.chunkIndex, chunkIndex)));
        }
        return { inserted: false as const };
      }
      await tx.insert(bulkUploadChunks).values({
        sessionId,
        chunkIndex,
        sha256: actual,
        byteLength: body.length,
        data: body,
      });
      const upd = await tx.update(bulkUploadSessions)
        .set({ chunksReceived: session.chunksReceived + 1, updatedAt: new Date() })
        .where(eq(bulkUploadSessions.id, sessionId));
      void upd;
      return { inserted: true as const };
    });

    res.status(result.inserted ? 201 : 200).json({
      sessionId,
      chunkIndex,
      sha256: actual,
      byteLength: body.length,
      chunksReceived: result.inserted ? session.chunksReceived + 1 : session.chunksReceived,
      totalChunks: session.totalChunks,
    });
  } catch (err) {
    console.error("[bulk-upload] chunk PUT failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Chunk upload failed" });
  }
}
