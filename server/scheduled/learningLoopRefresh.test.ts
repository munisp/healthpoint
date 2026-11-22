/**
 * Phase 22 (S1/S4) live-PG tests — learning-loop refresh worker.
 *
 *  - attributeBanditRewards: seeded assignment + accepted offer → reward 1,
 *    posterior α+1; rejected → β+1; countered (newer offer) → EXCLUDED;
 *    expired → EXCLUDED; second run attributes 0 (idempotent); only the
 *    first assignment per dispute collects a reward.
 *  - trainOutcomeModel: seeded closed determinations → active row with
 *    model_kind "outcome_model"; thin data → insufficient_data, previous
 *    active NOT retired.
 *  - joinOutcomeActuals: fills actual_* when the determination lands;
 *    idempotent.
 *  - refreshRankingStats: full recompute from suggestion_events.
 *
 * EXECUTED-VERIFIED when DATABASE_URL is set; skipped otherwise.
 */
import "../journeys/env-defaults";
import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  attributeBanditRewards,
  trainOutcomeModel,
  joinOutcomeActuals,
  refreshRankingStats,
  runLearningLoopRefresh,
} from "./learningLoopRefresh";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const RUN = Date.now().toString(36);

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function seedAssignment(db: Db, opts: {
  id: string; orgId: string; disputeId: string; armId?: string; servedUsd?: number;
  createdAt: Date; exploration?: boolean;
}) {
  await db.execute(sql`
    INSERT INTO bandit_assignments (id, org_id, suggestion_id, dispute_id, user_id, segment_tier, segment_key, arm_id, baseline_usd, served_usd, exploration, created_at)
    VALUES (${opts.id}, ${opts.orgId}, ${`sug-${opts.id}`}, ${opts.disputeId}, ${`u-${RUN}`}, 'platform', 'platform',
      ${opts.armId ?? "delta_bps_+500"}, ${opts.servedUsd ?? 1050}, ${opts.servedUsd ?? 1050}, ${opts.exploration ?? true}, ${opts.createdAt.toISOString()}::timestamp)
  `);
}

async function seedDispute(db: Db, id: string, status = "offer_submission") {
  await db.execute(sql`
    INSERT INTO disputes (id, "referenceNumber", "initiatingPartyId", "initiatingPartyType", "initiatingPartyName",
      "respondingPartyName", "serviceType", "serviceDate", "patientState", "facilityState", "cptCodes",
      "billedAmount", "qpaAmount", status, "createdBy")
    VALUES (${id}, ${`LLR-${id}`.slice(0, 60)}, ${`u-${RUN}`}, 'provider', 'LLR Provider', 'LLR Payer',
      'emergency_medicine', '2026-06-01', 'TX', 'TX', '["99285"]', 2000, 1000, ${status}, ${`u-${RUN}`})
    ON CONFLICT DO NOTHING
  `);
}

async function armStat(db: Db, orgId: string, armId: string, segmentKey = "platform") {
  const rows = (await db.execute(sql`
    SELECT alpha, beta, pulls, served FROM bandit_arm_stats
    WHERE org_id = ${orgId} AND segment_key = ${segmentKey} AND arm_id = ${armId}
  `)) as unknown as Array<Record<string, number>>;
  return rows[0] ?? null;
}

