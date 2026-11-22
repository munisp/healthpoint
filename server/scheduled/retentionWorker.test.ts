import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { retentionDays, runRetentionPurge, retentionWorkerHandler, DEFAULT_RETENTION_DAYS } from "./retentionWorker";

describe("retentionDays config", () => {
  it("defaults to 90 and honors RETENTION_DAYS", () => {
    expect(DEFAULT_RETENTION_DAYS).toBe(90);
    expect(retentionDays({})).toBe(90);
    expect(retentionDays({ RETENTION_DAYS: "30" })).toBe(30);
    expect(retentionDays({ RETENTION_DAYS: "garbage" })).toBe(90);
    expect(retentionDays({ RETENTION_DAYS: "-5" })).toBe(90);
  });
});

const DB_URL = process.env.DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;

describe("retentionWorkerHandler (HTTP mount)", () => {
  it("responds ok with purge counts (no DB → zero counts)", async () => {
    const calls: Array<{ status?: number; body: unknown }> = [];
    const res = {
      status(n: number) { return { json(body: unknown) { calls.push({ status: n, body }); } }; },
      json(body: unknown) { calls.push({ body }); },
    };
    await retentionWorkerHandler({}, res);
    expect(calls).toHaveLength(1);
    const body = calls[0].body as { ok: boolean; retentionDays: number; fhirCachePurged: number; smartFormExtractionsPurged: number };
    expect(body.ok).toBe(true);
    expect(body.retentionDays).toBe(DEFAULT_RETENTION_DAYS);
    expect(body.fhirCachePurged).toBe(0);
    expect(body.smartFormExtractionsPurged).toBe(0);
  });
});

describeDb("runRetentionPurge (DB)", () => {
  const sql = postgres(DB_URL!, { max: 1 });
  const run = Date.now();
  const oldCache = `w6ret-old-${run}`;
  const newCache = `w6ret-new-${run}`;
  const oldSfe = `w6ret-sfe-old-${run}`;
  const newSfe = `w6ret-sfe-new-${run}`;

  beforeAll(async () => {
    await sql.unsafe(
      `INSERT INTO fhir_resource_cache (id, "emrConnectionId", "resourceType", "resourceId", "resourceData", "fetchedAt")
       VALUES ($1, 'conn-ret', 'Claim', 'c1', '{}', now() - interval '120 days'), ($2, 'conn-ret', 'Claim', 'c2', '{}', now())`,
      [oldCache, newCache],
    );
    await sql.unsafe(
      `INSERT INTO smart_form_extractions (id, "userId", "targetForm", "inputType", "extractedFields", status, "createdAt")
       VALUES ($1, 'u1', 'generic', 'text', '{}', 'complete', now() - interval '120 days'), ($2, 'u1', 'generic', 'text', '{}', 'complete', now())`,
      [oldSfe, newSfe],
    );
  });

  afterAll(async () => {
    await sql.unsafe(`DELETE FROM fhir_resource_cache WHERE id IN ($1, $2)`, [oldCache, newCache]);
    await sql.unsafe(`DELETE FROM smart_form_extractions WHERE id IN ($1, $2)`, [oldSfe, newSfe]);
    await sql.end();
  });

  it("deletes rows older than the retention window only", async () => {
    const r = await runRetentionPurge(90);
    expect(r.fhirCachePurged).toBeGreaterThanOrEqual(1);
    expect(r.smartFormExtractionsPurged).toBeGreaterThanOrEqual(1);
    const remaining = await sql.unsafe(
      `SELECT (SELECT count(*) FROM fhir_resource_cache WHERE id = $1)::int AS old_cache,
              (SELECT count(*) FROM fhir_resource_cache WHERE id = $2)::int AS new_cache,
              (SELECT count(*) FROM smart_form_extractions WHERE id = $3)::int AS old_sfe,
              (SELECT count(*) FROM smart_form_extractions WHERE id = $4)::int AS new_sfe`,
      [oldCache, newCache, oldSfe, newSfe],
    );
    expect(remaining[0]).toEqual({ old_cache: 0, new_cache: 1, old_sfe: 0, new_sfe: 1 });
  });
});

// ─── Phase 21: suggestion_events + next_action_dismissals retention ─────────
import { suggestionEventsRetentionDays, DEFAULT_SUGGESTION_EVENTS_RETENTION_DAYS } from "./retentionWorker";

describe("suggestionEventsRetentionDays config", () => {
  it("defaults to 365 and honors SUGGESTION_EVENTS_RETENTION_DAYS", () => {
    expect(DEFAULT_SUGGESTION_EVENTS_RETENTION_DAYS).toBe(365);
    expect(suggestionEventsRetentionDays({})).toBe(365);
    expect(suggestionEventsRetentionDays({ SUGGESTION_EVENTS_RETENTION_DAYS: "30" })).toBe(30);
    expect(suggestionEventsRetentionDays({ SUGGESTION_EVENTS_RETENTION_DAYS: "garbage" })).toBe(365);
  });
});

describeDb("runRetentionPurge — phase21 tables (DB)", () => {
  const sql2 = postgres(DB_URL!, { max: 1 });
  const run = Date.now();
  const oldEv = `p21ret-old-${run}`;
  const newEv = `p21ret-new-${run}`;
  const oldDis = `p21ret-dis-old-${run}`;
  const newDis = `p21ret-dis-new-${run}`;

  beforeAll(async () => {
    await sql2.unsafe(
      `INSERT INTO suggestion_events (id, org_id, user_id, suggestion_id, surface, action, model_name, created_at)
       VALUES ($1, 'org-ret', 'u1', 's1', 'next_action', 'presented', 'next-actions-v1', now() - interval '400 days'),
              ($2, 'org-ret', 'u1', 's2', 'next_action', 'presented', 'next-actions-v1', now())`,
      [oldEv, newEv],
    );
    await sql2.unsafe(
      `INSERT INTO next_action_dismissals (id, org_id, user_id, action_key, expires_at)
       VALUES ($1, NULL, 'u1', $3, now() - interval '1 day'), ($2, NULL, 'u1', $4, now() + interval '7 days')`,
      [oldDis, newDis, `deadline:x:payment-${run}`, `deadline:y:payment-${run}`],
    );
  });

  afterAll(async () => {
    await sql2.unsafe(`DELETE FROM suggestion_events WHERE id IN ($1, $2)`, [oldEv, newEv]);
    await sql2.unsafe(`DELETE FROM next_action_dismissals WHERE id IN ($1, $2)`, [oldDis, newDis]);
    await sql2.end();
  });

  it("purges suggestion_events past 365d and expired dismissals only", async () => {
    const r = await runRetentionPurge(90);
    expect(r.suggestionEventsPurged).toBeGreaterThanOrEqual(1);
    expect(r.nextActionDismissalsPurged).toBeGreaterThanOrEqual(1);
    const remaining = await sql2.unsafe(
      `SELECT (SELECT count(*) FROM suggestion_events WHERE id = $1)::int AS old_ev,
              (SELECT count(*) FROM suggestion_events WHERE id = $2)::int AS new_ev,
              (SELECT count(*) FROM next_action_dismissals WHERE id = $3)::int AS old_dis,
              (SELECT count(*) FROM next_action_dismissals WHERE id = $4)::int AS new_dis`,
      [oldEv, newEv, oldDis, newDis],
    );
    expect(remaining[0]).toEqual({ old_ev: 0, new_ev: 1, old_dis: 0, new_dis: 1 });
  });
});
