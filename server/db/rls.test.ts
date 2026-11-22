/**
 * server/db/rls.test.ts — Wave p27 RLS integration suite (design §7.1).
 *
 * Live-PG, DATABASE_URL-gated (wave-p23.test.ts precedent). The sandbox
 * pgserver connects as SUPERUSER — and superusers bypass RLS unconditionally
 * (FORCE included) — so this suite creates and connects as a dedicated
 * NON-superuser role `rls_test_app` to exercise the policies (design §2.3
 * sandbox hazard). The migration DDL (0061-0066) is replayed idempotently in
 * beforeAll, so the suite works against any 0000-0060 baseline.
 *
 * Teardown reverses 0066+policies (per §6.4) and drops rls_test_app, leaving
 * hp_app/grants/functions (migration 0061 state) in place.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { withOrgContext, withServiceContext, rlsShadow, scanOrgOrphans } from "./rls";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const RUN = Date.now().toString(36);
const ORG_A = `rls-org-a-${RUN}`;
const ORG_B = `rls-org-b-${RUN}`;
const ORG_C = `rls-org-c-${RUN}`;
const UA = `rls-user-a-${RUN}`;   // member of A
const UAB = `rls-user-ab-${RUN}`; // member of A+B
const UB = `rls-user-b-${RUN}`;   // member of B

const MIGRATIONS = [
  "0061_wave_p27_rls_roles.sql",
  "0062_wave_p27_rls_claims.sql",
  "0063_wave_p27_rls_ingest.sql",
  "0064_wave_p27_rls_intelligence.sql",
  "0065_wave_p27_rls_personas.sql",
  "0066_wave_p27_rls_force.sql",
];

const WAVE1_TABLES = [
  "practice_claims", "practice_claim_scores", "remittance_835_files", "remittance_lines",
  "manual_check_postings", "bulk_upload_sessions", "bulk_upload_chunks", "claim_quarantine",
  "suggestion_events", "next_action_dismissals", "bandit_assignments", "bandit_arm_stats",
  "ranking_stats", "outcome_segment_sketches",
  "organizations", "org_memberships", "invite_tokens", "api_keys", "audit_share_tokens",
  "submitter_clients", "delegation_attestations", "submitter_invoices", "submitter_invoice_lines",
];

let adminSql: postgres.Sql;   // superuser (bypasses RLS) — setup/teardown/asserts
let appSql: postgres.Sql;     // rls_test_app (NON-superuser) — the role under test

/** Run one fn inside a transaction with the given GUCs set LOCAL, as rls_test_app. */
async function asApp<T>(gucs: { user?: string; orgs?: string[]; service?: boolean }, fn: (q: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return appSql.begin(async (q) => {
    if (gucs.user !== undefined) await q`SELECT set_config('app.current_user', ${gucs.user}, true)`;
    if (gucs.orgs !== undefined) await q`SELECT set_config('app.current_orgs', ${gucs.orgs.join(",")}, true)`;
    if (gucs.service) await q`SELECT set_config('app.service_mode', 'on', true)`;
    return fn(q as postgres.TransactionSql);
  }) as Promise<T>;
}

/** Dedicated single-connection session as rls_test_app with SESSION-level
 *  GUCs — for statements EXPECTED to fail (a 42501 aborts the surrounding
 *  transaction, so expect-error statements cannot share sql.begin with
 *  other assertions). */
async function asAppSession<T>(gucs: { user?: string; orgs?: string[]; service?: boolean }, fn: (q: postgres.Sql) => Promise<T>): Promise<T> {
  const u = new URL(process.env.DATABASE_URL!);
  const s = postgres(`postgres://rls_test_app:rls_test@${u.hostname}:${u.port || "5432"}${u.pathname}`, { max: 1, onnotice: () => {} });
  try {
    if (gucs.user !== undefined) await s`SELECT set_config('app.current_user', ${gucs.user}, false)`;
    if (gucs.orgs !== undefined) await s`SELECT set_config('app.current_orgs', ${gucs.orgs.join(",")}, false)`;
    if (gucs.service) await s`SELECT set_config('app.service_mode', 'on', false)`;
    return await fn(s);
  } finally {
    await s.end();
  }
}

async function expect42501(p: Promise<unknown>): Promise<void> {
  try {
    await p;
  } catch (err) {
    expect((err as { code?: string }).code).toBe("42501");
    return;
  }
  throw new Error("expected 42501 (RLS WITH CHECK violation) but the statement succeeded");
}

describe.skipIf(!HAS_DB)("Wave p27 RLS (live PG, non-superuser rls_test_app)", () => {
  let claimA: string, claimB: string, sessionA: string, dismissalNull: string, scId: string;

  beforeAll(async () => {
    const db = await getDb();
    expect(db).toBeTruthy();
    adminSql = postgres(process.env.DATABASE_URL!, { max: 4, onnotice: () => {} });

    // 1. Dedicated non-superuser role (design §7.1 beforeAll contract).
    await adminSql`DROP OWNED BY rls_test_app`.catch(() => undefined);
    await adminSql`DROP ROLE IF EXISTS rls_test_app`.catch(() => undefined);
    await adminSql`CREATE ROLE rls_test_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'rls_test'`;
    await adminSql`GRANT USAGE ON SCHEMA public TO rls_test_app`;
    await adminSql.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${WAVE1_TABLES.join(", ")} TO rls_test_app`);

    // 2. Replay batch DDL idempotently (0061-0066) — mirrors CI applying the
    //    migration chain; re-running must be a no-op.
    const dir = path.resolve(__dirname, "../../drizzle/migrations");
    for (const file of MIGRATIONS) {
      const content = readFileSync(path.join(dir, file), "utf8");
      for (const stmt of content.split("--> statement-breakpoint")) {
        const body = stmt.trim();
        if (body && !/^(--[^\n]*\n?)*$/.test(body)) await adminSql.unsafe(body);
      }
    }

    // 3. Seed two orgs + memberships + per-tier rows (fixtures mirror
    //    server/journeys/context.ts seedFixtureUsers).
    await adminSql`INSERT INTO users (id, name, email, "loginMethod", role) VALUES
      (${UA}, 'RLS A', ${UA + "@test.local"}, 'test', 'user'),
      (${UAB}, 'RLS AB', ${UAB + "@test.local"}, 'test', 'user'),
      (${UB}, 'RLS B', ${UB + "@test.local"}, 'test', 'user')`;
    await adminSql`INSERT INTO organizations (id, name, type) VALUES
      (${ORG_A}, 'RLS Org A', 'provider'), (${ORG_B}, 'RLS Org B', 'provider'), (${ORG_C}, 'RLS Org C', 'provider')`;
    await adminSql`INSERT INTO org_memberships (id, "orgId", "userId", role) VALUES
      (${"m-a-" + RUN}, ${ORG_A}, ${UA}, 'owner'),
      (${"m-ab1-" + RUN}, ${ORG_A}, ${UAB}, 'staff'),
      (${"m-ab2-" + RUN}, ${ORG_B}, ${UAB}, 'staff'),
      (${"m-b-" + RUN}, ${ORG_B}, ${UB}, 'owner')`;

    // Tier A (camel "orgId") + child
    claimA = `pc-a-${RUN}`; claimB = `pc-b-${RUN}`;
    await adminSql`INSERT INTO practice_claims (id, "orgId", source, "contentSha256") VALUES
      (${claimA}, ${ORG_A}, 'test', 'sha-a'), (${claimB}, ${ORG_B}, 'test', 'sha-b')`;
    await adminSql`INSERT INTO practice_claim_scores (id, "claimId", verdict, "rulesFired", "missingFields", "evidenceChecklist", "completenessPct") VALUES
      (${"pcs-a-" + RUN}, ${claimA}, 'pass', '[]', '[]', '[]', 100), (${"pcs-b-" + RUN}, ${claimB}, 'pass', '[]', '[]', '[]', 90)`;

    // Tier B (snake org_id) + child
    sessionA = `00000000-0000-4000-8000-${String(Date.now()).slice(-12)}`;
    const sessionB = `00000000-0000-4000-9000-${String(Date.now()).slice(-12)}`;
    await adminSql`INSERT INTO bulk_upload_sessions (id, org_id, created_by_user_id, file_name, file_type, declared_size_bytes, total_chunks) VALUES
      (${sessionA}, ${ORG_A}, ${UA}, 'a.csv', 'csv', 4, 1), (${sessionB}, ${ORG_B}, ${UB}, 'b.csv', 'csv', 4, 1)`;
    await adminSql`INSERT INTO bulk_upload_chunks (session_id, chunk_index, sha256, byte_length, data) VALUES
      (${sessionA}, 0, 'sha', 4, ${Buffer.from("AAAA")}), (${sessionB}, 0, 'sha', 4, ${Buffer.from("BBBB")})`;

    // Tier C (snake org_id + nullable-org case)
    await adminSql`INSERT INTO suggestion_events (id, org_id, user_id, suggestion_id, surface, action, model_name) VALUES
      (${"se-a-" + RUN}, ${ORG_A}, ${UA}, ${"sug-1-" + RUN}, 'next-actions', 'accepted', 'test'),
      (${"se-b-" + RUN}, ${ORG_B}, ${UB}, ${"sug-2-" + RUN}, 'next-actions', 'rejected', 'test')`;
    dismissalNull = `nad-null-${RUN}`;
    await adminSql`INSERT INTO next_action_dismissals (id, org_id, user_id, action_key, expires_at) VALUES
      (${"nad-a-" + RUN}, ${ORG_A}, ${UA}, 'k1', now() + interval '1 day'),
      (${dismissalNull}, NULL, ${UA}, 'k2', now() + interval '1 day')`;

    // Tier D two-org link
    scId = `sc-${RUN}`;
    await adminSql`INSERT INTO submitter_clients (id, "submitterOrgId", "clientOrgId", label) VALUES
      (${scId}, ${ORG_A}, ${ORG_B}, 'RLS link')`;

    // 4. Connect as the role under test.
    const u = new URL(process.env.DATABASE_URL!);
    appSql = postgres(`postgres://rls_test_app:rls_test@${u.hostname}:${u.port || "5432"}${u.pathname}`, { max: 4, onnotice: () => {} });
    await appSql`SELECT 1`;
  }, 120_000);

  afterAll(async () => {
    try {
      await appSql?.end();
      if (adminSql) {
        // Teardown: reverse order of §6.4 — NO FORCE, drop policies, DISABLE
        // RLS, drop seeded rows, drop the test role. hp_app + grants +
        // functions (0061 state) intentionally remain.
        for (const t of WAVE1_TABLES) await adminSql.unsafe(`ALTER TABLE ${t} NO FORCE ROW LEVEL SECURITY`).catch(() => undefined);
        for (const t of WAVE1_TABLES) await adminSql.unsafe(`DROP POLICY IF EXISTS org_isolation ON ${t}`);
        for (const t of WAVE1_TABLES) await adminSql.unsafe(`ALTER TABLE ${t} DISABLE ROW LEVEL SECURITY`);
        await adminSql`DELETE FROM submitter_clients WHERE id = ${scId}`.catch(() => undefined);
        await adminSql`DELETE FROM next_action_dismissals WHERE user_id IN (${UA}, ${UAB}, ${UB})`.catch(() => undefined);
        await adminSql`DELETE FROM suggestion_events WHERE user_id IN (${UA}, ${UAB}, ${UB})`.catch(() => undefined);
        await adminSql`DELETE FROM bulk_upload_chunks WHERE session_id IN (SELECT id FROM bulk_upload_sessions WHERE org_id IN (${ORG_A}, ${ORG_B}, ${ORG_C}))`.catch(() => undefined);
        await adminSql`DELETE FROM bulk_upload_sessions WHERE org_id IN (${ORG_A}, ${ORG_B}, ${ORG_C})`.catch(() => undefined);
        await adminSql`DELETE FROM practice_claim_scores WHERE "claimId" IN (SELECT id FROM practice_claims WHERE "orgId" IN (${ORG_A}, ${ORG_B}, ${ORG_C}))`.catch(() => undefined);
        await adminSql`DELETE FROM practice_claims WHERE "orgId" IN (${ORG_A}, ${ORG_B}, ${ORG_C})`.catch(() => undefined);
        await adminSql`DELETE FROM org_memberships WHERE "userId" IN (${UA}, ${UAB}, ${UB})`.catch(() => undefined);
        await adminSql`DELETE FROM organizations WHERE id IN (${ORG_A}, ${ORG_B}, ${ORG_C})`.catch(() => undefined);
        await adminSql`DELETE FROM users WHERE id IN (${UA}, ${UAB}, ${UB})`.catch(() => undefined);
        await adminSql`DROP OWNED BY rls_test_app`.catch(() => undefined);
        await adminSql`DROP ROLE IF EXISTS rls_test_app`.catch(() => undefined);
        await adminSql.end();
      }
    } catch { /* teardown best-effort */ }
  });

  it("1. cross-org READ blocked: org A context sees only A rows (camel + snake tables)", async () => {
    await asApp({ user: UA, orgs: [ORG_A] }, async (q) => {
      const claims = await q`SELECT id FROM practice_claims`;
      expect(claims.map(r => r.id).sort()).toEqual([claimA]);
      // Cross-org row addressed by PK returns 0 rows (silent-read semantics —
      // documented; reads fail closed, not loud).
      const direct = await q`SELECT id FROM practice_claims WHERE id = ${claimB}`;
      expect(direct.length).toBe(0);
      // Snake org_id table:
      const sessions = await q`SELECT id FROM bulk_upload_sessions`;
      expect(sessions.length).toBe(1);
      // Child table via parent EXISTS:
      const chunks = await q`SELECT session_id FROM bulk_upload_chunks`;
      expect(chunks.length).toBe(1);
      expect(chunks[0].session_id).toBe(sessionA);
      const scores = await q`SELECT id FROM practice_claim_scores`;
      expect(scores.length).toBe(1);
    });
  });

  it("2. cross-org WRITE blocked: UPDATE affects 0 rows, INSERT raises 42501", async () => {
    await asApp({ user: UA, orgs: [ORG_A] }, async (q) => {
      const upd = await q`UPDATE practice_claims SET source = 'evil' WHERE id = ${claimB}`;
      expect(upd.count).toBe(0);
      const del = await q`DELETE FROM practice_claims WHERE id = ${claimB}`;
      expect(del.count).toBe(0);
    });
    // INSERT is expected to fail → dedicated session (see asAppSession note).
    await asAppSession({ user: UA, orgs: [ORG_A] }, (q) =>
      expect42501(q`INSERT INTO practice_claims (id, "orgId", source, "contentSha256")
        VALUES (${"pc-evil-" + RUN}, ${ORG_B}, 'evil', 'sha')`));
    // Seed rows untouched (verified as superuser):
    const check = await adminSql`SELECT source FROM practice_claims WHERE id = ${claimB}`;
    expect(check[0].source).toBe("test");
  });

  it("3. service mode sees all orgs (worker contract)", async () => {
    await asApp({ service: true }, async (q) => {
      const claims = await q`SELECT id FROM practice_claims WHERE id IN (${claimA}, ${claimB})`;
      expect(claims.length).toBe(2);
    });
  });

  it("4. no context = fail closed: 0 rows on read, 42501 on insert", async () => {
    await asApp({}, async (q) => {
      const claims = await q`SELECT id FROM practice_claims`;
      expect(claims.length).toBe(0);
      const events = await q`SELECT id FROM suggestion_events`;
      expect(events.length).toBe(0);
    });
    await asAppSession({}, (q) =>
      expect42501(q`INSERT INTO suggestion_events (id, org_id, user_id, suggestion_id, surface, action, model_name)
        VALUES (${"se-evil-" + RUN}, ${ORG_A}, ${UA}, 's', 'next-actions', 'accepted', 'm')`));
  });

  it("5. multi-org context (next-actions shape): [A,B] sees A+B, not C", async () => {
    const claimC = `pc-c-${RUN}`;
    await adminSql`INSERT INTO practice_claims (id, "orgId", source, "contentSha256") VALUES (${claimC}, ${ORG_C}, 'test', 'sha-c')`;
    await asApp({ user: UAB, orgs: [ORG_A, ORG_B] }, async (q) => {
      const claims = await q`SELECT id FROM practice_claims`;
      expect(claims.map(r => r.id).sort()).toEqual([claimA, claimB].sort());
    });
    await adminSql`DELETE FROM practice_claims WHERE id = ${claimC}`;
  });

  it("6. nullable-org rows pinned to owning user, never org-wide", async () => {
    // Owner sees their NULL-org row without any org context:
    await asApp({ user: UA, orgs: [] }, async (q) => {
      const rows = await q`SELECT id FROM next_action_dismissals WHERE user_id = ${UA}`;
      expect(rows.map(r => r.id).sort()).toEqual([`nad-a-${RUN}`, dismissalNull].sort());
    });
    // Another user (org B context) does NOT see UA's NULL-org row:
    await asApp({ user: UB, orgs: [ORG_B] }, async (q) => {
      const rows = await q`SELECT id FROM next_action_dismissals`;
      expect(rows.length).toBe(0);
    });
    // Service mode sees it:
    await asApp({ service: true }, async (q) => {
      const rows = await q`SELECT id FROM next_action_dismissals WHERE id = ${dismissalNull}`;
      expect(rows.length).toBe(1);
    });
  });

  it("7. audit mode over seeded data: zero rls_shadow_diff + zero orphans", async () => {
    const prevMode = process.env.RLS_ENABLED;
    const prevPct = process.env.RLS_AUDIT_SAMPLE_PCT;
    process.env.RLS_ENABLED = "audit";
    process.env.RLS_AUDIT_SAMPLE_PCT = "100"; // probe every read
    try {
      const before = await adminSql`SELECT count(*)::int AS n FROM audit_log WHERE action = 'rls_shadow_diff'`;
      const rows = await withOrgContext({ userId: UA, orgIds: [ORG_A] }, async (tx) => {
        // Org-filtered the way the app actually queries (assertOrgMember +
        // WHERE orgId = ...) — the probe must find NO diff between the owner
        // result and the hp_app shadow result.
        const shadowed = await rlsShadow<Record<string, unknown>>(tx, "test.practice_claims.list",
          sql`SELECT id FROM practice_claims WHERE "orgId" = ${ORG_A}`);
        // Sanity: the org-context read returns org A rows via the helper path.
        const direct = await tx.execute(sql`SELECT id FROM practice_claims WHERE id = ${claimA}`);
        expect((direct as unknown as unknown[]).length).toBe(1);
        return shadowed;
      });
      expect(rows.length).toBeGreaterThanOrEqual(1);
      const after = await adminSql`SELECT count(*)::int AS n FROM audit_log WHERE action = 'rls_shadow_diff'`;
      expect(after[0].n - before[0].n).toBe(0);
      // Orphan scan (service context) — seeded data is consistent by
      // construction; nonzero means a policy/seed bug, not an app bug.
      const orphans = await scanOrgOrphans();
      const seededOrphans = Object.entries(orphans).filter(([k]) => !k.startsWith("disputes"));
      for (const [k, v] of seededOrphans) expect(v, `orphans in ${k}`).toBe(0);
    } finally {
      if (prevMode === undefined) delete process.env.RLS_ENABLED; else process.env.RLS_ENABLED = prevMode;
      if (prevPct === undefined) delete process.env.RLS_AUDIT_SAMPLE_PCT; else process.env.RLS_AUDIT_SAMPLE_PCT = prevPct;
    }
  });

  it("8. two-org submitter_clients: visible from both sides, writable only from submitter side", async () => {
    await asApp({ user: UA, orgs: [ORG_A] }, async (q) => {
      const rows = await q`SELECT id FROM submitter_clients WHERE id = ${scId}`;
      expect(rows.length).toBe(1);
    });
    await asApp({ user: UB, orgs: [ORG_B] }, async (q) => {
      const rows = await q`SELECT id FROM submitter_clients WHERE id = ${scId}`;
      expect(rows.length).toBe(1);
    });
    // Client side can READ but not WRITE (WITH CHECK anchors submitterOrgId).
    // Each rejected statement gets its OWN transaction: after a 42501 the
    // transaction is aborted (25P02) for any subsequent statement.
    await asAppSession({ user: UB, orgs: [ORG_B] }, (q) =>
      expect42501(q`UPDATE submitter_clients SET label = 'hijack' WHERE id = ${scId}`));
    await asAppSession({ user: UB, orgs: [ORG_B] }, (q) =>
      expect42501(q`INSERT INTO submitter_clients (id, "submitterOrgId", "clientOrgId", label) VALUES
        (${"sc-evil-" + RUN}, ${ORG_A}, ${ORG_B}, 'forged')`));
    // Submitter side can write:
    await asApp({ user: UA, orgs: [ORG_A] }, async (q) => {
      const upd = await q`UPDATE submitter_clients SET label = 'RLS link v2' WHERE id = ${scId}`;
      expect(upd.count).toBe(1);
    });
  });

  it("9. helper semantics: membership verification + nested-context guard", async () => {
    // FORBIDDEN for a non-member org (mirrors assertOrgMember):
    await expect(withOrgContext({ userId: UA, orgIds: [ORG_B] }, async () => 1)).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Verified intersection works for a real member (off-mode passthrough):
    const seen = await withOrgContext({ userId: UAB, orgIds: [ORG_A, ORG_B] }, async (db) => {
      const r = await db.execute(sql`SELECT 1 AS ok`);
      return (r as unknown as Array<{ ok: number }>)[0].ok;
    });
    expect(seen).toBe(1);
    // Nested org context with DIFFERENT orgs throws (design §2.2 rule 4):
    await expect(
      withOrgContext({ userId: UAB, orgIds: [ORG_A] }, () =>
        withOrgContext({ userId: UAB, orgIds: [ORG_B] }, async () => 1))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Same-orgs nesting reuses the outer context:
    const nested = await withOrgContext({ userId: UAB, orgIds: [ORG_A] }, () =>
      withOrgContext({ userId: UAB, orgIds: [ORG_A] }, async () => "ok"));
    expect(nested).toBe("ok");
    // Service context inside an org context throws (no widening mid-request):
    await expect(
      withOrgContext({ userId: UAB, orgIds: [ORG_A] }, () =>
        withServiceContext({ service: true, label: "sneaky" }, async () => 1))
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    // Invalid org id format rejected:
    await expect(withOrgContext({ userId: UA, orgIds: ["a,b']--"] }, async () => 1)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
