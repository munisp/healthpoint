/**
 * Phase 22 wave test (live PG, DATABASE_URL-gated): closed learning loop.
 *
 *  - offerStrategy.recommendV2: bandit block appears only with an estimate;
 *    min_pulls gate serves baseline with statistical_estimate; strong
 *    posteriors serve a learned arm labeled bandit_active with the baseline
 *    disclosed; per-org isolation (org B invisible to org A's posteriors).
 *  - bandit.stats: org-scoped transparency + cross-org FORBIDDEN.
 *  - nextActions.list: learned re-order within severity only, above
 *    RANKING_MIN_IMPRESSIONS; fresh org → static_ordering; dismiss records a
 *    `rejected` suggestion event.
 *  - prefill.quarantineRows: eligible (field, source) confidence blended ≤
 *    ±50% with learnedConfidence flag; ineligible keeps base confidence.
 *  - outcomeModel.calibration: org-scoped; thin → metrics withheld; cross-org
 *    FORBIDDEN.
 *
 * EXECUTED-VERIFIED when DATABASE_URL is set; skipped otherwise.
 */
import "../journeys/env-defaults";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { rootRouter } from "../app-router";
import { makeCtxForUser } from "../journeys/framework";
import { getDb } from "../db";
import { users as usersTable, disputes } from "../../drizzle/schema";
import {
  suggestionEvents,
  banditAssignments,
  banditArmStats,
  rankingStats,
} from "../../drizzle/schema-intelligence";
import { bulkUploadSessions, claimQuarantine } from "../../drizzle/schema-bulk-upload";
import { practiceClaims } from "../../drizzle/schema-practice-claims";
import { runOfferModelTraining } from "../scheduled/offerModelRefresh";
import { refreshRankingStats } from "../scheduled/learningLoopRefresh";
import { canonicalSegmentKey } from "../idr/segment-keys";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const RUN = Date.now().toString(36);
const U1 = `p22-u1-${RUN}`;
const U2 = `p22-u2-${RUN}`;
const IDRE = `p22-idre-${RUN}`;
const SEG_KEY = canonicalSegmentKey("idr_entity_x_service_x_patientstate", {
  idrEntityId: IDRE, serviceType: "emergency_medicine", patientState: "TX",
});

function claimLine(i: number): string {
  return JSON.stringify({
    resourceType: "Claim",
    id: `p22-clm-${RUN}-${i}`,
    identifier: [{ value: `P22-${RUN}-${i}` }],
    status: "active",
    patient: { reference: `Patient/p22-pat-${RUN}` },
    billablePeriod: { start: "2026-08-01", end: "2026-08-01" },
    insurer: { reference: "Organization/p22-payer", display: "AETNA HEALTH" },
    item: [{ sequence: 1, productOrService: { coding: [{ system: "http://www.ama-assn.org/go/cpt", code: "99285" }] }, servicedDate: "2026-08-01" }],
    total: { value: 4200.0, currency: "USD" },
  });
}

