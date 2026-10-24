/**
 * server/ingest/bulk-ingest.ts
 *
 * Phase 19: checkpointed in-process ingestion runner for chunked bulk
 * uploads (bulk_upload_sessions / bulk_upload_chunks).
 *
 * Semantics:
 *  - startIngestion(sessionId): fire-and-forget; idempotent — safe to call
 *    again after restart or on an already-running session (guarded by the
 *    status column transition uploading->ready->ingesting).
 *  - resumePendingSessions(): called once at server boot (gated by
 *    BULK_INGEST_ENABLED !== "false"); picks up sessions left in 'ready' or
 *    'ingesting' and resumes from the persisted watermark.
 *  - cancelIngestion(sessionId): cooperative stop via an in-memory set +
 *    DB status check each batch boundary.
 *
 * Watermark model: `watermark_chunk` = NEXT chunk index to process; chunks
 * with `ingested = true` are skipped. `watermark_offset` = number of
 * trailing bytes of the previous chunk that were carried over as an
 * incomplete line/segment, so the carry buffer is reconstructible after a
 * restart (re-read the tail of chunk watermark_chunk-1). All counter +
 * watermark updates happen in ONE transaction per batch.
 *
 * Parser reuse (no re-implementation): parseNdjson / normalizeFhirResources
 * (server/emr/bulk-import.ts), parse837p / claim837ToNormalized
 * (server/edi/claim837.ts), parse835 / x12AmountToCents
 * (server/edi/remittance835.ts), parseCsv (server/csv-import.ts — WITHOUT
 * the CSV_IMPORT_ROW_CAP=1000; that cap lives in validateDisputeRows and is
 * not inherited here).
 *
 * New mapping logic in this phase (minimal, documented):
 *  - remittance835ToNormalized(): 835 remittance line -> NormalizedPracticeClaim
 *    (design §3.4; no pre-existing 835->practice_claims stager exists).
 *  - csvClaimRowToNormalized(): header-keyed CSV row -> NormalizedPracticeClaim
 *    (the existing CSV path in csv-import.ts targets DISPUTES, not
 *    practice_claims, so no reusable claim mapper existed — TBD choice).
 *
 * Honesty: proven at journey scale (thousands of rows). Million-row
 * throughput/memory behavior (bytea/TOAST pressure, multi-hour runner
 * stability) is UNPROVEN — no staging infra exists to load-test it.
 */
import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import {
  bulkUploadSessions,
  bulkUploadChunks,
  claimQuarantine,
  type BulkUploadSession,
} from "../../drizzle/schema-bulk-upload";
import {
  parseNdjson,
  normalizeFhirResources,
  stageClaims,
  BulkImportError,
  type NormalizedPracticeClaim,
} from "../emr/bulk-import";
import { parse837p, claim837ToNormalized, Claim837ParseError } from "../edi/claim837";
import {
  parse835,
  x12AmountToCents,
  Remittance835ParseError,
  type Remittance835Line,
} from "../edi/remittance835";
import { parseCsv } from "../csv-import";

/** Stage batch size mandated by the Phase-19 design. */
export const INGEST_BATCH_SIZE = 500;
/** Quarantined raw payloads are capped at 64KB server-side. */
export const QUARANTINE_PAYLOAD_CAP = 64 * 1024;

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type StageSource = "fhir_bulk" | "csv" | "x12_837";

const cancelledSessions = new Set<string>();
const runningSessions = new Set<string>();

