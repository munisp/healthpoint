/**
 * server/tests/documents-upload-version.test.ts
 *
 * Proves documents.uploadVersion persists the actual file BYTES to object
 * storage (via storagePut, the same backend as workflow.uploadNoteAttachment)
 * before recording the document_versions metadata row — previously the
 * procedure recorded metadata only and the client never sent bytes.
 *
 * Harness follows server/tests/trpc-contract.test.ts (real appRouter with
 * boundary mocks) and server/tests/authz-registry.test.ts (in-memory fake db).
 * Storage is mocked at the module boundary with an in-memory byte map, so
 * "retrievable" means: the exact bytes handed to storagePut are readable back
 * under the exact s3Key recorded on the inserted version row.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import type { User } from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";

// ── Hoisted in-memory state (visible inside vi.mock factories) ───────────────
const state = vi.hoisted(() => ({
  stored: new Map<string, Buffer>(),
  storageFails: false,
  documents: [{ id: "doc-1", disputeId: "dispute-1", fileName: "eob.pdf" }] as any[],
  disputes: [{ id: "dispute-1", initiatingPartyId: "user-1", createdBy: "user-1" }] as any[],
  versions: [] as any[],
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
    if (table === schema.disputes) return state.disputes;
    if (table === schema.disputeDocuments) return state.documents;
    if (table === schema.documentVersions) return state.versions;
    return [];
  };

  // Chainable query: where()/orderBy() return a thenable that also has limit().
  const makeQuery = (rows: unknown[]): any => ({
    where: () => makeQuery(rows),
    orderBy: () => makeQuery(rows),
    limit: (n: number) => Promise.resolve(rows.slice(0, n)),
    then: (onFulfilled: any, onRejected: any) => Promise.resolve(rows).then(onFulfilled, onRejected),
  });

  // Transaction-scoped fake supporting exactly the chains uploadVersion uses:
  // execute(), update().set().where(), select().from().where(), insert().values().returning()
  const fakeTx = {
    execute: async () => ({ rows: [] }),
    update: (table: unknown) => ({
      set: (vals: Record<string, unknown>) => ({
        where: async () => {
          if (table === schema.documentVersions) {
            for (const v of state.versions) Object.assign(v, vals);
          }
        },
      }),
    }),
    select: (_fields?: unknown) => ({
      from: (table: unknown) => ({
        where: async () => {
          if (table === schema.documentVersions) {
            const max = state.versions.length
              ? Math.max(...state.versions.map(v => v.versionNumber as number))
              : null;
            return [{ maxVer: max }];
          }
          return rowsFor(table);
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (vals: Record<string, unknown>) => ({
        returning: async () => {
          const row = { ...vals, uploadedAt: new Date() };
          if (table === schema.documentVersions) state.versions.push(row);
          return [row];
        },
      }),
    }),
  };

  const fakeDb = {
    select: () => ({ from: (table: unknown) => makeQuery(rowsFor(table)) }),
    transaction: async (cb: (tx: typeof fakeTx) => Promise<unknown>) => cb(fakeTx),
  };

  return {
    ...mod,
    getDb: async () => fakeDb as any,
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
    name: "Version Tester",
    email: "version-tester@example.test",
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

const CONTENT_V1 = "version-one pdf bytes %PDF-1.4";
const CONTENT_V2 = "version-two pdf bytes %PDF-1.7 — revised determination exhibit";

function baseInput(fileBase64: string, fileSize: number) {
  return {
    documentId: "doc-1",
    disputeId: "dispute-1",
    fileName: "eob.pdf",
    fileType: "application/pdf",
    fileSize,
    storageKey: `disputes/dispute-1/test-${state.versions.length + 1}-eob.pdf`,
    fileBase64,
  };
}

beforeEach(() => {
  state.stored.clear();
  state.storageFails = false;
  state.versions.length = 0;
});

describe("documents.uploadVersion byte persistence", () => {
  it("persists the uploaded bytes under the recorded s3Key (retrievable)", async () => {
    const fileBase64 = Buffer.from(CONTENT_V1, "utf-8").toString("base64");
    // Deliberately wrong client-reported fileSize: the row must record the
    // TRUE byte length of the persisted payload, not the client's claim.
    const input = baseInput(fileBase64, 999999);
    const version = await caller().documents.uploadVersion(input);

    expect(version.versionNumber).toBe(1);
    expect(version.isLatest).toBe(true);
    expect(version.s3Key).toBe(input.storageKey);
    expect(version.fileSize).toBe(Buffer.byteLength(CONTENT_V1));
    expect(version.mimeType).toBe("application/pdf");
    expect(version.uploadedBy).toBe("user-1");

    // Bytes are retrievable under the exact key recorded on the row.
    const stored = state.stored.get(version.s3Key);
    expect(stored).toBeDefined();
    expect(stored!.equals(Buffer.from(CONTENT_V1, "utf-8"))).toBe(true);
    expect(stored!.toString("utf-8")).toBe(CONTENT_V1);
  });

  it("increments versionNumber, flips isLatest, and keeps every version's bytes", async () => {
    const v1 = await caller().documents.uploadVersion(
      baseInput(Buffer.from(CONTENT_V1, "utf-8").toString("base64"), CONTENT_V1.length)
    );
    const v2 = await caller().documents.uploadVersion(
      baseInput(Buffer.from(CONTENT_V2, "utf-8").toString("base64"), CONTENT_V2.length)
    );

    expect(v1.versionNumber).toBe(1);
    expect(v2.versionNumber).toBe(2);
    expect(v2.isLatest).toBe(true);

    const row1 = state.versions.find(v => v.versionNumber === 1);
    const row2 = state.versions.find(v => v.versionNumber === 2);
    expect(row1.isLatest).toBe(false); // flipped by the v2 transaction
    expect(row2.isLatest).toBe(true);

    // Both revisions remain independently retrievable.
    expect(state.stored.get(row1.s3Key)!.toString("utf-8")).toBe(CONTENT_V1);
    expect(state.stored.get(row2.s3Key)!.toString("utf-8")).toBe(CONTENT_V2);
    expect(row1.s3Key).not.toBe(row2.s3Key);
  });

  it("records NO metadata row when the storage write fails (no dangling pointer)", async () => {
    state.storageFails = true;
    await expect(
      caller().documents.uploadVersion(
        baseInput(Buffer.from(CONTENT_V1, "utf-8").toString("base64"), CONTENT_V1.length)
      )
    ).rejects.toThrow(/storage backend unavailable/);
    expect(state.versions).toHaveLength(0);
  });

  it("rejects a metadata-only call (missing fileBase64) with BAD_REQUEST", async () => {
    const { fileBase64: _omit, ...metadataOnly } = baseInput("dGVzdA==", 4);
    await expect(
      caller().documents.uploadVersion(metadataOnly as any)
    ).rejects.toSatisfy(e => e instanceof TRPCError && e.code === "BAD_REQUEST");
    expect(state.stored.size).toBe(0);
    expect(state.versions).toHaveLength(0);
  });
});
