/**
 * client/src/lib/bulk-upload.ts — Phase 19-FE.
 *
 * Pure, framework-free core of the submitter chunked-upload client. The
 * React tab (pages/submitter/BulkUploadTab.tsx) wires this to the tRPC
 * client and the browser file picker; the logic here is dependency-injected
 * (fetch, storage, crypto) so it is unit-testable under Node and mirrors
 * the exact wire contract proven by scripts/functional-p19.mts:
 *
 *   1. bulkUpload.createUploadSession (tRPC) — totalChunks must equal
 *      ceil(sizeBytes / 8 MiB); whole-file sha256 declared up front.
 *   2. PUT /api/bulk-upload/:sessionId/chunks/:chunkIndex (raw route,
 *      cookie auth, `x-chunk-sha256` header, ≤ 10 MiB per chunk).
 *      Chunks may be sent in any order; re-PUT of the same chunk is
 *      idempotent (201 first insert, 200 on replay).
 *   3. bulkUpload.finalizeUpload (tRPC) — idempotent; kicks ingestion.
 *   4. bulkUpload.getUploadStatus polling drives the progress UI.
 *
 * Resume: after every successful chunk PUT the caller persists the session
 * descriptor + uploaded chunk indexes via the injected storage; on reload,
 * the descriptor is reloaded and already-uploaded chunks are skipped.
 *
 * Honesty: chunking/resume correctness is unit-tested here and the wire
 * contract is EXECUTED-VERIFIED server-side (journeys + functional-p19);
 * million-row browser uploads are UNPROVEN (no staging infra).
 */

export const CHUNK_SIZE_BYTES = 8 * 1024 * 1024; // must match server CHUNK_SIZE_BYTES

export type BulkUploadFileType = "csv" | "ndjson" | "837" | "835";

/** Persisted resume descriptor (localStorage). */
export interface UploadResumeState {
  version: 1;
  orgId: string;
  sessionId: string;
  fileName: string;
  fileType: BulkUploadFileType;
  sizeBytes: number;
  sha256: string;
  totalChunks: number;
  /** Chunk indexes confirmed by the server (201/200 responses). */
  uploadedChunks: number[];
  updatedAt: string;
}

export interface KVStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const RESUME_KEY_PREFIX = "bulk-upload:session:";

export function resumeKey(orgId: string): string {
  return `${RESUME_KEY_PREFIX}${orgId}`;
}

export function saveResumeState(storage: KVStorage, state: UploadResumeState): void {
  storage.setItem(resumeKey(state.orgId), JSON.stringify({ ...state, updatedAt: new Date().toISOString() }));
}