describe.skipIf(!HAS_DB)("Phase22 closed learning loop (live PG)", () => {
  let caller: ReturnType<typeof rootRouter.createCaller>;
  let outsider: ReturnType<typeof rootRouter.createCaller>;
  let orgId = "";
  let otherOrgId = "";
  let openDisputeId = "";
  let idleDisputeId = "";

  beforeAll(async () => {
    const db = await getDb();
    expect(db).toBeTruthy();
    for (const [id, name] of [[U1, "P22 User"], [U2, "P22 Outsider"]] as const) {
      await db!.insert(usersTable)
        .values({ id, name, email: `${id}@test.local`, loginMethod: "test", role: "user" })
        .onConflictDoNothing();
    }
    const [u1] = await db!.select().from(usersTable).where(eq(usersTable.id, U1)).limit(1);
    const [u2] = await db!.select().from(usersTable).where(eq(usersTable.id, U2)).limit(1);
    caller = rootRouter.createCaller(makeCtxForUser(u1));
    outsider = rootRouter.createCaller(makeCtxForUser(u2));
    const org = await caller.orgs.create({ name: `P22 Org ${RUN}`, type: "provider" });
    orgId = org.orgId;
    const other = await outsider.orgs.create({ name: `P22 Other ${RUN}`, type: "provider" });
    otherOrgId = other.orgId;

    // 25 closed determinations in a unique leaf segment.
    for (let i = 0; i < 25; i++) {
      await db!.insert(disputes).values({
        id: `p22-det-${RUN}-${i}`,
        referenceNumber: `P22D-${RUN}-${i}`.slice(0, 60),
        initiatingPartyId: U1,
        initiatingPartyType: "provider",
        initiatingPartyName: "P22 Provider",
        respondingPartyName: "P22 Payer",
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
    // Open dispute for recommendations (leaf segment covered).
    openDisputeId = `p22-open-${RUN}`;
    await db!.insert(disputes).values({
      id: openDisputeId,
      referenceNumber: `P22O-${RUN}`,
      initiatingPartyId: U1,
      initiatingPartyType: "provider",
      initiatingPartyName: "P22 Provider",
      respondingPartyName: "P22 Payer",
      serviceType: "emergency_medicine",
      serviceDate: new Date("2026-08-01"),
      patientState: "TX", facilityState: "TX",
      cptCodes: ["99285"],
      billedAmount: "2000",
      qpaAmount: "1000",
      respondingPartyOffer: "600",
      idrEntityId: IDRE,
      status: "offer_submission",
      createdBy: U1,
    }).onConflictDoNothing();
    // Idle-offer dispute (for the ranking test): offer_submission, no
    // initiating offer, idle > 2 business days, severity "info". 6 calendar
    // days back always yields 4-5 business days regardless of the weekday the
    // suite runs on (3 days collapses to exactly 2 business days on weekends).
    idleDisputeId = `p22-idle-${RUN}`;
    await db!.insert(disputes).values({
      id: idleDisputeId,
      referenceNumber: `P22I-${RUN}`,
      initiatingPartyId: U1,
      initiatingPartyType: "provider",
      initiatingPartyName: "P22 Provider",
      respondingPartyName: "P22 Payer",
      serviceType: "emergency_medicine",
      serviceDate: new Date("2026-08-01"),
      patientState: "TX", facilityState: "TX",
      cptCodes: ["99285"],
      billedAmount: "2000",
      qpaAmount: "1000",
      idrEntityId: IDRE,
      status: "offer_submission",
      createdBy: U1,
      createdAt: new Date(Date.now() - 6 * 86400000),
      updatedAt: new Date(Date.now() - 6 * 86400000),
    }).onConflictDoNothing();

    const t = await runOfferModelTraining(db!, new Date());
    expect(t.status).toBe("active");
  }, 120000);

  afterAll(() => {
    delete process.env.OFFER_BANDIT_EXPLORATION_RATE;
  });

  // ── S1: bandit serve path ────────────────────────────────────────────────
  it("recommendV2: bandit block present, min_pulls gate serves the baseline", async () => {
    const r = await caller.offerStrategy.recommendV2({ orgId, disputeId: openDisputeId });
    expect(r.label).toBe("statistical_estimate");
    expect(r.bandit).toBeTruthy();
    expect(r.bandit!.gate).toBe("min_pulls");
    expect(r.bandit!.active).toBe(false);
    expect(r.bandit!.armId).toBe("delta_bps_0");
    expect(r.recommendedOfferUsdStatisticalEstimate).toBe(r.bandit!.baselineUsd);
    // Assignment recorded, linked to the presented event.
    const db = (await getDb())!;
    const asns = await db.select().from(banditAssignments)
      .where(eq(banditAssignments.suggestionId, r.suggestionId));
    expect(asns).toHaveLength(1);
    expect(asns[0].orgId).toBe(orgId);
    expect(asns[0].exploration).toBe(false);
    expect(asns[0].outcome).toBeNull();
  });

  it("recommendV2: insufficient_data → bandit never runs", async () => {
    // A dispute in a segment with NO coverage anywhere except platform would
    // need platform below floor; instead disable the anchor: no QPA and no
    // initial payment → estimate null → bandit block null.
    const db = (await getDb())!;
    const noAnchor = `p22-noanchor-${RUN}`;
    await db.insert(disputes).values({
      id: noAnchor,
      referenceNumber: `P22N-${RUN}`,
      initiatingPartyId: U1, initiatingPartyType: "provider",
      initiatingPartyName: "P22 Provider", respondingPartyName: "P22 Payer",
      serviceType: "emergency_medicine", serviceDate: new Date("2026-08-01"),
      patientState: "TX", facilityState: "TX", cptCodes: ["99285"],
      billedAmount: "2000", qpaAmount: null, respondingPartyOffer: null,
      idrEntityId: IDRE, status: "offer_submission", createdBy: U1,
    }).onConflictDoNothing();
    const r = await caller.offerStrategy.recommendV2({ orgId, disputeId: noAnchor });
    expect(r.recommendedOfferUsdStatisticalEstimate).toBeNull();
    expect(r.bandit).toBeNull();
    const asns = await db.select().from(banditAssignments)
      .where(eq(banditAssignments.suggestionId, r.suggestionId));
    expect(asns).toHaveLength(0);
  });

  it("recommendV2: strong posterior serves the learned arm labeled bandit_active; org B isolated", async () => {
    process.env.OFFER_BANDIT_EXPLORATION_RATE = "1"; // lift the rate cap for this test
    const db = (await getDb())!;
    // Strong +500bps posterior for THIS org×segment (pulls 24 ≥ min_pulls).
    await db.insert(banditArmStats).values({
      id: crypto.randomUUID(), orgId, segmentTier: "idr_entity_x_service_x_patientstate",
      segmentKey: SEG_KEY, armId: "delta_bps_+500", alpha: 97, beta: 3, pulls: 96, served: 96,
    });
    const r = await caller.offerStrategy.recommendV2({ orgId, disputeId: openDisputeId });
    expect(r.bandit).toBeTruthy();
    expect(r.bandit!.gate).toBe("active");
    expect(r.bandit!.armId).toBe("delta_bps_+500");
    expect(r.bandit!.exploration).toBe(true);
    expect(r.bandit!.active).toBe(true);
    expect(r.label).toBe("bandit_active");
    expect(r.modelVersion.honestyLabel).toBe("bandit_active");
    // Baseline always disclosed; served = baseline × 1.05.
    expect(r.bandit!.baselineUsd).not.toBeNull();
    expect(r.recommendedOfferUsdStatisticalEstimate).toBe(
      Math.round(r.bandit!.baselineUsd * 1.05 * 100) / 100,
    );
    expect(r.honestyNote).toContain("bounded, per-organization learning process");
    // Event metadata carries the arm.
    const evs = await db.select().from(suggestionEvents)
      .where(and(eq(suggestionEvents.suggestionId, r.suggestionId), eq(suggestionEvents.action, "presented")));
    expect((evs[0].metadata as Record<string, unknown>).banditArmId).toBe("delta_bps_+500");
    delete process.env.OFFER_BANDIT_EXPLORATION_RATE;

    // Cross-org isolation: org B's recommendV2 sees NO posteriors → min_pulls.
    // (Org B has no dispute of its own; assert via arm-stats invisibility.)
    const bStats = await db.select().from(banditArmStats).where(eq(banditArmStats.orgId, otherOrgId));
    expect(bStats).toHaveLength(0);
    // And org A's posteriors are keyed by org_id — structural isolation.
    const aStats = await db.select().from(banditArmStats).where(eq(banditArmStats.orgId, orgId));
    expect(aStats.length).toBeGreaterThan(0);
  });

  it("bandit.stats: org-scoped transparency; cross-org FORBIDDEN", async () => {
    const s = await caller.bandit.stats({ orgId });
    expect(s.arms.length).toBeGreaterThan(0);
    const arm = s.arms.find(a => a.armId === "delta_bps_+500");
    expect(arm).toBeTruthy();
    expect(arm!.pulls).toBeGreaterThanOrEqual(96);
    expect(s.caps.explorationRate).toBeCloseTo(0.1);
    expect(s.caps.maxExplorePerDay).toBe(5);
    await expect(outsider.bandit.stats({ orgId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ── S2: next-action ranking ──────────────────────────────────────────────
  it("nextActions.list: learned re-order within severity above the impressions floor; dismiss records rejected", async () => {
    const db = (await getDb())!;
    // Seed act-rate facts: idle_offer:provider well-acted, advance_step:provider mostly ignored.
    for (let i = 0; i < 12; i++) {
      await db.insert(suggestionEvents).values({
        id: crypto.randomUUID(), orgId, userId: U1, suggestionId: `p22-na-idle-${RUN}-${i}`,
        surface: "next_action", action: "presented", modelName: "next-actions-v1",
        metadata: { kind: "idle_offer", persona: "provider" },
      });
      if (i < 9) {
        await db.insert(suggestionEvents).values({
          id: crypto.randomUUID(), orgId, userId: U1, suggestionId: `p22-na-idle-${RUN}-${i}`,
          surface: "next_action", action: "accepted", modelName: "next-actions-v1",
          metadata: { kind: "idle_offer", persona: "provider" },
        });
      }
      await db.insert(suggestionEvents).values({
        id: crypto.randomUUID(), orgId, userId: U1, suggestionId: `p22-na-adv-${RUN}-${i}`,
        surface: "next_action", action: "presented", modelName: "next-actions-v1",
        metadata: { kind: "advance_step", persona: "provider" },
      });
      await db.insert(suggestionEvents).values({
        id: crypto.randomUUID(), orgId, userId: U1, suggestionId: `p22-na-adv-${RUN}-${i}`,
        surface: "next_action", action: "rejected", modelName: "next-actions-v1",
        metadata: { kind: "advance_step", persona: "provider" },
      });
    }
    await refreshRankingStats(db, new Date());

    // Static order would put advance_step first (updatedAt tie-break: open
    // dispute updated more recently than the idle one).
    const list = await caller.nextActions.list({ orgId, persona: "provider" });
    expect(list.ranking.enabled).toBe(true);
    expect(list.ranking.label).toBe("learning_active");
    expect(list.ranking.learnedItems).toBeGreaterThanOrEqual(2);
    const idleIdx = list.cards.findIndex(c => c.kind === "idle_offer");
    const advIdx = list.cards.findIndex(c => c.kind === "advance_step");
    expect(idleIdx).toBeGreaterThanOrEqual(0);
    expect(advIdx).toBeGreaterThanOrEqual(0);
    // Both are severity "info"; learned order puts the well-acted card first.
    expect(list.cards[idleIdx].severity).toBe("info");
    expect(list.cards[advIdx].severity).toBe("info");
    expect(idleIdx).toBeLessThan(advIdx);

    // Fresh org: static ordering (byte-identical ordering contract).
    const fresh = await outsider.nextActions.list({ orgId: otherOrgId, persona: "provider" });
    expect(fresh.ranking.label).toBe("static_ordering");

    // Dismiss records a `rejected` suggestion event (negative signal) whose
    // metadata.kind is the CARD kind, not the raw actionKey prefix — F1
    // regression guard (an "idle-offer:..." key must record "idle_offer").
    const key = list.cards[idleIdx].actionKey;
    expect(key.startsWith("idle-offer:")).toBe(true);
    await caller.nextActions.dismiss({ actionKey: key });
    const rej = await db.select().from(suggestionEvents).where(and(
      eq(suggestionEvents.suggestionId, key),
      eq(suggestionEvents.surface, "next_action"),
      eq(suggestionEvents.action, "rejected"),
    ));
    expect(rej.length).toBeGreaterThanOrEqual(1);
    expect(rej[0].orgId).toBe(orgId);
    expect((rej[0].metadata as { kind?: string } | null)?.kind).toBe("idle_offer");
  });

  // ── S3: quarantine suggestion re-rank ────────────────────────────────────
  it("prefill.quarantineRows: eligible (field, source) blended ≤±50% with learnedConfidence flag", async () => {
    const db = (await getDb())!;
    for (let i = 0; i < 5; i++) {
      await db.insert(practiceClaims).values({
        id: `p22-pc-${RUN}-${i}`, orgId, source: "csv",
        contentSha256: crypto.createHash("sha256").update(`p22-pc-${RUN}-${i}`).digest("hex"),
        planType: "SELF_FUNDED",
      });
    }
    // Learned stats: planType:org_prior mostly REJECTED → score 1/22 ≈ 0.045.
    await db.insert(rankingStats).values({
      id: crypto.randomUUID(), orgId, ranker: "quarantine_suggestion",
      itemKey: "planType:org_prior", presented: 20, acts: 0, negatives: 20,
    });
    const sessionId = crypto.randomUUID();
    await db.insert(bulkUploadSessions).values({
      id: sessionId, orgId, createdByUserId: U1, fileName: "p22.ndjson", fileType: "ndjson",
      declaredSizeBytes: 10, chunkSizeBytes: 10, totalChunks: 1,
      assembledSha256: crypto.createHash("sha256").update("p22").digest("hex"), status: "completed",
    });
    const qid = crypto.randomUUID();
    await db.insert(claimQuarantine).values({
      id: qid, sessionId, orgId, rowNumber: 1,
      rawPayload: claimLine(1), errorReason: "validation failed",
      missingFields: ["planType"],
    });
    const res = await caller.prefill.quarantineRows({ orgId, quarantineIds: [qid] });
    const sugg = res.rows[0].suggestions.find(s => s.field === "planType");
    expect(sugg).toBeTruthy();
    expect(sugg!.source).toBe("org_prior");
    expect((sugg as { learnedConfidence?: boolean }).learnedConfidence).toBe(true);
    // Base confidence 0.95 (5/5 prior); blend with 0.045 → 0.5×0.95+0.5×0.045 ≈ 0.498.
    expect(sugg!.confidence).toBeLessThan(0.6);
    expect(sugg!.confidence).toBeGreaterThan(0.4);
  });

  // ── S4: outcome calibration ──────────────────────────────────────────────
  it("outcomeModel.calibration: org-scoped; thin → withheld; seeded pairs → metrics", async () => {
    const db = (await getDb())!;
    // Thin org (otherOrg) → metrics withheld.
    const thin = await outsider.outcomeModel.calibration({ orgId: otherOrgId, days: 90 });
    expect(thin.brierScore).toBeNull();
    expect(thin.honestyNote).toContain("INSUFFICIENT DATA");
    // Cross-org FORBIDDEN.
    await expect(outsider.outcomeModel.calibration({ orgId })).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Seed 30 joined prediction pairs on disputes created by U1 (org member):
    // 15 wins / 15 losses, all predicted 0.6 → Brier (0.16+0.36)/2 = 0.26.
    for (let i = 0; i < 30; i++) {
      const did = `p22-cal-${RUN}-${i}`;
      await db.insert(disputes).values({
        id: did, referenceNumber: `P22C-${RUN}-${i}`.slice(0, 60),
        initiatingPartyId: U1, initiatingPartyType: "provider",
        initiatingPartyName: "P22 Provider", respondingPartyName: "P22 Payer",
        serviceType: "emergency_medicine", serviceDate: new Date("2026-06-01"),
        patientState: "TX", facilityState: "TX",
        cptCodes: ["99285"],
        billedAmount: "2000",
        qpaAmount: "1000",
        determinationAmount: "1150",
        determinationWinner: i < 15 ? "initiating_party" : "responding_party",
        idrEntityId: IDRE, status: "closed", createdBy: U1,
      }).onConflictDoNothing();
      await db.execute(sql`
        INSERT INTO outcome_model_predictions (id, dispute_id, model_version_id, predicted_win_prob,
          predicted_award_p25_usd, predicted_award_p75_usd, segment_tier, segment_key, source,
          actual_winner, actual_amount_usd, actual_joined_at)
        VALUES (${`p22-omp-${RUN}-${i}`}, ${did}, 'mv-test', 0.6, 1000, 1300, 'platform', 'platform', 'trained',
          ${i < 15 ? "initiating_party" : "responding_party"}, 1150, now())
      `);
    }
    const cal = await caller.outcomeModel.calibration({ orgId, days: 90 });
    expect(cal.n).toBe(30);
    expect(cal.brierScore).toBe(0.26);
    expect(cal.meanAbsProbError).toBe(0.5);
    expect(cal.awardCoverageP25P75).toBe(1); // 1150 within [1000, 1300]
    expect(cal.byTier.length).toBeGreaterThanOrEqual(1);
  });
});
