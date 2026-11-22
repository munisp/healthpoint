/**
 * server/scheduled/worker-poison.test.ts — fix-wave F-5 regression test.
 *
 * One failing delete inside the retention worker's shared service-mode
 * transaction previously aborted the whole tx (25P02 cascade): every LATER
 * purge silently returned 0 rows while the completion log claimed success.
 * runRetentionPurgeInner now wraps each table in rlsGuard (SAVEPOINT per
 * table inside a tx; direct statements in off-mode autocommit). The db here
 * is a scripted fake emulating Postgres' poisoned-transaction behavior, so
 * the sibling-commit guarantee is tested deterministically without a database.
 */
import { describe, it, expect, vi } from "vitest";
import { runRetentionPurgeInner } from "./retentionWorker";
import { fhirResourceCache, smartFormExtractions } from "../../drizzle/schema";
import { suggestionEvents, nextActionDismissals } from "../../drizzle/schema-intelligence";

type Row = Record<string, unknown>;

/** Scripted db: delete() chains plus a nested-transaction savepoint
 *  emulation; emulates 25P02 (after an error, statements are rejected until
 *  the nested transaction's rollback clears the poison). */
function fakeRetentionDb(opts: { failTable: object }) {
  const purged: string[] = [];
  let poisoned = false;
  let inTx = false; // 25P02 only exists while a (nested) transaction is open
  const nameOf = (t: object): string =>
    t === fhirResourceCache ? "fhir_resource_cache"
    : t === smartFormExtractions ? "smart_form_extractions"
    : t === suggestionEvents ? "suggestion_events"
    : t === nextActionDismissals ? "next_action_dismissals"
    : "unknown";
  const db = {
    delete: (table: object) => ({
      where: () => ({
        returning: async (): Promise<Row[]> => {
          if (poisoned && inTx) throw new Error("25P02: current transaction is aborted");
          if (table === opts.failTable) {
            if (inTx) poisoned = true;
            throw new Error("42P01: simulated DDL conflict");
          }
          purged.push(nameOf(table));
          return [{ id: "a" }, { id: "b" }, { id: "c" }];
        },
      }),
    }),
    transaction: async (cb: (t: unknown) => Promise<unknown>): Promise<unknown> => {
      inTx = true;
      try {
        return await cb(db);
      } catch (err) {
        poisoned = false; // rollback-to-savepoint recovers the shared tx
        throw err;
      } finally {
        inTx = false;
      }
    },
  };
  return { db, purged };
}

describe("retention worker per-table failure isolation (F-5)", () => {
  it("audit/enforce mode: one failing purge does not poison siblings; counts reflect actual commits", async () => {
    const prev = process.env.RLS_ENABLED;
    process.env.RLS_ENABLED = "audit";
    try {
      const { db, purged } = fakeRetentionDb({ failTable: fhirResourceCache });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = await runRetentionPurgeInner(90, db as never);
      // The failing table is honestly counted as 0 and warned about...
      expect(result.fhirCachePurged).toBe(0);
      expect(warn.mock.calls.some(c => String(c[0]).includes("fhir_resource_cache purge failed"))).toBe(true);
      // ...and every sibling still commits (previously zeroed by the 25P02 cascade).
      expect(result.smartFormExtractionsPurged).toBe(3);
      expect(result.suggestionEventsPurged).toBe(3);
      expect(result.nextActionDismissalsPurged).toBe(3);
      expect(purged).toEqual(["smart_form_extractions", "suggestion_events", "next_action_dismissals"]);
    } finally {
      if (prev === undefined) delete process.env.RLS_ENABLED; else process.env.RLS_ENABLED = prev;
    }
  });

  it("off mode: passthrough statements stay independent (no savepoint wrapper)", async () => {
    const prev = process.env.RLS_ENABLED;
    process.env.RLS_ENABLED = "off";
    try {
      const { db, purged } = fakeRetentionDb({ failTable: suggestionEvents });
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = await runRetentionPurgeInner(90, db as never);
      expect(result.fhirCachePurged).toBe(3);
      expect(result.smartFormExtractionsPurged).toBe(3);
      expect(result.suggestionEventsPurged).toBe(0); // the injected failure, honestly zeroed
      expect(result.nextActionDismissalsPurged).toBe(3);
      expect(purged).toEqual(["fhir_resource_cache", "smart_form_extractions", "next_action_dismissals"]);
    } finally {
      if (prev === undefined) delete process.env.RLS_ENABLED; else process.env.RLS_ENABLED = prev;
    }
  });
});
