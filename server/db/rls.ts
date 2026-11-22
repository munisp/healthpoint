/**
 * server/db/rls.ts — Wave p27 (Phase 26 Stream B): Postgres Row-Level
 * Security request/worker context helpers. BINDING design:
 * phase-26-rls-design.md §2 (identity propagation), §6 (rollout modes).
 *
 * Three transaction-local GUCs (set_config(..., true) only — never session
 * SET, so pooled connections cannot leak tenant context across requests):
 *
 *   app.current_user   text   users.id of the caller
 *   app.current_orgs   text   CSV of verified org memberships
 *   app.service_mode   'on'   worker/cron bypass (set by withServiceContext)
 *
 * Modes (env gate RLS_ENABLED, design §6.1):
 *   off     (default): helpers verify membership (withOrgContext) but run fn
 *            directly on the shared pool with NO transaction and NO GUCs —
 *            zero behavioral change for existing code paths.
 *   audit:   GUCs are set inside a transaction; rlsShadow() re-executes
 *            sampled reads under SET LOCAL ROLE hp_app and logs diffs to
 *            audit_log as rls_shadow_diff.
 *   enforce: helpers run on the hp_app pool (getRlsDb / RLS_DATABASE_URL);
 *            context is mandatory — enforced tables return 0 rows / 42501
 *            without it (fail-closed by construction, design §3.1).
 *
 * Honest limitation (design §3.4/§9): app.service_mode is session state, not
 * a credential. It defends against bugs (forgotten scoping), not against an
 * attacker with arbitrary query execution.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { TRPCError } from "@trpc/server";
import { sql, and, eq, inArray, type SQL } from "drizzle-orm";
import { getDb, getRlsDb } from "../db";
import { orgMemberships } from "../../drizzle/schema-personas";

export interface RlsRequestContext { userId: string; orgIds: string[]; }
export interface RlsServiceContext { service: true; label: string; } // label for provenance logging

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
/** drizzle/postgres-js transactions are structurally query-compatible with
 *  the pool handle; the public fn signature stays `(db: Db)` per the design
 *  (§2.2 pseudocode passes tx as db) and the cast is contained here. */
export type RlsDb = Db;

export type RlsMode = "off" | "audit" | "enforce";

export function rlsMode(): RlsMode {
  // process.env wins so tests can flip modes without re-importing env.ts.
  const raw = (process.env.RLS_ENABLED ?? "off").trim();
  return raw === "audit" || raw === "enforce" ? raw : "off";
}

// ── AsyncLocalStorage guard (design §2.2 rule 4 / R7) ───────────────────────

interface ActiveRlsContext {
  kind: "org" | "service";
  userId?: string;
  orgsKey?: string; // sorted, joined org list — mismatch => throw
  label?: string;
  tx: RlsDb;
}

const als = new AsyncLocalStorage<ActiveRlsContext>();

/** Introspection for tests/debugging. */
export function currentRlsContext(): Omit<ActiveRlsContext, "tx"> | null {
  const s = als.getStore();
  return s ? { kind: s.kind, userId: s.userId, orgsKey: s.orgsKey, label: s.label } : null;
}

/** Org id format validation (design §2.2 rule 1; ids are uuids per
 *  drizzle/schema-personas.ts, values are already bind-parameterized — this
 *  is defense in depth for the CSV join). */
const ORG_ID_RE = /^[A-Za-z0-9:_-]{1,64}$/;

function normalizeOrgIds(orgIds: string[]): string[] {
  const out = [...new Set(orgIds)];
  for (const id of out) {
    if (!ORG_ID_RE.test(id)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "invalid_org_id" });
    }
  }
  return out;
}

async function baseDb(): Promise<RlsDb> {
  const db = rlsMode() === "enforce" ? await getRlsDb() : await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "database_unavailable" });
  return db;
}

/**
 * Request path: validates orgIds against org_memberships for userId, then
 * runs fn inside ONE transaction with app.current_user / app.current_orgs
 * set LOCAL. Throws FORBIDDEN if any requested org is not a verified
 * membership (mirrors assertOrgMember semantics; the org suspension check
 * stays in assertOrgMember and is NOT duplicated here).
 *
 * Nesting (design §2.2 rule 4): a second withOrgContext inside an active ORG
 * context with DIFFERENT orgs throws — accidental context widening
 * mid-request is a bug. Same-orgs nesting reuses the outer transaction.
 * Inside a SERVICE context the org context is redundant (service mode
 * already spans all orgs — the R10 per-org-iteration pattern), so fn runs on
 * the service transaction as-is.
 */