export function loadResumeState(storage: KVStorage, orgId: string): UploadResumeState | null {
  const raw = storage.getItem(resumeKey(orgId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as UploadResumeState;
    if (parsed.version !== 1 || parsed.orgId !== orgId || !parsed.sessionId) return null;
    if (!Array.isArray(parsed.uploadedChunks)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearResumeState(storage: KVStorage, orgId: string): void {
  storage.removeItem(resumeKey(orgId));
}

/** Whole-file / chunk sha256 (hex). Uses WebCrypto in browser and Node ≥ 19. */
export async function sha256Hex(data: Uint8Array | ArrayBuffer): Promise<string> {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("WebCrypto subtle API unavailable (secure context required)");
  const digest = await subtle.digest("SHA-256", buf as unknown as BufferSource);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function computeTotalChunks(sizeBytes: number): number {
  return Math.max(1, Math.ceil(sizeBytes / CHUNK_SIZE_BYTES));
}

export type ChunkSource = {
  /** Byte length of the whole file. */
  size: number;
  /** Return bytes [start, end) — File.slice().arrayBuffer() in the browser. */
  slice(start: number, end: number): Promise<Uint8Array>;
};

/** Wrap a browser File/Blob as a ChunkSource. */
export function fileChunkSource(file: { size: number; slice(s: number, e: number): Blob }): ChunkSource {
  return {
    size: file.size,
    async slice(start, end) {
      const ab = await file.slice(start, end).arrayBuffer();
      return new Uint8Array(ab);
    },
  };
}

export interface ChunkUploadResult {
  chunkIndex: number;
  status: number;
  chunksReceived: number;
  totalChunks: number;
}

export type FetchLike = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array;
  credentials?: "include";
}) => Promise<{ status: number; json(): Promise<unknown> }>;

export interface UploadLoopOptions {
  sessionId: string;
  source: ChunkSource;
  totalChunks: number;
  /** Chunk indexes to skip (already confirmed by the server). */
  skip?: ReadonlySet<number>;
  fetchImpl: FetchLike;
  /** Base URL prefix; defaults to same-origin (""). */
  baseUrl?: string;
  /** Sequential by default; pass a shuffled array to exercise out-of-order. */
  order?: number[];
  onChunk?: (r: ChunkUploadResult) => void;
  /** Cooperative cancellation between chunks. */
  isCancelled?: () => boolean;
}

export class ChunkUploadError extends Error {
  constructor(
    message: string,
    public readonly chunkIndex: number,
    public readonly httpStatus: number,
  ) {
    super(message);
    this.name = "ChunkUploadError";
  }
}

/**
 * Upload every chunk once, sequentially, each with its own sha256 header.
 * Returns the set of chunk indexes confirmed during THIS run (excluding
 * skipped ones). Throws ChunkUploadError on the first non-2xx response —
 * the caller persists progress per chunk, so a retry simply resumes.
 */
export async function uploadChunks(opts: UploadLoopOptions): Promise<number[]> {
  const { sessionId, source, totalChunks, fetchImpl } = opts;
  const base = opts.baseUrl ?? "";
  const order = opts.order ?? [...Array(totalChunks).keys()];
  const confirmed: number[] = [];
  for (const idx of order) {
    if (opts.isCancelled?.()) break;
    if (idx < 0 || idx >= totalChunks) throw new ChunkUploadError(`chunk index ${idx} out of range`, idx, 0);
    if (opts.skip?.has(idx)) continue;
    const body = await source.slice(idx * CHUNK_SIZE_BYTES, Math.min((idx + 1) * CHUNK_SIZE_BYTES, source.size));
    const hash = await sha256Hex(body);
    const res = await fetchImpl(`${base}/api/bulk-upload/${sessionId}/chunks/${idx}`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream", "x-chunk-sha256": hash },
      body,
      credentials: "include",
    });
    const payload = (await res.json().catch(() => ({}))) as { chunksReceived?: number; totalChunks?: number; error?: string };
    if (res.status !== 200 && res.status !== 201) {
      throw new ChunkUploadError(payload.error ?? `Chunk ${idx} upload failed (HTTP ${res.status})`, idx, res.status);
    }
    confirmed.push(idx);
    opts.onChunk?.({
      chunkIndex: idx,
      status: res.status,
      chunksReceived: payload.chunksReceived ?? confirmed.length,
      totalChunks: payload.totalChunks ?? totalChunks,
    });
  }
  return confirmed;
}

/** Detect file type from the file name; returns null when unrecognized. */
export function detectFileType(fileName: string): BulkUploadFileType | null {
  const n = fileName.toLowerCase();
  if (n.endsWith(".csv")) return "csv";
  if (n.endsWith(".ndjson") || n.endsWith(".jsonl")) return "ndjson";
  if (n.endsWith(".835") || n.endsWith(".era")) return "835";
  if (n.endsWith(".837") || n.endsWith(".837p") || n.endsWith(".x12") || n.endsWith(".edi")) return "837";
  return null;
}

/** Human-friendly byte formatting (binary units). */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KiB", "MiB", "GiB"];
  let v = n;
  let u = -1;
  do {
    v /= 1024;
    u++;
  } while (v >= 1024 && u < units.length - 1);
  return `${v.toFixed(1)} ${units[u]}`;
}
