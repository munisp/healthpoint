/**
 * client/src/lib/bulk-upload.test.ts — Phase 19-FE unit tests for the
 * chunked-upload client core. Runs under the repo's node-environment
 * vitest (WebCrypto is available in Node ≥ 19); fetch and storage are
 * injected fakes. The HTTP shapes asserted here mirror
 * scripts/functional-p19.mts and server/ingest/chunk-handler.ts.
 */
import { describe, expect, it } from "vitest";
import {
  CHUNK_SIZE_BYTES,
  ChunkUploadError,
  clearResumeState,
  computeTotalChunks,
  detectFileType,
  formatBytes,
  loadResumeState,
  resumeKey,
  saveResumeState,
  sha256Hex,
  uploadChunks,
  type ChunkSource,
  type FetchLike,
  type KVStorage,
  type UploadResumeState,
} from "./bulk-upload";

function memStorage(): KVStorage {
  const m = new Map<string, string>();
  return {
    getItem: k => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => void m.set(k, v),
    removeItem: k => void m.delete(k),
  };
}

function bytesSource(data: Uint8Array): ChunkSource {
  return {
    size: data.length,
    async slice(start, end) {
      return data.subarray(start, end);
    },
  };
}

/** Fake of the raw chunk route: verifies the sha256 header like the server. */
function fakeChunkRoute(opts: { failOn?: number; received201?: Set<number> } = {}) {
  const calls: Array<{ url: string; sha: string; len: number }> = [];
  const stored = opts.received201 ?? new Set<number>();
  const fetchImpl: FetchLike = async (url, init) => {
    const m = /\/api\/bulk-upload\/([^/]+)\/chunks\/(\d+)$/.exec(url);
    const idx = Number(m?.[2]);
    const body = init.body!;
    const sha = await sha256Hex(body);
    calls.push({ url, sha: init.headers["x-chunk-sha256"], len: body.length });
    if (opts.failOn === idx && !stored.has(idx)) {
      return { status: 500, json: async () => ({ error: "boom" }) };
    }
    if (init.headers["x-chunk-sha256"] !== sha) {
      return { status: 400, json: async () => ({ error: "x-chunk-sha256 header missing or does not match body" }) };
    }
    const inserted = !stored.has(idx);
    stored.add(idx);
    return {
      status: inserted ? 201 : 200,
      json: async () => ({ chunkIndex: idx, chunksReceived: stored.size, totalChunks: 3 }),
    };
  };
  return { fetchImpl, calls, stored };
}

