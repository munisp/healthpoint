/**
 * server/tests/documents-upload.test.ts
 *
 * Proves documents.upload persists the actual file BYTES to object storage
 * (via storagePut, the same backend as workflow.uploadNoteAttachment and
 * documents.uploadVersion) BEFORE recording the dispute_documents metadata
 * row — previously the procedure recorded metadata only (client-fabricated
 * storageKey/storageUrl) and the bytes never reached storage.
 *
 * Harness mirrors server/tests/documents-upload-version.test.ts (which in
 * turn follows trpc-contract.test.ts / authz-registry.test.ts): real
 * appRouter with boundary mocks, in-memory fake db, storage mocked at the
 * module boundary with an in-memory byte map. "Retrievable" means: the exact
 * bytes handed to storagePut are readable back under the exact s3Key recorded
 * on the inserted document row.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import type { User } from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";

// ── Hoisted in-memory state (visible inside vi.mock factories) ───────────────
const state = vi.hoisted(() => ({
  stored: new Map<string, Buffer>(),
  storageFails: false,
  documents: [] as any[],
  eventLog: [] as any[],
}));

vi.mock("../storage", () => ({
  storagePut: async (key: string, data: Buffer | Uint8Array | string, _ct?: string) => {
    if (state.storageFails) throw new Error("storage backend unavailable");
    state.stored.set(key, Buffer.isBuffer(data) ? data : Buffer.from(data as any));
    return { key, url: `storage://${key}` };
  },
  storageGet: async (key: string) => {
    if (!state.stored.has(key)) throw new Error(`storage object not found: ${key}`);
    return { key, url: `storage://${key}` };
  },
}));

vi.mock("../db", async importOriginal => {
  const mod = await importOriginal<typeof import("../db")>();
  const schema = await vi.importActual<typeof import("../../drizzle/schema")>("../../drizzle/schema");

  const rowsFor = (table: unknown): unknown[] => {
    if (table === schema.disputeDocuments) return state.documents;
    if (table === schema.eventLog) return state.eventLog;
    return [];
  };

  // Chainable query: where()/orderBy() return a thenable that also has limit().
  const makeQuery = (rows: unknown[]): any => ({
    where: () => makeQuery(rows),
    orderBy: () => makeQuery(rows),
    limit: (n: number) => Promise.resolve(rows.slice(0, n)),
    then: (onFulfilled: any, onRejected: any) => Promise.resolve(rows).then(onFulfilled, onRejected),
  });

  // Generic write chains absorbing exactly what documents.upload + the
  // fire-and-forget eventBus outbox path use:
  //   addDocument:      insert(disputeDocuments).values({...})         (no returning)
  //   eventBus outbox:  insert(eventLog).values({...}) + update(eventLog).set(...).where(...)
  const fakeDb = {
    select: () => ({ from: (table: unknown) => makeQuery(rowsFor(table)) }),
    insert: (table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        const row = { ...vals, uploadedAt: new Date() };
        if (table === schema.disputeDocuments) state.documents.push(row);
        if (table === schema.eventLog) state.eventLog.push(row);
        return Promise.resolve();
      },
    }),
    update: (table: unknown) => ({
      set: (vals: Record<string, unknown>) => ({
        where: async () => {
          if (table === schema.eventLog) {
            for (const e of state.eventLog) Object.assign(e, vals);
          }
        },
      }),
    }),
  };

  return {
    ...mod,
    getDb: async () => fakeDb as any,
    // addDocument closes over the module-internal getDb (not the mocked
    // export), so override it with the exact same behavior against the fake:
    // insert the row with a generated id and return that id.
    addDocument: async (data: Record<string, unknown>) => {
      const id = crypto.randomUUID();
      state.documents.push({ ...data, id, uploadedAt: new Date() });
      return id;
    },
  };
});

vi.mock("../authz", async importOriginal => {
  const mod = await importOriginal<typeof import("../authz")>();
  return { ...mod, assertDisputeAccess: vi.fn(async () => undefined) };
});

import { appRouter } from "../routers";

// ── Test context ──────────────────────────────────────────────────────────────
function makeCtx(): TrpcContext {
  const user = {
    id: "user-1",
    name: "Upload Tester",
    email: "upload-tester@example.test",
    passwordHash: null,
    loginMethod: "keycloak",
    role: "user",
    createdAt: new Date(),
    lastSignedIn: new Date(),
    suspendedAt: null,
    suspendedUntil: null,
    suspendReason: null,
  } as unknown as User;
  return { req: { headers: {} } as never, res: {} as never, user };
}

const caller = () => appRouter.createCaller(makeCtx());

const CONTENT = "eob pdf bytes %PDF-1.4 — explanation of benefits exhibit";

function baseInput(fileBase64: string, fileSize: number) {
  return {
    disputeId: "dispute-1",
    fileName: "eob.pdf",
    fileType: "application/pdf",
    documentType: "eob" as const,
    fileSize,
    storageKey: "disputes/dispute-1/test-eob.pdf",
    fileBase64,
    description: "EOB for test",
  };
}

beforeEach(() => {
  state.stored.clear();
  state.storageFails = false;
  state.documents.length = 0;
  state.eventLog.length = 0;
});

describe("documents.upload byte persistence", () => {
  it("persists the uploaded bytes under the recorded s3Key (retrievable)", async () => {
    const fileBase64 = Buffer.from(CONTENT, "utf-8").toString("base64");
    // Deliberately wrong client-reported fileSize: the row must record the
    // TRUE byte length of the persisted payload, not the client's claim.
    const input = baseInput(fileBase64, 999999);
    const docId = await caller().documents.upload(input);

    expect(typeof docId).toBe("string");
    expect(state.documents).toHaveLength(1);
    const row = state.documents[0];
    expect(row.id).toBe(docId);
    expect(row.disputeId).toBe("dispute-1");
    expect(row.s3Key).toBe(input.storageKey);
    expect(row.fileSize).toBe(Buffer.byteLength(CONTENT));
    expect(row.mimeType).toBe("application/pdf");
    expect(row.documentType).toBe("eob");
    expect(row.uploadedBy).toBe("user-1");
    expect(row.description).toBe("EOB for test");

    // Bytes are retrievable under the exact key recorded on the row.
    const stored = state.stored.get(row.s3Key);
    expect(stored).toBeDefined();
    expect(stored!.equals(Buffer.from(CONTENT, "utf-8"))).toBe(true);
    expect(stored!.toString("utf-8")).toBe(CONTENT);
  });

  it("records NO metadata row when the storage write fails (no dangling pointer)", async () => {
    state.storageFails = true;
    await expect(
      caller().documents.upload(
        baseInput(Buffer.from(CONTENT, "utf-8").toString("base64"), CONTENT.length)
      )
    ).rejects.toThrow(/storage backend unavailable/);
    expect(state.documents).toHaveLength(0);
  });

  it("rejects a metadata-only call (missing fileBase64) with BAD_REQUEST", async () => {
    const { fileBase64: _omit, ...metadataOnly } = baseInput("dGVzdA==", 4);
    await expect(
      caller().documents.upload(metadataOnly as any)
    ).rejects.toSatisfy(e => e instanceof TRPCError && e.code === "BAD_REQUEST");
    expect(state.stored.size).toBe(0);
    expect(state.documents).toHaveLength(0);
  });

  it("rejects the legacy contract (storageUrl instead of bytes) with BAD_REQUEST", async () => {
    const { fileBase64: _omit, ...rest } = baseInput("dGVzdA==", 4);
    const legacyCall = { ...rest, storageUrl: "https://storage.invalid/legacy/eob.pdf" };
    await expect(
      caller().documents.upload(legacyCall as any)
    ).rejects.toSatisfy(e => e instanceof TRPCError && e.code === "BAD_REQUEST");
    expect(state.stored.size).toBe(0);
    expect(state.documents).toHaveLength(0);
  });
});