export async function withOrgContext<T>(ctx: RlsRequestContext, fn: (db: RlsDb) => Promise<T>): Promise<T> {
  const orgIds = normalizeOrgIds(ctx.orgIds);
  const orgsKey = [...orgIds].sort().join(",");
  const active = als.getStore();
  if (active?.kind === "org") {
    if (active.userId === ctx.userId && active.orgsKey === orgsKey) return fn(active.tx);
    throw new TRPCError({ code: "FORBIDDEN", message: "nested_org_context_mismatch" });
  }
  if (active?.kind === "service") return fn(active.tx);

  const db = await baseDb();
  const run = (tx: RlsDb) => als.run({ kind: "org", userId: ctx.userId, orgsKey, tx }, () => fn(tx));

  if (rlsMode() === "off") {
    // Passthrough mode: same membership contract, no transaction/GUCs.
    await verifyMemberships(db, ctx.userId, orgIds);
    return run(db);
  }

  return db.transaction(async (tx0) => {
    const tx = tx0 as unknown as RlsDb;
    // Order is binding (design §2.2 rule 2): current_user first so the
    // membership read itself is legal under enforcement (org_memberships
    // self-read policy), then the read, then current_orgs.
    await tx.execute(sql`SELECT set_config('app.current_user', ${ctx.userId}, true), set_config('app.current_orgs', ${""}, true)`);
    await verifyMemberships(tx, ctx.userId, orgIds);
    await tx.execute(sql`SELECT set_config('app.current_orgs', ${orgsKey}, true)`);
    return run(tx);
  });
}

async function verifyMemberships(db: RlsDb, userId: string, orgIds: string[]): Promise<void> {
  if (orgIds.length === 0) return;
  const rows = await db
    .select({ orgId: orgMemberships.orgId })
    .from(orgMemberships)
    .where(and(eq(orgMemberships.userId, userId), inArray(orgMemberships.orgId, orgIds)));
  const verified = new Set(rows.map(r => r.orgId));
  const missing = orgIds.filter(id => !verified.has(id));
  if (missing.length > 0) {
    throw new TRPCError({ code: "FORBIDDEN", message: "not_org_member" });
  }
}

/**
 * Worker/cron path: sets app.service_mode='on' LOCAL; label is logged for
 * provenance (precedent: 'kll_sketch'|'exact' labels in server/idr/sketches.ts).
 * Only callable from server/scheduled/*, server/outbox.ts,
 * server/webhook-dispatcher.ts, ingest runners and scripts (design §2.2).
 *
 * Nesting: service-inside-service reuses the outer transaction;
 * service-inside-ORG throws (a request context must never widen to service).
 */
export async function withServiceContext<T>(ctx: RlsServiceContext, fn: (db: RlsDb) => Promise<T>, base?: RlsDb): Promise<T> {
  const active = als.getStore();
  if (active?.kind === "service") return fn(active.tx);
  if (active?.kind === "org") {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "service_context_inside_org_context" });
  }
  // `base` lets legacy run*(db, ...) entry points keep their injected handle
  // (off-mode byte-identical behavior) instead of re-fetching the pool.
  const db = base ?? await baseDb();
  const run = (tx: RlsDb) => als.run({ kind: "service", label: ctx.label, tx }, () => fn(tx));
  if (rlsMode() === "off") return run(db);
  console.info(`[rls] service context: ${ctx.label}`);
  return db.transaction(async (tx0) => {
    const tx = tx0 as unknown as RlsDb;
    await tx.execute(sql`SELECT set_config('app.service_mode', ${"on"}, true)`);
    return run(tx);
  });
}

// ── Audit mode: sampled shadow re-execution (design §6.2) ───────────────────

function samplePct(): number {
  const n = Number.parseInt((process.env.RLS_AUDIT_SAMPLE_PCT ?? "5").trim(), 10);
  if (!Number.isFinite(n)) return 5;
  return Math.min(100, Math.max(0, n));
}

export interface ShadowDiff {
  label: string;
  visibleCount: number;
  shadowCount: number;
  onlyVisible: string[]; // row ids the org context sees that hp_app does not (policy too narrow)
  onlyShadow: string[];  // row ids hp_app does not see but the context does (policy too broad / app bug)
}

/**
 * Execute a read statement, then — in audit mode, for a sampled fraction —
 * re-execute it under SET LOCAL ROLE hp_app inside the SAME transaction
 * (same GUCs) and diff row ids. Diffs are written to audit_log with action
 * 'rls_shadow_diff' plus console.warn. Mutations are never shadowed (side
 * effects); write-path correctness is covered by the integration suite.
 * Returns the primary (owner-role) rows.
 */
