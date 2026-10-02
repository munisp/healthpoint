/**
 * server/tests/search-reindex.test.ts
 *
 * Wave-W3 search reindex remediation:
 *   - reindexAllFromPostgres rebuilds from Postgres in bounded batches (500)
 *   - indexing failures are recorded (in-memory retry set) and the drain is
 *     honest when there is no OpenSearch client (rows kept, not discarded)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  disputeRows: [] as Array<{ id: string }>,
  selectOffsets: [] as number[],
};

function tableName(t: any): string {
  return String(t?.[Symbol.for("drizzle:Name")] ?? "");
}

vi.mock("../db", () => ({
  getDb: async () => ({
    select: () => ({
      from: (table: any) => ({
        orderBy: (..._a: any[]) => ({
          limit: (n: number) => ({
            offset: (o: number) => {
              state.selectOffsets.push(o);
              const name = tableName(table);
              const rows = name.includes("disputes") ? state.disputeRows : [];
              return Promise.resolve(rows.slice(o, o + n));
            },
          }),
        }),
      }),
    }),
    execute: async () => ({ rows: [{ n: 0 }] }),
  }),
}));

vi.mock("../authz", () => ({ canAccessDispute: async () => true }));

import { reindexAllFromPostgres, drainIndexFailures, _indexFailures } from "../search";

beforeEach(() => {
  state.disputeRows = [];
  state.selectOffsets = [];
  _indexFailures().clear();
  delete process.env.OPENSEARCH_URL;
});

describe("reindexAllFromPostgres", () => {
  it("reads disputes in bounded batches of 500", async () => {
    state.disputeRows = Array.from({ length: 1200 }, (_, i) => ({ id: `d-${i}` }));
    const report = await reindexAllFromPostgres(500);
    expect(report.indexed.dispute).toBe(1200);
    // batch offsets: 0, 500, 1000 for the dispute table (other tables empty)
    expect(state.selectOffsets).toContain(0);
    expect(state.selectOffsets).toContain(500);
    expect(state.selectOffsets).toContain(1000);
  });

  it("handles an empty database", async () => {
    const report = await reindexAllFromPostgres(500);
    expect(report.indexed.dispute).toBe(0);
    expect(report.remainingFailures).toBe(0);
  });
});

describe("drainIndexFailures without OpenSearch", () => {
  it("keeps recorded failures instead of discarding them", async () => {
    _indexFailures().add("dispute:d-1");
    const { drained } = await drainIndexFailures();
    // No OpenSearch client configured → nothing indexed, nothing drained.
    expect(drained).toBe(0);
    expect(_indexFailures().has("dispute:d-1")).toBe(true);
  });
});