export function sha256Hex(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Streaming sha256 over ordered chunk rows (used by finalizeUpload). */
export async function assembleSha256(db: Db, sessionId: string): Promise<string> {
  const chunks = await db
    .select({ chunkIndex: bulkUploadChunks.chunkIndex, data: bulkUploadChunks.data })
    .from(bulkUploadChunks)
    .where(eq(bulkUploadChunks.sessionId, sessionId))
    .orderBy(asc(bulkUploadChunks.chunkIndex));
  const hash = createHash("sha256");
  for (const c of chunks) hash.update(c.data);
  return hash.digest("hex");
}

function stageSourceFor(fileType: string): StageSource {
  if (fileType === "ndjson") return "fhir_bulk";
  if (fileType === "csv") return "csv";
  // 837 AND 835 both stage under "x12_837" (design §3.4 default: the
  // PracticeClaimSource union is unchanged; the session row records the
  // actual fileType).
  return "x12_837";
}

/** 835 remittance line -> NormalizedPracticeClaim (design §3.4 integration seam). */
export function remittance835ToNormalized(line: Remittance835Line): NormalizedPracticeClaim {
  return {
    claimId: line.claimId,
    patientRef: null,
    planType: null,
    serviceCategory: null,
    patientState: null,
    facilityState: null,
    serviceDate: null,
    serviceEndDate: null,
    placeOfService: null,
    networkStatus: null,
    noticeConsentStatus: null,
    initialPaymentDate: null,
    denialDate: null,
    priorPaymentDeterminationDate: null,
    cptCodes: line.cptCode ? [line.cptCode] : [],
    modifiers: [],
    diagnoses: [],
    payerId: line.payerId,
    payerName: null,
    planIdentifier: null,
    renderingNpi: line.npi,
    billingNpi: null,
    tin: null,
    billedCents: line.billedCents,
    allowedCents: line.allowedCents,
    // Remittance835Line carries billed/allowed (CLP03/CLP04); a separate
    // paid amount is not exposed by the existing parser — honest null.
    paidCents: null,
    sourceProvenance: {
      claimId: { source: "edi" as const, detail: "835 CLP01" },
      billedCents: { source: "edi" as const, detail: "835 CLP03" },
      allowedCents: { source: "edi" as const, detail: "835 CLP04" },
      paidCents: { source: "edi" as const, detail: "835 CLP04/SVC03" },
    },
    sourceResourceRefs: [`x12-835:${line.claimId}`],
  };
}

/**
 * Header-keyed CSV row -> NormalizedPracticeClaim. Recognized headers
 * (case/space/underscore-insensitive): claim_id, patient_ref, service_date,
 * service_end_date, cpt_codes (| or ; separated), diagnoses, payer_id,
 * payer_name, rendering_npi, billing_npi, tin, billed_cents (or
 * billed_amount dollars), allowed_cents, paid_cents, place_of_service,
 * patient_state, facility_state.
 */
export function csvClaimRowToNormalized(headers: string[], vals: string[]): NormalizedPracticeClaim {
  const norm = (h: string) => h.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const map = new Map<string, string>();
  headers.forEach((h, i) => map.set(norm(h), (vals[i] ?? "").trim()));
  const get = (k: string) => map.get(k) || "";
  const list = (v: string) => v.split(/[|;]/).map(s => s.trim()).filter(Boolean);
  const cents = (v: string): number | null => {
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : null;
  };
  const dollarsToCents = (v: string): number | null => {
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  };
  const billed = cents(get("billed_cents")) ?? dollarsToCents(get("billed_amount"));
  if (!get("claim_id")) throw new BulkImportError("csv row lacks claim_id");
  return {
    claimId: get("claim_id"),
    patientRef: get("patient_ref") || null,
    planType: null,
    serviceCategory: null,
    patientState: get("patient_state") || null,
    facilityState: get("facility_state") || null,
    serviceDate: get("service_date") || null,
    serviceEndDate: get("service_end_date") || null,
    placeOfService: get("place_of_service") || null,
    networkStatus: null,
    noticeConsentStatus: null,
    initialPaymentDate: null,
    denialDate: null,
    priorPaymentDeterminationDate: null,
    cptCodes: list(get("cpt_codes") || get("cpt_code")),
    modifiers: list(get("modifiers")),
    diagnoses: list(get("diagnoses")),
    payerId: get("payer_id") || null,
    payerName: get("payer_name") || null,
    planIdentifier: get("plan_identifier") || null,
    renderingNpi: get("rendering_npi") || null,
    billingNpi: get("billing_npi") || null,
    tin: get("tin") || null,
    billedCents: billed,
    allowedCents: cents(get("allowed_cents")),
    paidCents: cents(get("paid_cents")),
    sourceProvenance: { claimId: { source: "manual" as const, detail: "csv bulk upload" } },
    sourceResourceRefs: [`csv:${get("claim_id")}`],
  };
}

/** Split an accumulated text buffer into complete lines; returns [lines, remainder]. */
export function splitCompleteLines(buffer: string): { lines: string[]; remainder: string } {
  const idx = buffer.lastIndexOf("\n");
  if (idx < 0) return { lines: [], remainder: buffer };
  const complete = buffer.slice(0, idx + 1);
  return { lines: complete.split("\n").filter(l => l.length > 0), remainder: buffer.slice(idx + 1) };
}

async function quarantineRow(
  db: Db,
  session: BulkUploadSession,
  rowNumber: number,
  rawPayload: string,
  err: unknown,
  missingFields: unknown[] = [],
): Promise<void> {
  await db.insert(claimQuarantine).values({
    id: randomUUID(),
    sessionId: session.id,
    orgId: session.orgId,
    rowNumber,
    rawPayload: rawPayload.slice(0, QUARANTINE_PAYLOAD_CAP),
    errorReason: err instanceof Error ? err.message.slice(0, 2000) : String(err).slice(0, 2000),
    missingFields: missingFields as never,
  });
}

interface RunnerState {
  carry: string;          // incomplete line/segment carried across chunks
  pending: NormalizedPracticeClaim[]; // claims waiting for the next 500-batch
  processed: number;
  accepted: number;
  quarantined: number;
  /** Absolute row number of the next row (1-based, across the whole file). */
  rowNumber: number;
  csvHeaders: string[] | null;
  /** Accumulated content for 837/835 (parsed once at final chunk — see header). */
  x12Accum: string;
}

const immediate = () => new Promise<void>(r => setImmediate(r));

async function flushBatch(db: Db, session: BulkUploadSession, st: RunnerState): Promise<void> {
  if (st.pending.length === 0) return;
  const claims = st.pending;
  st.pending = [];
  const staged = await stageClaims(
    db,
    session.orgId,
    stageSourceFor(session.fileType),
    session.id,
    null,
    claims,
    { batchSize: INGEST_BATCH_SIZE },
  );
  st.accepted += staged.inserted;
  await persistProgress(db, session.id, st);
}

async function persistProgress(db: Db, sessionId: string, st: RunnerState, watermarkChunk?: number, watermarkOffset?: number): Promise<void> {
  await db.update(bulkUploadSessions).set({
    rowsProcessed: st.processed,
    rowsAccepted: st.accepted,
    rowsQuarantined: st.quarantined,
    ...(watermarkChunk !== undefined ? { watermarkChunk } : {}),
    ...(watermarkOffset !== undefined ? { watermarkOffset } : {}),
    updatedAt: new Date(),
  }).where(eq(bulkUploadSessions.id, sessionId));
}

async function isCancelled(db: Db, sessionId: string): Promise<boolean> {
  if (cancelledSessions.has(sessionId)) return true;
  const row = (await db.select({ status: bulkUploadSessions.status })
    .from(bulkUploadSessions).where(eq(bulkUploadSessions.id, sessionId)).limit(1))[0];
  return row?.status === "cancelled";
}

/** Parse one ndjson line into normalized claims (throws on bad line). */
function ndjsonLineToClaims(line: string): NormalizedPracticeClaim[] {
  const resources = parseNdjson(line);
  return normalizeFhirResources(resources).claims;
}

/**
 * Core runner. Exported for tests; normally entered via startIngestion /
 * resumePendingSessions.
 */
export async function runIngestion(sessionId: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable — cannot run bulk ingestion");
  if (runningSessions.has(sessionId)) return; // idempotent re-entry
  runningSessions.add(sessionId);
  try {
    const session = (await db.select().from(bulkUploadSessions)
      .where(eq(bulkUploadSessions.id, sessionId)).limit(1))[0];
    if (!session) return;
    if (session.status !== "ready" && session.status !== "ingesting") return;
    // Guarded transition: only flip ready->ingesting; resume keeps ingesting.
    await db.update(bulkUploadSessions).set({ status: "ingesting", updatedAt: new Date() })
      .where(and(eq(bulkUploadSessions.id, sessionId), inArray(bulkUploadSessions.status, ["ready", "ingesting"])));

    const st: RunnerState = {
      carry: "",
      pending: [],
      processed: session.rowsProcessed,
      accepted: session.rowsAccepted,
      quarantined: session.rowsQuarantined,
      rowNumber: session.rowsProcessed + 1,
      csvHeaders: null,
      x12Accum: "",
    };
    // Rebuild the carry buffer from the previous chunk's un-carried tail.
    if (session.watermarkOffset > 0 && session.watermarkChunk > 0) {
      const prev = (await db.select({ data: bulkUploadChunks.data }).from(bulkUploadChunks)
        .where(and(eq(bulkUploadChunks.sessionId, sessionId), eq(bulkUploadChunks.chunkIndex, session.watermarkChunk - 1)))
        .limit(1))[0];
      if (prev) st.carry = prev.data.subarray(prev.data.length - session.watermarkOffset).toString("utf8");
      if (session.fileType === "csv") {
        // CSV header reconstruction: headers were consumed from chunk 0's first line.
        const first = (await db.select({ data: bulkUploadChunks.data }).from(bulkUploadChunks)
          .where(and(eq(bulkUploadChunks.sessionId, sessionId), eq(bulkUploadChunks.chunkIndex, 0))).limit(1))[0];
        if (first) {
          const headerLine = first.data.toString("utf8").split("\n", 1)[0];
          st.csvHeaders = parseCsv(headerLine + "\n").rows[0] ?? null;
        }
      }
    } else if (session.fileType === "csv" && session.watermarkChunk > 0) {
      const first = (await db.select({ data: bulkUploadChunks.data }).from(bulkUploadChunks)
        .where(and(eq(bulkUploadChunks.sessionId, sessionId), eq(bulkUploadChunks.chunkIndex, 0))).limit(1))[0];
      if (first) st.csvHeaders = parseCsv(first.data.toString("utf8").split("\n", 1)[0] + "\n").rows[0] ?? null;
    }

    const chunks = await db.select().from(bulkUploadChunks)
      .where(eq(bulkUploadChunks.sessionId, sessionId))
      .orderBy(asc(bulkUploadChunks.chunkIndex));

    for (const chunk of chunks) {
      if (chunk.chunkIndex < session.watermarkChunk || chunk.ingested) continue;
      if (await isCancelled(db, sessionId)) {
        cancelledSessions.delete(sessionId);
        return; // status already 'cancelled' in DB
      }
      const text = chunk.data.toString("utf8");

      if (session.fileType === "ndjson" || session.fileType === "csv") {
        const { lines, remainder } = splitCompleteLines(st.carry + text);
        for (const line of lines) {
          const trimmed = line.replace(/\r$/, "");
          if (!trimmed.trim()) continue;
          try {
            if (session.fileType === "ndjson") {
              st.pending.push(...ndjsonLineToClaims(trimmed));
            } else {
              if (!st.csvHeaders) {
                st.csvHeaders = parseCsv(trimmed + "\n").rows[0] ?? [];
                continue;
              }
              const parsed = parseCsv([st.csvHeaders.join(","), trimmed].join("\n"));
              const vals = parsed.rows[1];
              if (!vals) throw new BulkImportError("csv row did not parse");
              st.pending.push(csvClaimRowToNormalized(st.csvHeaders, vals));
            }
            st.processed++;
            st.rowNumber++;
          } catch (err) {
            if (err instanceof BulkImportError || err instanceof Error) {
              st.processed++;
              st.quarantined++;
              await quarantineRow(db, session, st.rowNumber, trimmed, err);
              st.rowNumber++;
            } else throw err;
          }
          if (st.pending.length >= INGEST_BATCH_SIZE) {
            await flushBatch(db, session, st);
            await immediate();
          }
        }
        st.carry = remainder;
        // Checkpoint: chunk ingested + watermark + counters in ONE transaction.
        await db.transaction(async (tx) => {
          await tx.update(bulkUploadChunks).set({ ingested: true })
            .where(and(eq(bulkUploadChunks.sessionId, sessionId), eq(bulkUploadChunks.chunkIndex, chunk.chunkIndex)));
          await persistProgress(tx as unknown as Db, sessionId, st, chunk.chunkIndex + 1, Buffer.byteLength(remainder, "utf8"));
        });
        await immediate();
      } else {
        // 837 / 835: X12 envelopes (ISA/GS/ST) are not safely parseable from
        // partial content, so content accumulates and parses once at the
        // final chunk. Memory bound = file size; acceptable at journey scale,
        // UNPROVEN for very large 837 files (documented limitation).
        st.x12Accum += text;
        const isLast = chunk.chunkIndex === session.totalChunks - 1;
        if (isLast) {
          try {
            if (session.fileType === "837") {
              const claims837 = parse837p(st.x12Accum);
              for (const c of claims837) {
                try {
                  const n = claim837ToNormalized(c);
                  st.pending.push({
                    claimId: n.claimId,
                    patientRef: n.patientRef,
                    planType: null,
                    serviceCategory: null,
                    patientState: n.patientState,
                    facilityState: n.facilityState,
                    serviceDate: n.serviceDate,
                    serviceEndDate: n.serviceEndDate,
                    placeOfService: n.placeOfService,
                    networkStatus: null,
                    noticeConsentStatus: null,
                    initialPaymentDate: null,
                    denialDate: null,
                    priorPaymentDeterminationDate: null,
                    cptCodes: n.cptCodes,
                    modifiers: n.modifiers,
                    diagnoses: n.diagnoses,
                    payerId: n.payerId,
                    payerName: n.payerName,
                    planIdentifier: null,
                    renderingNpi: n.renderingNpi,
                    billingNpi: n.billingNpi,
                    tin: n.tin,
                    billedCents: n.billedCents,
                    allowedCents: null,
                    paidCents: null,
                    sourceProvenance: { claimId: { source: "edi" as const, detail: "837P CLM01 (bulk)" } },
                    sourceResourceRefs: [`x12-837:${n.claimId}`],
                  });
                } catch (err) {
                  st.quarantined++;
                  await quarantineRow(db, session, st.rowNumber, `CLM*${c.claimId}`, err);
                }
                st.processed++;
                st.rowNumber++;
                if (st.pending.length >= INGEST_BATCH_SIZE) {
                  await flushBatch(db, session, st);
                  await immediate();
                }
              }
            } else {
              const lines835 = parse835(st.x12Accum);
              for (const line of lines835) {
                try {
                  st.pending.push(remittance835ToNormalized(line));
                } catch (err) {
                  st.quarantined++;
                  await quarantineRow(db, session, st.rowNumber, `CLP*${line.claimId}`, err);
                }
                st.processed++;
                st.rowNumber++;
                if (st.pending.length >= INGEST_BATCH_SIZE) {
                  await flushBatch(db, session, st);
                  await immediate();
                }
              }
            }
          } catch (err) {
            if (err instanceof Claim837ParseError || err instanceof Remittance835ParseError) {
              st.quarantined++;
              await quarantineRow(db, session, 1, st.x12Accum.slice(0, QUARANTINE_PAYLOAD_CAP), err);
              st.processed++;
            } else throw err;
          }
        }
        await db.transaction(async (tx) => {
          await tx.update(bulkUploadChunks).set({ ingested: true })
            .where(and(eq(bulkUploadChunks.sessionId, sessionId), eq(bulkUploadChunks.chunkIndex, chunk.chunkIndex)));
          await persistProgress(tx as unknown as Db, sessionId, st, chunk.chunkIndex + 1, 0);
        });
        await immediate();
      }
    }

    // Final flush: any remaining pending claims + trailing carry (a final
    // line without a terminating newline is still a valid row).
    if (st.carry.trim() && (session.fileType === "ndjson" || session.fileType === "csv")) {
      const trimmed = st.carry.replace(/\r$/, "");
      try {
        if (session.fileType === "ndjson") {
          st.pending.push(...ndjsonLineToClaims(trimmed));
        } else if (st.csvHeaders) {
          const parsed = parseCsv([st.csvHeaders.join(","), trimmed].join("\n"));
          const vals = parsed.rows[1];
          if (!vals) throw new BulkImportError("csv row did not parse");
          st.pending.push(csvClaimRowToNormalized(st.csvHeaders, vals));
        }
        st.processed++;
      } catch (err) {
        st.processed++;
        st.quarantined++;
        await quarantineRow(db, session, st.rowNumber, trimmed, err);
      }
      st.carry = "";
    }
    await flushBatch(db, session, st);

    await db.update(bulkUploadSessions).set({
      status: "completed",
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(bulkUploadSessions.id, sessionId));
  } catch (err) {
    const db2 = await getDb();
    if (db2) {
      await db2.update(bulkUploadSessions).set({
        status: "failed",
        errorMessage: err instanceof Error ? err.message.slice(0, 4000) : String(err),
        updatedAt: new Date(),
      }).where(eq(bulkUploadSessions.id, sessionId)).catch(() => undefined);
    }
    throw err;
  } finally {
    runningSessions.delete(sessionId);
  }
}

/** Fire-and-forget entry point; safe to call repeatedly. */
export async function startIngestion(sessionId: string): Promise<void> {
  void runIngestion(sessionId).catch(err =>
    console.error(`[bulk-ingest] session ${sessionId} failed:`, err instanceof Error ? err.message : err),
  );
}

/** Boot hook: resume sessions left in 'ready'/'ingesting' after a restart. */
export async function resumePendingSessions(): Promise<void> {
  if (process.env.BULK_INGEST_ENABLED === "false") return;
  const db = await getDb();
  if (!db) return;
  const pending = await db.select({ id: bulkUploadSessions.id, status: bulkUploadSessions.status })
    .from(bulkUploadSessions)
    .where(inArray(bulkUploadSessions.status, ["ready", "ingesting"]));
  for (const s of pending) {
    console.log(`[bulk-ingest] resuming session ${s.id} (status=${s.status})`);
    await startIngestion(s.id);
  }
}

/** Cooperative cancellation: flag + DB status; runner checks each boundary. */
export async function cancelIngestion(sessionId: string): Promise<void> {
  cancelledSessions.add(sessionId);
  const db = await getDb();
  if (db) {
    await db.update(bulkUploadSessions).set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(bulkUploadSessions.id, sessionId), inArray(bulkUploadSessions.status, ["uploading", "ready", "ingesting"])));
  }
}

/** Test hook: wait for a session to leave 'ready'/'ingesting' (poll). */
export async function waitForSessionTerminal(sessionId: string, timeoutMs = 60_000): Promise<BulkUploadSession> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const s = (await db.select().from(bulkUploadSessions).where(eq(bulkUploadSessions.id, sessionId)).limit(1))[0];
    if (!s) throw new Error(`session ${sessionId} not found`);
    if (["completed", "failed", "cancelled"].includes(s.status)) return s;
    if (Date.now() > deadline) throw new Error(`timeout waiting for terminal state (status=${s.status})`);
    await new Promise(r => setTimeout(r, 100));
  }
}

/** Exposed for tests. */
export const __runnerInternals = { runningSessions, cancelledSessions };
