/**
 * server/tests/in-memory-db.ts
 *
 * Shared vitest helper: an in-memory double for server/db.ts's `getDb` /
 * `createAuditEntry` that actually EVALUATES the drizzle where-conditions
 * the auth-factor modules rely on (eq column filters, IS NULL / IS NOT
 * NULL). The older per-test mocks return every row of a table for any
 * select — insufficient once confirmation gating filters by fingerprint,
 * token hash and confirmed_at null-ness (Wave P26/O6).
 *
 * Condition evaluation is best-effort over drizzle's SQL.queryChunks:
 *  - eq(col, val)                → row[jsKey] === val
 *  - isNull / isNotNull(col)     → null-ness check
 *  - nested and()/or-less SQL     → recursed (treated as AND)
 * Unknown chunk shapes are ignored (filter dropped), matching the
 * fail-accepting spirit of the existing test doubles — tests construct
 * single-tenant states so dropped filters never widen results wrongly.
 *
 * Usage (per test file):
 *   const dbState = vi.hoisted(() => ({ tables: {...}, audits: [] }));
 *   vi.mock("../db", async () => {
 *     const m = await import("../tests/in-memory-db");
 *     return m.makeInMemoryDbModule(dbState);
 *   });
 */
import { getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

export interface InMemoryDbState {
  tables: Record<string, Array<Record<string, unknown>>>;
  audits: Array<Record<string, unknown>>;
}

type Filter = { key: string; op: "eq" | "isnull" | "notnull"; value?: unknown };

const camel = (name: string) => name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractFilters(node: any, out: Filter[]): void {
  const chunks: unknown[] = node?.queryChunks ?? [];
  for (let i = 0; i < chunks.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = chunks[i] as any;
    if (c?.constructor?.name === "SQL") { extractFilters(c, out); continue; }
    if (Array.isArray(c)) { for (const sub of c) extractFilters(sub, out); continue; }
    if (c && typeof c === "object" && typeof c.name === "string" && c.table) {
      // A Column — look ahead for Param (eq) or a null-check StringChunk.
      for (let j = i + 1; j < chunks.length; j++) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p = chunks[j] as any;
        const ctor = p?.constructor?.name;
        if (ctor === "Param") {
          out.push({ key: camel(c.name), op: "eq", value: p.value });
          break;
        }
        if (ctor === "StringChunk") {
          const txt = Array.isArray(p.value) ? p.value.join("") : String(p.value ?? "");
          if (/is\s+not\s+null/i.test(txt)) { out.push({ key: camel(c.name), op: "notnull" }); break; }
          if (/is\s+null/i.test(txt)) { out.push({ key: camel(c.name), op: "isnull" }); break; }
          continue; // e.g. " = " between column and Param — keep scanning
        }
        if (ctor === "SQL" || Array.isArray(p) || (p && typeof p === "object" && typeof p.name === "string" && p.table)) break;
      }
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyWhere(rows: Array<Record<string, unknown>>, cond: any): Array<Record<string, unknown>> {
  const filters: Filter[] = [];
  extractFilters(cond, filters);
  if (!filters.length) return rows;
  const eqVal = (a: unknown, b: unknown): boolean => {
    if (a === b) return true;
    // Buffers compare by content (credential_id lookups); Dates by epoch.
    if (Buffer.isBuffer(a) && Buffer.isBuffer(b)) return a.equals(b);
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    return false;
  };
  return rows.filter(r => filters.every(f => {
    if (f.op === "eq") return eqVal(r[f.key], f.value);
    if (f.op === "isnull") return r[f.key] == null;
    return r[f.key] != null;
  }));
}

export function makeInMemoryDbModule(state: InMemoryDbState) {
  const rowsOf = (table: PgTable) => state.tables[getTableName(table)] ?? [];

  function chain(getRows: () => Array<Record<string, unknown>>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p: any = Promise.resolve(getRows());
    p.limit = (n: number) => Promise.resolve(getRows().slice(0, n));
    p.orderBy = () => chain(getRows); // ordering is irrelevant in single-tenant test states
    return p;
  }

  const db = {
    select: () => ({
      from: (table: PgTable) => ({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        where: (cond: any) => chain(() => applyWhere(rowsOf(table), cond)),
      }),
    }),
    insert: (table: PgTable) => ({
      values: (v: Record<string, unknown>) => {
        rowsOf(table).push(v);
        return Promise.resolve();
      },
    }),
    update: (table: PgTable) => ({
      set: (o: Record<string, unknown>) => ({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        where: (cond: any) => {
          for (const r of applyWhere(rowsOf(table), cond)) Object.assign(r, o);
          return Promise.resolve();
        },
      }),
    }),
    delete: (table: PgTable) => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      where: (cond: any) => {
        // In-place mutation so test files may alias state.tables[t].
        const doomed = new Set(applyWhere(rowsOf(table), cond));
        const rows = rowsOf(table);
        for (let i = rows.length - 1; i >= 0; i--) {
          if (doomed.has(rows[i])) rows.splice(i, 1);
        }
        return Promise.resolve();
      },
    }),
  };

  return {
    getDb: async () => db,
    createAuditEntry: async (entry: Record<string, unknown>) => {
      state.audits.push(entry);
      return entry;
    },
  };
}