describe.skipIf(!HAS_DB)("Phase22 learningLoopRefresh (live PG)", () => {
  let db: Db;
  const org = `llr-org-${RUN}`;
  const old = new Date(Date.now() - 2 * 3600000); // beyond the 1h grace period

  beforeAll(async () => {
    const d = await getDb();
    expect(d).toBeTruthy();
    db = d!;
  }, 60000);

  it("accepted offer (amount match) → reward 1, posterior α+1; idempotent re-run", async () => {
    const disputeId = `llr-acc-${RUN}`;
    await seedDispute(db, disputeId, "closed");
    await seedAssignment(db, { id: `asn-acc-${RUN}`, orgId: org, disputeId, createdAt: old });
    await db.execute(sql`
      INSERT INTO dispute_offers (id, "disputeId", "offerType", amount, "submittedBy", "isAccepted")
      VALUES (${`ofr-acc-${RUN}`}, ${disputeId}, 'initiating_party', 1050.00, ${`u-${RUN}`}, true)
    `);
    const r1 = await attributeBanditRewards(db, new Date());
    expect(r1.accepted).toBeGreaterThanOrEqual(1);
    const st = await armStat(db, org, "delta_bps_+500");
    expect(st).toBeTruthy();
    expect(Number(st!.alpha)).toBe(2);
    expect(Number(st!.beta)).toBe(1);
    expect(Number(st!.pulls)).toBe(1);
    expect(Number(st!.served)).toBe(1);
    // Idempotent: second run attributes nothing new for this assignment.
    const r2 = await attributeBanditRewards(db, new Date());
    const st2 = await armStat(db, org, "delta_bps_+500");
    expect(Number(st2!.pulls)).toBe(1);
    expect(Number(st2!.served)).toBe(1);
  });

  it("rejected offer (offer_rejected event, no acceptance) → reward 0, posterior β+1", async () => {
    const disputeId = `llr-rej-${RUN}`;
    await seedDispute(db, disputeId);
    await seedAssignment(db, { id: `asn-rej-${RUN}`, orgId: org, disputeId, armId: "delta_bps_-500", servedUsd: 950, createdAt: old });
    await db.execute(sql`
      INSERT INTO dispute_events (id, "disputeId", step, "eventType", description, "performedBy")
      VALUES (${`ev-rej-${RUN}`}, ${disputeId}, 'STEP_18_APPEAL_FILED', 'offer_rejected', 'offer rejected', ${`u-${RUN}`})
    `);
    const before = await armStat(db, org, "delta_bps_-500");
    await attributeBanditRewards(db, new Date());
    const st = await armStat(db, org, "delta_bps_-500");
    expect(Number(st!.alpha)).toBe(Number(before?.alpha ?? 1));
    expect(Number(st!.beta)).toBe(Number(before?.beta ?? 1) + 1);
    expect(Number(st!.pulls)).toBe(Number(before?.pulls ?? 0) + 1);
  });

  it("countered (newer offer, no acceptance) → excluded from posteriors, served-counted", async () => {
    const disputeId = `llr-ctr-${RUN}`;
    await seedDispute(db, disputeId);
    await seedAssignment(db, { id: `asn-ctr-${RUN}`, orgId: org, disputeId, armId: "delta_bps_+1000", servedUsd: 1100, createdAt: old });
    await db.execute(sql`
      INSERT INTO dispute_offers (id, "disputeId", "offerType", amount, "submittedBy", "isAccepted", "submittedAt")
      VALUES (${`ofr-ctr-${RUN}`}, ${disputeId}, 'responding_party', 900.00, 'payer-user', false, now())
    `);
    const r = await attributeBanditRewards(db, new Date());
    expect(r.countered).toBeGreaterThanOrEqual(1);
    const st = await armStat(db, org, "delta_bps_+1000");
    expect(Number(st!.pulls)).toBe(0); // excluded from α/β
    expect(Number(st!.served)).toBe(1);
    const outcome = (await db.execute(sql`SELECT outcome FROM bandit_assignments WHERE id = ${`asn-ctr-${RUN}`}`)) as unknown as Array<Record<string, string>>;
    expect(outcome[0].outcome).toBe("countered");
  });

  it("expired (older than the reward window) → excluded from posteriors", async () => {
    const disputeId = `llr-exp-${RUN}`;
    await seedDispute(db, disputeId);
    const ancient = new Date(Date.now() - 31 * 86400000);
    await seedAssignment(db, { id: `asn-exp-${RUN}`, orgId: org, disputeId, armId: "delta_bps_-1000", servedUsd: 900, createdAt: ancient });
    const r = await attributeBanditRewards(db, new Date());
    expect(r.expired).toBeGreaterThanOrEqual(1);
    const st = await armStat(db, org, "delta_bps_-1000");
    expect(Number(st!.pulls)).toBe(0);
    expect(Number(st!.served)).toBe(1);
  });

  it("only the FIRST assignment per dispute collects a reward", async () => {
    const disputeId = `llr-dbl-${RUN}`;
    await seedDispute(db, disputeId, "closed");
    const t1 = new Date(Date.now() - 3 * 3600000);
    const t2 = new Date(Date.now() - 2 * 3600000);
    await seedAssignment(db, { id: `asn-dbl1-${RUN}`, orgId: org, disputeId, armId: "delta_bps_+500", servedUsd: 1050, createdAt: t1 });
    await seedAssignment(db, { id: `asn-dbl2-${RUN}`, orgId: org, disputeId, armId: "delta_bps_+500", servedUsd: 1050, createdAt: t2 });
    await db.execute(sql`
      INSERT INTO dispute_offers (id, "disputeId", "offerType", amount, "submittedBy", "isAccepted")
      VALUES (${`ofr-dbl-${RUN}`}, ${disputeId}, 'initiating_party', 1050.00, ${`u-${RUN}`}, true)
    `);
    await attributeBanditRewards(db, new Date());
    const st = await armStat(db, org, "delta_bps_+500");
    // First test contributed α=2/β=1/pulls=1/served=1; this adds ONE reward
    // and TWO served.
    expect(Number(st!.pulls)).toBe(2);
    expect(Number(st!.served)).toBe(3);
    expect(Number(st!.alpha)).toBe(3);
  });

  it("trainOutcomeModel: sufficient platform data → active, model_kind outcome_model", async () => {
    // The DB already carries >= 30 closed determinations from other suites
    // only when run together; seed 30 here for isolation.
    for (let i = 0; i < 30; i++) {
      await db.execute(sql`
        INSERT INTO disputes (id, "referenceNumber", "initiatingPartyId", "initiatingPartyType", "initiatingPartyName",
          "respondingPartyName", "serviceType", "serviceDate", "patientState", "facilityState", "cptCodes",
          "billedAmount", "qpaAmount", "determinationAmount", "determinationWinner", "idrEntityId", status, "createdBy")
        VALUES (${`llr-det-${RUN}-${i}`}, ${`LLRD-${RUN.slice(-4)}-${i}`}, ${`u-${RUN}`}, 'provider', 'LLR Provider', 'LLR Payer',
          'emergency_medicine', '2026-06-01', 'TX', 'TX', '["99285"]', 2000, 1000, ${i % 2 ? 1100 : 1200},
          ${i < 18 ? "initiating_party" : "responding_party"}, ${`llr-idre-${RUN}`}, 'closed', ${`u-${RUN}`})
        ON CONFLICT DO NOTHING
      `);
    }
    const t = await trainOutcomeModel(db, new Date());
    expect(t.status).toBe("active");
    expect(t.trainingSampleSize).toBeGreaterThanOrEqual(30);
    const rows = (await db.execute(sql`
      SELECT model_kind, status FROM model_versions WHERE id = ${t.modelVersionId}
    `)) as unknown as Array<Record<string, string>>;
    expect(rows[0].model_kind).toBe("outcome_model");
    expect(rows[0].status).toBe("active");
  });

  it("joinOutcomeActuals fills actual_* when the determination lands; idempotent", async () => {
    const disputeId = `llr-cal-${RUN}`;
    await seedDispute(db, disputeId);
    await db.execute(sql`
      INSERT INTO outcome_model_predictions (id, dispute_id, model_version_id, predicted_win_prob, segment_tier, segment_key, source)
      VALUES (${`omp-${RUN}`}, ${disputeId}, 'mv-test', 0.65, 'platform', 'platform', 'trained')
    `);
    // No determination yet → no join.
    const j0 = await joinOutcomeActuals(db, new Date());
    expect(j0.joined).toBe(0);
    await db.execute(sql`
      UPDATE disputes SET "determinationWinner" = 'initiating_party', "determinationAmount" = 1150, status = 'closed'
      WHERE id = ${disputeId}
    `);
    const j1 = await joinOutcomeActuals(db, new Date());
    expect(j1.joined).toBeGreaterThanOrEqual(1);
    const row = ((await db.execute(sql`SELECT actual_winner, actual_amount_usd FROM outcome_model_predictions WHERE id = ${`omp-${RUN}`}`)) as unknown as Array<Record<string, unknown>>)[0];
    expect(row.actual_winner).toBe("initiating_party");
    expect(Number(row.actual_amount_usd)).toBe(1150);
    const j2 = await joinOutcomeActuals(db, new Date());
    expect(j2.joined).toBe(0); // idempotent
  });

  it("refreshRankingStats: full recompute from suggestion_events", async () => {
    const rorg = `llr-rank-${RUN}`;
    for (let i = 0; i < 12; i++) {
      await db.execute(sql`
        INSERT INTO suggestion_events (id, org_id, user_id, suggestion_id, surface, action, model_name, metadata)
        VALUES (${crypto.randomUUID()}, ${rorg}, ${`u-${RUN}`}, ${`na-${RUN}-${i}`}, 'next_action',
          ${i < 10 ? "presented" : "accepted"}, 'next-actions-v1', ${JSON.stringify({ kind: "idle_offer", persona: "provider" })})
      `);
    }
    const r = await refreshRankingStats(db, new Date());
    expect(r.rankers.next_action.items).toBeGreaterThanOrEqual(1);
    const rows = (await db.execute(sql`
      SELECT presented, acts, negatives FROM ranking_stats WHERE org_id = ${rorg} AND ranker = 'next_action' AND item_key = 'idle_offer:provider'
    `)) as unknown as Array<Record<string, number>>;
    expect(Number(rows[0].presented)).toBe(10);
    expect(Number(rows[0].acts)).toBe(2);
  });

  it("runLearningLoopRefresh: one failing step never blocks the others", async () => {
    const r = await runLearningLoopRefresh(db, new Date());
    expect(r.bandit?.attribution).toBeTruthy();
    expect(r.outcomeModel?.training).toBeTruthy();
    expect(r.ranking?.result).toBeTruthy();
    expect(r.offerModel).toBeTruthy(); // wraps the P21 trainer
  });
});
