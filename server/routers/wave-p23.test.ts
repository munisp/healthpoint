/**
 * Phase 23 wave test (live PG, DATABASE_URL-gated): DataSketches KLL/HLL
 * adoption with the extension ABSENT (sandbox pgserver has no datasketches).
 *
 *  - migration 0058 applied: outcome_segment_sketches exists.
 *  - capability probe returns false; every path fails closed to exact.
 *  - learning-loop refresh step 6 writes outcome_segment_sketches rows with
 *    NULL sketch and EXACT row_count; full recompute is idempotent (no
 *    double-count on re-run).
 *  - outcome prediction read path: estimateProvenance "exact", all pre-P23
 *    fields byte-identical to the pure P22 recomputation.
 *  - intelligence.ingestCardinality: exact counts vs seeded practice_claims,
 *    provenance "exact", sketchCapable false; cross-org FORBIDDEN.
 *
 * Sketch-path live execution is STATIC-ONLY (no extension in this sandbox):
 * the SQL builders are unit-tested in server/idr/sketches.test.ts.
 *
 * EXECUTED-VERIFIED when DATABASE_URL is set; skipped otherwise.
 */
import "../journeys/env-defaults";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { rootRouter } from "../app-router";
import { makeCtxForUser } from "../journeys/framework";
import { getDb } from "../db";
import { users as usersTable, disputes } from "../../drizzle/schema";
import { outcomeSegmentSketches } from "../../drizzle/schema-intelligence";
import { practiceClaims } from "../../drizzle/schema-practice-claims";
import { runLearningLoopRefresh } from "../scheduled/learningLoopRefresh";
import { generateOutcomePredictionFromModel } from "../idr/outcome-prediction-source";
import {
  outcomeChainFromParams,
  predictOutcomeV2,
  type OutcomeModelParameters,
} from "../idr/outcome-model-v2";
import {
  probeSketchCapability,
  sketchesActive,
  resetSketchProbeCacheForTests,
} from "../idr/sketches";
import { canonicalSegmentKey } from "../idr/segment-keys";
import { modelVersions } from "../../drizzle/schema-intelligence";
import crypto from "node:crypto";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const RUN = Date.now().toString(36);
const U1 = `p23-u1-${RUN}`;
const U2 = `p23-u2-${RUN}`;
const IDRE = `p23-idre-${RUN}`;
const LEAF_KEY = canonicalSegmentKey("idr_entity_x_service_x_patientstate", {
  idrEntityId: IDRE, serviceType: "emergency_medicine", patientState: "TX",
});