describe("chunk sizing + sha256", () => {
  it("computes totalChunks as ceil(size / 8MiB), matching the server rule", () => {
    expect(computeTotalChunks(1)).toBe(1);
    expect(computeTotalChunks(CHUNK_SIZE_BYTES)).toBe(1);
    expect(computeTotalChunks(CHUNK_SIZE_BYTES + 1)).toBe(2);
    expect(computeTotalChunks(25 * 1024 * 1024)).toBe(4);
  });

  it("sha256Hex matches the known SHA-256 test vector", async () => {
    // SHA-256("abc") — well-known vector.
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("detectFileType maps extensions honestly and rejects unknown ones", () => {
    expect(detectFileType("claims.csv")).toBe("csv");
    expect(detectFileType("feed.NDJSON")).toBe("ndjson");
    expect(detectFileType("remit.835")).toBe("835");
    expect(detectFileType("claim.837p")).toBe("837");
    expect(detectFileType("notes.txt")).toBeNull();
  });
});

describe("uploadChunks wire contract", () => {
  it("PUTs each chunk once with a correct x-chunk-sha256 header", async () => {
    const data = new Uint8Array(CHUNK_SIZE_BYTES + 1234).fill(7);
    const { fetchImpl, calls } = fakeChunkRoute();
    const confirmed = await uploadChunks({
      sessionId: "sess-1",
      source: bytesSource(data),
      totalChunks: 2,
      fetchImpl,
    });
    expect(confirmed).toEqual([0, 1]);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("/api/bulk-upload/sess-1/chunks/0");
    expect(calls[1].len).toBe(1234);
    for (const c of calls) expect(c.sha).toMatch(/^[0-9a-f]{64}$/);
  });

  it("supports out-of-order upload order (server accepts any order)", async () => {
    const data = new Uint8Array(3 * CHUNK_SIZE_BYTES).fill(1);
    const { fetchImpl, calls } = fakeChunkRoute();
    await uploadChunks({
      sessionId: "s",
      source: bytesSource(data),
      totalChunks: 3,
      order: [2, 0, 1],
      fetchImpl,
    });
    expect(calls.map(c => c.url)).toEqual([
      "/api/bulk-upload/s/chunks/2",
      "/api/bulk-upload/s/chunks/0",
      "/api/bulk-upload/s/chunks/1",
    ]);
  });

  it("skips previously confirmed chunks (resume) and tolerates idempotent 200s", async () => {
    const data = new Uint8Array(2 * CHUNK_SIZE_BYTES).fill(3);
    const { fetchImpl, calls } = fakeChunkRoute({ received201: new Set([0]) });
    const confirmed = await uploadChunks({
      sessionId: "s",
      source: bytesSource(data),
      totalChunks: 2,
      skip: new Set([0]),
      fetchImpl,
    });
    expect(confirmed).toEqual([1]);
    expect(calls).toHaveLength(1);
  });

  it("throws ChunkUploadError on failure so the caller can persist + resume", async () => {
    const data = new Uint8Array(2 * CHUNK_SIZE_BYTES).fill(9);
    const { fetchImpl } = fakeChunkRoute({ failOn: 1 });
    const seen: number[] = [];
    await expect(
      uploadChunks({
        sessionId: "s",
        source: bytesSource(data),
        totalChunks: 2,
        fetchImpl,
        onChunk: r => seen.push(r.chunkIndex),
      }),
    ).rejects.toBeInstanceOf(ChunkUploadError);
    // Chunk 0 succeeded before the failure — resume state can rely on it.
    expect(seen).toEqual([0]);
  });

  it("stops cooperatively when cancelled between chunks", async () => {
    const data = new Uint8Array(3 * CHUNK_SIZE_BYTES).fill(5);
    const { fetchImpl } = fakeChunkRoute();
    let n = 0;
    const confirmed = await uploadChunks({
      sessionId: "s",
      source: bytesSource(data),
      totalChunks: 3,
      fetchImpl,
      onChunk: () => n++,
      isCancelled: () => n >= 1,
    });
    expect(confirmed).toEqual([0]);
  });
});

describe("resume-state persistence", () => {
  const state: UploadResumeState = {
    version: 1,
    orgId: "org-1",
    sessionId: "sess-1",
    fileName: "claims.csv",
    fileType: "csv",
    sizeBytes: 100,
    sha256: "0".repeat(64),
    totalChunks: 1,
    uploadedChunks: [0],
    updatedAt: new Date().toISOString(),
  };

  it("round-trips through injected storage", () => {
    const s = memStorage();
    saveResumeState(s, state);
    const loaded = loadResumeState(s, "org-1");
    expect(loaded?.sessionId).toBe("sess-1");
    expect(loaded?.uploadedChunks).toEqual([0]);
  });

  it("is org-scoped and rejects corrupt payloads", () => {
    const s = memStorage();
    saveResumeState(s, state);
    expect(loadResumeState(s, "org-2")).toBeNull();
    s.setItem(resumeKey("org-1"), "{not json");
    expect(loadResumeState(s, "org-1")).toBeNull();
    s.setItem(resumeKey("org-1"), JSON.stringify({ version: 2 }));
    expect(loadResumeState(s, "org-1")).toBeNull();
  });

  it("clearResumeState removes the entry", () => {
    const s = memStorage();
    saveResumeState(s, state);
    clearResumeState(s, "org-1");
    expect(loadResumeState(s, "org-1")).toBeNull();
  });
});

describe("formatBytes", () => {
  it("formats binary units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(8 * 1024 * 1024)).toBe("8.0 MiB");
  });
});