export async function rlsShadow<T extends Record<string, unknown>>(
  tx: RlsDb, label: string, statement: SQL,
): Promise<T[]> {
  const primary = (await tx.execute(statement)) as unknown as T[];
  if (rlsMode() !== "audit" || Math.random() * 100 >= samplePct()) return primary;
  try {
    const prevRoleRows = (await tx.execute(sql`SELECT current_setting('role', true) AS r`)) as unknown as Array<{ r: string }>;
    const prevRole = prevRoleRows[0]?.r ?? "none";
    await tx.execute(sql`SELECT set_config('role', 'hp_app', true)`);
    const shadow = (await tx.execute(statement)) as unknown as T[];
    await tx.execute(sql`SELECT set_config('role', ${prevRole}, true)`);
    const ids = (rows: T[]) => new Set(rows.map(r => String((r as { id?: unknown }).id ?? JSON.stringify(r))));
    const p = ids(primary), s = new Set(ids(shadow));
    const onlyVisible = [...p].filter(id => !s.has(id));
    const onlyShadow = [...s].filter(id => !p.has(id));
    if (onlyVisible.length > 0 || onlyShadow.length > 0) {
      const diff: ShadowDiff = { label, visibleCount: primary.length, shadowCount: shadow.length, onlyVisible, onlyShadow };
      console.warn(`[rls] shadow diff (${label}):`, JSON.stringify(diff));
      const { createAuditEntry } = await import("../db");
      await createAuditEntry({
        userId: "system",
        action: "rls_shadow_diff",
        entityType: "rls",
        entityId: label.slice(0, 64),
        oldValue: null,
        newValue: JSON.stringify(diff).slice(0, 8000),
        ipAddress: null,
        userAgent: null,
      }).catch(err => console.warn("[rls] audit write failed:", err instanceof Error ? err.message : err));
    }
  } catch (err) {
    // Probe failures never fail the request (audit is observability).
    console.warn(`[rls] shadow probe failed (${label}):`, err instanceof Error ? err.message : err);
  }
  return primary;
}

// ── Audit mode: orphan-row scan (design §6.2) ───────────────────────────────
// Rows whose org column value is not present in organizations.id would become
// permanently invisible under enforce and must be triaged first. Identifiers
// come from this hardcoded allowlist only (never caller input) so sql.raw is
// safe here.

const ORG_COLUMNS: ReadonlyArray<{ table: string; cols: string[] }> = [
  { table: "practice_claims", cols: ['"orgId"'] },
  { table: "remittance_835_files", cols: ['"orgId"'] },
  { table: "manual_check_postings", cols: ['"orgId"'] },
  { table: "bulk_upload_sessions", cols: ["org_id"] },
  { table: "claim_quarantine", cols: ["org_id"] },
  { table: "suggestion_events", cols: ["org_id"] },
  { table: "next_action_dismissals", cols: ["org_id"] },
  { table: "bandit_assignments", cols: ["org_id"] },
  { table: "bandit_arm_stats", cols: ["org_id"] },
  { table: "ranking_stats", cols: ["org_id"] },
  { table: "outcome_segment_sketches", cols: ["org_id"] },
  { table: "org_memberships", cols: ['"orgId"'] },
  { table: "invite_tokens", cols: ['"orgId"'] },
  { table: "api_keys", cols: ['"orgId"'] },
  { table: "audit_share_tokens", cols: ['"orgId"'] },
  { table: "submitter_clients", cols: ['"submitterOrgId"', '"clientOrgId"'] },
];

export interface OrphanScanResult { [tableColumn: string]: number }

/** Nightly audit-mode job: count org-keyed rows pointing at nonexistent orgs.
 *  Runs under withServiceContext('rls-orphan-scan'). */
export async function scanOrgOrphans(): Promise<OrphanScanResult> {
  return withServiceContext({ service: true, label: "rls-orphan-scan" }, async (db) => {
    const out: OrphanScanResult = {};
    for (const { table, cols } of ORG_COLUMNS) {
      for (const col of cols) {
        const key = `${table}.${col.replace(/"/g, "")}`;
        const rows = (await db.execute(sql.raw(
          `SELECT count(*)::int AS n FROM ${table} t WHERE t.${col} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = t.${col})`
        ))) as unknown as Array<{ n: number }>;
        out[key] = rows[0]?.n ?? 0;
      }
    }
    const total = Object.values(out).reduce((a, b) => a + b, 0);
    if (total > 0) console.warn(`[rls] orphan scan found ${total} org-keyed rows with no organizations row:`, JSON.stringify(out));
    return out;
  });
}
