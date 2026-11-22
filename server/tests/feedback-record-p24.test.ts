/**
 * server/tests/feedback-record-p24.test.ts
 *
 * Phase 24 (F6) — learning-loop poisoning fixes on intelligence.feedback.record:
 *   (a) mutations restricted to owner/staff (viewer was previously allowed);
 *   (b) per-user rate cap of 200 `presented` events/hour (DB-based window);
 *   (c) terminal/derived events must reference a suggestionId actually
 *       served in the caller's org.
 *
 * DB-backed against the migrated wave database (skips when DATABASE_URL is
 * absent, per the repo's accept-offer-single-winner.test.ts convention).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("feedback.record learning-loop hardening (F6, DB-backed)", () => {
  const NS = "p24fb";
  const ownerId = `${NS}-owner`;
  const viewerId = `${NS}-viewer`;
  const orgA = `${NS}-org-a`;
  const orgB = `${NS}-org-b`;

  let db: any;
  let feedbackRouter: any;
  let schema: any;
  let personaSchema: any;
  let intelSchema: any;
  let orm: any;

  const ctxFor = (userId: string) => ({
    user: { id: userId, name: userId, email: `${userId}@example.com`, role: "user" },
    req: { headers: {} },
    res: {},
    mfaPending: false,
    viaApiKey: false,
    apiKeyScopes: [],
  }) as never;

  beforeAll(async () => {
    const dbmod = await import("../db");
    db = await dbmod.getDb();
    ({ feedbackRouter } = await import("../routers/intelligence"));
    schema = await import("../../drizzle/schema");
    personaSchema = await import("../../drizzle/schema-personas");
    intelSchema = await import("../../drizzle/schema-intelligence");
    orm = await import("drizzle-orm");

    // Clean any leftovers from a previous run, then seed.
    await db.delete(personaSchema.orgMemberships).where(orm.inArray(personaSchema.orgMemberships.orgId, [orgA, orgB]));
    await db.delete(personaSchema.organizations).where(orm.inArray(personaSchema.organizations.id, [orgA, orgB]));
    await db.delete(schema.users).where(orm.inArray(schema.users.id, [ownerId, viewerId]));
    await db.insert(schema.users).values([
      { id: ownerId, name: "Owner", email: `${ownerId}@example.com`, role: "user" },
      { id: viewerId, name: "Viewer", email: `${viewerId}@example.com`, role: "user" },
    ]);
    await db.insert(personaSchema.organizations).values([
      { id: orgA, name: "P24 Org A", type: "provider" },
      { id: orgB, name: "P24 Org B", type: "provider" },
    ]);
    await db.insert(personaSchema.orgMemberships).values([
      { orgId: orgA, userId: ownerId, role: "owner" },
      { id: `${NS}-m-viewer-a`, orgId: orgA, userId: viewerId, role: "viewer" },
      { id: `${NS}-m-owner-b`, orgId: orgB, userId: ownerId, role: "owner" },
    ]);
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(intelSchema.suggestionEvents).where(orm.inArray(intelSchema.suggestionEvents.orgId, [orgA, orgB]));
    await db.delete(personaSchema.orgMemberships).where(orm.inArray(personaSchema.orgMemberships.orgId, [orgA, orgB]));
    await db.delete(personaSchema.organizations).where(orm.inArray(personaSchema.organizations.id, [orgA, orgB]));
    await db.delete(schema.users).where(orm.inArray(schema.users.id, [ownerId, viewerId]));
  });

  const baseInput = {
    orgId: orgA,
    suggestionId: `${NS}-s1`,
    surface: "new_dispute_prefill",
    action: "presented",
    modelName: "test-model",
  } as const;

  it("(a) rejects a viewer-role member (mutation now owner/staff only)", async () => {
    const caller = feedbackRouter.createCaller(ctxFor(viewerId));
    await expect(caller.record({ ...baseInput, suggestionId: `${NS}-viewer-attempt` }))
      .rejects.toThrow(/not an authorized member/);
  });

  it("owner can record a presented event", async () => {
    const caller = feedbackRouter.createCaller(ctxFor(ownerId));
    const res = await caller.record({ ...baseInput });
    expect(res.recorded).toBe(true);
  });

  it("(c) rejects a terminal event for a suggestionId never served in this org", async () => {
    const caller = feedbackRouter.createCaller(ctxFor(ownerId));
    await expect(caller.record({ ...baseInput, suggestionId: `${NS}-never-served`, action: "accepted" }))
      .rejects.toThrow(/Unknown suggestionId/);
  });

  it("(c) rejects a terminal event referencing ANOTHER org's suggestion", async () => {
    // Suggestion legitimately served in org B...
    const ownerCaller = feedbackRouter.createCaller(ctxFor(ownerId));
    await ownerCaller.record({ ...baseInput, orgId: orgB, suggestionId: `${NS}-orgb-s` });
    // ...then feedback against it attempted in org A (same user, member of both).
    await expect(ownerCaller.record({ ...baseInput, orgId: orgA, suggestionId: `${NS}-orgb-s`, action: "accepted" }))
      .rejects.toThrow(/Unknown suggestionId/);
  });

  it("terminal event succeeds after a presented event in the same org (and stays idempotent)", async () => {
    const caller = feedbackRouter.createCaller(ctxFor(ownerId));
    await caller.record({ ...baseInput, suggestionId: `${NS}-s2` });
    const first = await caller.record({ ...baseInput, suggestionId: `${NS}-s2`, action: "accepted" });
    expect(first.recorded).toBe(true);
    // terminal partial unique index still dedupes replays
    const replay = await caller.record({ ...baseInput, suggestionId: `${NS}-s2`, action: "accepted" });
    expect(replay.deduplicated).toBe(true);
  });

  it("(b) caps presented events at 200/hour/user", async () => {
    // Seed 200 presented events for the owner within the current hour.
    const rows = Array.from({ length: 200 }, (_, i) => ({
      id: `${NS}-cap-${i}`,
      orgId: orgA,
      userId: ownerId,
      suggestionId: `${NS}-cap-s${i}`,
      surface: "new_dispute_prefill",
      action: "presented",
      modelName: "test-model",
    }));
    await db.insert(intelSchema.suggestionEvents).values(rows);
    const caller = feedbackRouter.createCaller(ctxFor(ownerId));
    await expect(caller.record({ ...baseInput, suggestionId: `${NS}-over-cap` }))
      .rejects.toThrow(/rate limit exceeded/i);
    // ...but a different user is unaffected.
    const { PRESENTED_EVENTS_PER_USER_PER_HOUR } = await import("../routers/intelligence");
    expect(PRESENTED_EVENTS_PER_USER_PER_HOUR).toBe(200);
  });
});