describe.skipIf(!HAS_DB)("Phase23 DataSketches adoption (live PG, extension absent)", () => {
  let caller: ReturnType<typeof rootRouter.createCaller>;
  let outsider: ReturnType<typeof rootRouter.createCaller>;
  let orgId = "";
  let otherOrgId = "";

  beforeAll(async () => {
    const db = await getDb();
    expect(db).toBeTruthy();
    for (const [id, name] of [[U1, "P23 User"], [U2, "P23 Outsider"]] as const) {
      await db!.insert(usersTable)
        .values({ id, name, email: `${id}@test.local`, loginMethod: "test", role: "user" })
        .onConflictDoNothing();
    }
    const [u1] = await db!.select().from(usersTable).where(eq(usersTable.id, U1)).limit(1);
    const [u2] = await db!.select().from(usersTable).where(eq(usersTable.id, U2)).limit(1);
    caller = rootRouter.createCaller(makeCtxForUser(u1));
    outsider = rootRouter.createCaller(makeCtxForUser(u2));
    const org = await caller.orgs.create({ name: `P23 Org ${RUN}`, type: "provider" });
    orgId = org.orgId;
    const other = await outsider.orgs.create({ name: `P23 Other ${RUN}`, type: "provider" });
    otherOrgId = other.orgId;

    // 30 closed determinations in a unique leaf segment (18/12 wins) —
    // activates outcome-model-v2 AND feeds the sketch write path.
    for (let i = 0; i < 30; i++) {
      await db!.insert(disputes).values({
        id: `p23-det-${RUN}-${i}`,
        referenceNumber: `P23D-${RUN}-${i}`.slice(0, 60),
        initiatingPartyId: U1,
        initiatingPartyType: "provider",
        initiatingPartyName: "P23 Provider",
        respondingPartyName: "P23 Payer",
        serviceType: "emergency_medicine",
        serviceDate: new Date("2026-06-01"),
        patientState: "TX", facilityState: "TX",
        cptCodes: ["99285"],
        billedAmount: "2000",
        qpaAmount: "1000",
        determinationAmount: i % 2 === 0 ? "1200" : "1000",
        determinationWinner: i < 18 ? "initiating_party" : "responding_party",
        idrEntityId: IDRE,
        status: "closed",
        createdBy: U1,
      }).onConflictDoNothing();
    }
    // Bulk-ingested claims surface with known distinct counts:
    // 3 patients, 2 rendering NPIs, 4 ICNs over 6 rows.
    for (let i = 0; i < 6; i++) {
      await db!.insert(practiceClaims).values({
        id: `p23-pc-${RUN}-${i}`, orgId, source: "csv",
        contentSha256: crypto.createHash("sha256").update(`p23-pc-${RUN}-${i}`).digest("hex"),
        patientRef: `p23-pat-${RUN}-${i % 3}`,
        renderingNpi: `123456789${i % 2}`,
        claimId: `p23-icn-${RUN}-${i % 4}`,
      });
    }
    resetSketchProbeCacheForTests();
  }, 120000);

  afterAll(() => {
    delete process.env.SKETCHES_ENABLED;
    delete process.env.SKETCH_MIN_ROWS;
  });

  it("migration 0058 applied: outcome_segment_sketches exists with expected columns", async () => {
    const db = (await getDb())!;
    const cols = (await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'outcome_segment_sketches' ORDER BY ordinal_position
    `)) as unknown as Array<{ column_name: string }>;
    const names = (Array.isArray(cols) ? cols : []).map(c => c.column_name);
    expect(names).toEqual(["id", "org_id", "segment_key", "sketch", "row_count", "updated_at"]);
  });

  it("probe: datasketches extension absent → capability false, all gates fail closed", async () => {
    const db = (await getDb())!;
    resetSketchProbeCacheForTests();
    expect(await probeSketchCapability(db)).toBe(false);
    // auto (default): absent → inactive
    expect(await sketchesActive(db)).toBe(false);
    // on: require → fail CLOSED to exact with a warning, still inactive
    process.env.SKETCHES_ENABLED = "on";
    expect(await sketchesActive(db)).toBe(false);
    // off: never
    process.env.SKETCHES_ENABLED = "off";
    expect(await sketchesActive(db)).toBe(false);
    delete process.env.SKETCHES_ENABLED;
    resetSketchProbeCacheForTests();
  });

  it("refresh step 6 writes exact rows with NULL sketch; recompute is idempotent", async () => {
    const db = (await getDb())!;
    const out = await runLearningLoopRefresh(db, new Date());
    expect(out.sketches?.error).toBeUndefined();
    expect(out.sketches?.result?.sketchActive).toBe(false);
    expect(out.outcomeModel?.training?.status).toBe("active");

    const rows = await db.select().from(outcomeSegmentSketches)
      .where(eq(outcomeSegmentSketches.orgId, orgId));
    expect(rows.length).toBeGreaterThanOrEqual(5); // 5 tiers for one segment
    const leaf = rows.find(r => r.segmentKey === LEAF_KEY);
    expect(leaf).toBeTruthy();
    expect(leaf!.sketch).toBeNull(); // extension absent → exact mode
    expect(leaf!.rowCount).toBe(30);
    const platform = rows.find(r => r.segmentKey === "platform");
    expect(platform).toBeTruthy();
    expect(platform!.rowCount).toBe(30);

    // Exactness cross-check against an independent count.
    const exact = (await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM disputes
      WHERE "determinationWinner" IS NOT NULL AND "determinationAmount" IS NOT NULL
        AND "idrEntityId" = ${IDRE}
    `)) as unknown as Array<{ n: number }>;
    expect(Number((Array.isArray(exact) ? exact : [])[0]?.n)).toBe(30);

    // Idempotent full recompute: a second refresh must NOT accumulate.
    const again = await runLearningLoopRefresh(db, new Date());
    expect(again.sketches?.error).toBeUndefined();
    const rows2 = await db.select().from(outcomeSegmentSketches)
      .where(eq(outcomeSegmentSketches.orgId, orgId));
    const leaf2 = rows2.find(r => r.segmentKey === LEAF_KEY);
    expect(leaf2!.rowCount).toBe(30);
    expect(rows2.length).toBe(rows.length);
  });

  it("prediction read path: provenance exact, byte-identical to the P22 recomputation", async () => {
    const db = (await getDb())!;
    const d = (await db.select().from(disputes).where(eq(disputes.id, `p23-det-${RUN}-0`)).limit(1))[0];
    const trained = await generateOutcomePredictionFromModel(db, d);
    expect(trained).toBeTruthy();
    expect(trained!.source).toBe("trained");
    expect(trained!.estimateProvenance).toBe("exact");

    // Independent pure recomputation from the active model's parameters —
    // every pre-P23 field must match it exactly (cold-start contract).
    const mv = (await db.select().from(modelVersions)
      .where(eq(modelVersions.modelName, "outcome-model-v2"))
      .orderBy(sql`version DESC`).limit(1))[0];
    const chain = outcomeChainFromParams(mv.parameters as OutcomeModelParameters, {
      idrEntityId: IDRE, serviceType: "emergency_medicine", patientState: "TX",
    });
    const expected = predictOutcomeV2(chain);
    expect(expected).toBeTruthy();
    expect(trained!.winProbability).toBe(Math.round(expected!.winProb * 100));
    expect(trained!.prediction.winProb).toBe(expected!.winProb);
    expect(trained!.prediction.awardP25Usd).toBe(expected!.awardP25Usd);
    expect(trained!.prediction.awardP50Usd).toBe(expected!.awardP50Usd);
    expect(trained!.prediction.awardP75Usd).toBe(expected!.awardP75Usd);
    expect(trained!.confidenceScore).toBe(expected!.confidenceScore);
    expect(trained!.segmentKey).toBe(LEAF_KEY);
    // P22 honesty strings unchanged in exact mode.
    expect(trained!.keyFactors.join("\n")).toContain("Segment award quantiles: P25");
    expect(trained!.keyFactors.join("\n")).not.toContain("KLL");
    expect(trained!.recommendation).not.toContain("kll_sketch");
  });

  it("intelligence.ingestCardinality: exact counts, per-metric provenance, org-scoped", async () => {
    const r = await caller.intelligence.ingestCardinality({ orgId });
    expect(r.rowCount).toBe(6);
    expect(r.sketchCapable).toBe(false);
    expect(r.patients).toEqual({ value: 3, estimateProvenance: "exact" });
    expect(r.renderingNpis).toEqual({ value: 2, estimateProvenance: "exact" });
    expect(r.icns).toEqual({ value: 4, estimateProvenance: "exact" });

    // Even with the gate forced on and the threshold lowered, the absent
    // extension keeps every metric exact (capability dominates).
    process.env.SKETCHES_ENABLED = "on";
    process.env.SKETCH_MIN_ROWS = "1";
    resetSketchProbeCacheForTests();
    const forced = await caller.intelligence.ingestCardinality({ orgId });
    expect(forced.patients.estimateProvenance).toBe("exact");
    expect(forced.patients.value).toBe(3);
    delete process.env.SKETCHES_ENABLED;
    delete process.env.SKETCH_MIN_ROWS;
    resetSketchProbeCacheForTests();

    // Org isolation: outsider cannot read org A's cardinality; their own org
    // has an empty claims surface.
    await expect(outsider.intelligence.ingestCardinality({ orgId }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    const empty = await outsider.intelligence.ingestCardinality({ orgId: otherOrgId });
    expect(empty.rowCount).toBe(0);
    expect(empty.patients.value).toBe(0);
  });
});
