/**
 * J33: closed learning loop (Phase 22).
 *
 *  seed org + 30 closed determinations + 10 served bandit assignments with
 *  accepted offers → POST /api/scheduled/learning-loop-refresh (handler path,
 *  scheduledAuth-mounted in _core/index.ts) trains outcome-model-v2 and
 *  attributes bandit rewards (α 11/β 1) → recommendV2 serves the learned
 *  +500bps arm (bandit_active), the offer is accepted through the real
 *  submit/accept path, a second refresh shifts the posterior (α 12) and a
 *  third is idempotent → predictions.generate returns the trained source and
 *  the calibration join fills actual_* once the determination lands →
 *  nextActions.list (limit: 50) surfaces both info-severity cards → seeded
 *  dismissals/acts reorder the info group (learning_active) while a fresh
 *  org stays on static_ordering.
 *
 * Template: J32's pattern (real tRPC callers + ctx.sql for fixtures).
 */
import crypto from "node:crypto";
import type { Request, Response } from "express";
import type { Journey } from "../framework";

const SERVICE = "emergency_medicine";
const STATE = "TX";

interface J33State {
  orgId: string;
  idre: string;
  segKey: string;
  banditDisputeId: string;
  predDisputeId: string;
  idleDisputeId: string;
}

export const j33: Journey = {
  id: "J33",
  title: "Closed learning loop: bandit lifecycle → outcome model v2 → calibration join → ranked next actions",
  actor: "provider",
  description:
    "Seeds an org with a covered leaf segment, ten served bandit assignments whose offers were accepted, and open/idle disputes, then drives the nightly learning-loop refresh through its scheduled handler, proves the bandit serve→accept→attribute→posterior-shift lifecycle (with idempotent re-attribution), the trained outcome prediction + calibration join, and the learned next-action reorder within the info severity group (fresh org stays static).",
  steps: [
    {
      name: "seed-org-disputes-and-offer-fixtures",
      async run(ctx) {
        const org = await ctx.provider.orgs.create({ name: `J33 Practice ${ctx.ns("j33")}`, type: "provider" });
        const { canonicalSegmentKey } = await import("../../idr/segment-keys");
        const idre = ctx.ns("j33-idre");
        const st: J33State = {
          orgId: org.orgId,
          idre,
          segKey: canonicalSegmentKey("idr_entity_x_service_x_patientstate", {
            idrEntityId: idre, serviceType: SERVICE, patientState: STATE,
          }),
          banditDisputeId: ctx.ns("j33-bandit"),
          predDisputeId: ctx.ns("j33-pred"),
          idleDisputeId: ctx.ns("j33-idle"),
        };
        (ctx as unknown as { _st: J33State })._st = st;

        // 30 closed determinations in a unique leaf segment (18/12 wins).
        for (let i = 0; i < 30; i++) {
          await ctx.sql.unsafe(
            `INSERT INTO disputes (id, "referenceNumber", "initiatingPartyId", "initiatingPartyType", "initiatingPartyName",
               "respondingPartyName", "serviceType", "serviceDate", "patientState", "facilityState", "cptCodes",
               "billedAmount", "qpaAmount", "determinationAmount", "determinationWinner", "idrEntityId", status, "createdBy")
             VALUES ($1, $2, 'jrn-user-provider', 'provider', 'J33 Provider', 'J33 Payer', '${SERVICE}',
               '2026-06-01', '${STATE}', '${STATE}', '["99285"]', 2000, 1000, $3, $4, $5, 'closed', 'jrn-user-provider')
             ON CONFLICT DO NOTHING`,
            [ctx.ns(`j33-det-${i}`), `J33D-${ctx.runId.slice(-6)}-${i}`, i % 2 === 0 ? 1200 : 1000, i < 18 ? "initiating_party" : "responding_party", idre],
          );
        }
        // Open dispute for the bandit serve→accept lifecycle.
        await ctx.sql.unsafe(
          `INSERT INTO disputes (id, "referenceNumber", "initiatingPartyId", "initiatingPartyType", "initiatingPartyName",
             "respondingPartyName", "serviceType", "serviceDate", "patientState", "facilityState", "cptCodes",
             "billedAmount", "qpaAmount", "respondingPartyOffer", "idrEntityId", status, "createdBy")
           VALUES ($1, $2, 'jrn-user-provider', 'provider', 'J33 Provider', 'J33 Payer', '${SERVICE}',
             '2026-08-01', '${STATE}', '${STATE}', '["99285"]', 2000, 1000, 600, $3, 'offer_submission', 'jrn-user-provider')
           ON CONFLICT DO NOTHING`,
          [st.banditDisputeId, `J33B-${ctx.runId.slice(-6)}`, idre],
        );
        // Open dispute for the outcome-model prediction + calibration join.
        await ctx.sql.unsafe(
          `INSERT INTO disputes (id, "referenceNumber", "initiatingPartyId", "initiatingPartyType", "initiatingPartyName",
             "respondingPartyName", "serviceType", "serviceDate", "patientState", "facilityState", "cptCodes",
             "billedAmount", "qpaAmount", "respondingPartyOffer", "idrEntityId", status, "createdBy")
           VALUES ($1, $2, 'jrn-user-provider', 'provider', 'J33 Provider', 'J33 Payer', '${SERVICE}',
             '2026-08-01', '${STATE}', '${STATE}', '["99285"]', 2000, 1000, 600, $3, 'offer_submission', 'jrn-user-provider')
           ON CONFLICT DO NOTHING`,
          [st.predDisputeId, `J33P-${ctx.runId.slice(-6)}`, idre],
        );
        // Idle-offer dispute: offer_submission, no initiating offer, idle
        // > 2 business days but ≤ 5 → severity "info". 6 calendar days back
        // always yields 4-5 business days regardless of the run weekday.
        await ctx.sql.unsafe(
          `INSERT INTO disputes (id, "referenceNumber", "initiatingPartyId", "initiatingPartyType", "initiatingPartyName",
             "respondingPartyName", "serviceType", "serviceDate", "patientState", "facilityState", "cptCodes",
             "billedAmount", "qpaAmount", "idrEntityId", status, "createdBy", "createdAt", "updatedAt")
           VALUES ($1, $2, 'jrn-user-provider', 'provider', 'J33 Provider', 'J33 Payer', '${SERVICE}',
             '2026-08-01', '${STATE}', '${STATE}', '["99285"]', 2000, 1000, $3, 'offer_submission', 'jrn-user-provider',
             now() - interval '6 days', now() - interval '6 days')
           ON CONFLICT DO NOTHING`,
          [st.idleDisputeId, `J33I-${ctx.runId.slice(-6)}`, idre],
        );
        // Ten served +500bps assignments on their own closed disputes, each
        // with an amount-matched accepted offer (created 2h ago — beyond the
        // 1h attribution grace period). Nightly attribution turns these into
        // a Beta(11,1) posterior on delta_bps_+500. created_at is written as
        // a UTC ISO wall clock (learningLoopRefresh test convention) so the
        // attribution window math is timezone-safe.
        const twoHoursAgo = new Date(Date.now() - 2 * 3600000).toISOString();
        for (let i = 0; i < 10; i++) {
          const did = ctx.ns(`j33-asn-d${i}`);
          await ctx.sql.unsafe(
            `INSERT INTO disputes (id, "referenceNumber", "initiatingPartyId", "initiatingPartyType", "initiatingPartyName",
               "respondingPartyName", "serviceType", "serviceDate", "patientState", "facilityState", "cptCodes",
               "billedAmount", "qpaAmount", "idrEntityId", status, "createdBy")
             VALUES ($1, $2, 'jrn-user-provider', 'provider', 'J33 Provider', 'J33 Payer', '${SERVICE}',
               '2026-06-01', '${STATE}', '${STATE}', '["99285"]', 2000, 1000, $3, 'closed', 'jrn-user-provider')
             ON CONFLICT DO NOTHING`,
            [did, `J33A-${ctx.runId.slice(-6)}-${i}`, idre],
          );
          await ctx.sql.unsafe(
            `INSERT INTO bandit_assignments (id, org_id, suggestion_id, dispute_id, user_id, segment_tier, segment_key, arm_id, baseline_usd, served_usd, exploration, created_at)
             VALUES ($1, $2, $3, $4, 'jrn-user-provider', 'idr_entity_x_service_x_patientstate', $5, 'delta_bps_+500', 1000, 1050, false, $6::timestamp)`,
            [ctx.ns(`j33-asn-${i}`), st.orgId, ctx.ns(`j33-sug-${i}`), did, st.segKey, twoHoursAgo],
          );
          await ctx.sql.unsafe(
            `INSERT INTO dispute_offers (id, "disputeId", "offerType", amount, "submittedBy", "isAccepted")
             VALUES ($1, $2, 'responding_party', 1050.00, 'jrn-user-provider', true)`,
            [ctx.ns(`j33-ofr-${i}`), did],
          );
        }
        // Learned history on the OTHER arms (repeatedly rejected in the past)
        // so the learned +500 arm wins Thompson sampling deterministically.
        for (const arm of ["delta_bps_-1000", "delta_bps_-500", "delta_bps_0", "delta_bps_+1000"]) {
          await ctx.sql.unsafe(
            `INSERT INTO bandit_arm_stats (id, org_id, segment_tier, segment_key, arm_id, alpha, beta, pulls, served)
             VALUES ($1, $2, 'idr_entity_x_service_x_patientstate', $3, $4, 1, 30, 29, 29)
             ON CONFLICT (org_id, segment_tier, segment_key, arm_id) DO NOTHING`,
            [crypto.randomUUID(), st.orgId, st.segKey, arm],
          );
        }
        return { evidence: { orgId: st.orgId, segKey: st.segKey } };
      },
    },
    {
      name: "scheduled-refresh-trains-and-attributes",
      async run(ctx) {
        const st = (ctx as unknown as { _st: J33State })._st;
        // The production mount is POST /api/scheduled/learning-loop-refresh
        // behind scheduledAuth (_core/index.ts); the journey invokes the same
        // handler directly with a mock req/res.
        const { learningLoopRefreshHandler } = await import("../../scheduled/learningLoopRefresh");
        const res = {
          statusCode: 200,
          body: undefined as unknown,
          status(code: number) { this.statusCode = code; return this; },
          json(body: unknown) { this.body = body; return this; },
        };
        await learningLoopRefreshHandler({} as unknown as Request, res as unknown as Response);
        ctx.assertEqual(res.statusCode, 200, "refresh handler returned 200");
        const body = res.body as {
          ok: boolean;
          outcomeModel?: { training?: { status: string; trainingSampleSize: number } };
          bandit?: { attribution?: { attributed: number; accepted: number } };
        };
        ctx.assert(body.ok === true, "refresh handler ok");
        ctx.assertEqual(body.outcomeModel?.training?.status, "active", "outcome-model-v2 trained active");
        ctx.assert((body.outcomeModel?.training?.trainingSampleSize ?? 0) >= 30, "training sample includes seeded segment");
        ctx.assert((body.bandit?.attribution?.accepted ?? 0) >= 10, "ten seeded acceptances attributed");
        const rows = await ctx.sql.unsafe(
          `SELECT alpha, beta, pulls, served FROM bandit_arm_stats
           WHERE org_id = $1 AND segment_key = $2 AND arm_id = 'delta_bps_+500'`,
          [st.orgId, st.segKey],
        );
        ctx.assertEqual(rows.length, 1, "bandit_arm_stats row exists for the learned arm");
        ctx.assertEqual(Number(rows[0].alpha), 11, "posterior α = 1 prior + 10 accepted");
        ctx.assertEqual(Number(rows[0].beta), 1, "posterior β unchanged (no rejections)");
        ctx.assertEqual(Number(rows[0].pulls), 10, "ten rewarded pulls");
        return { evidence: { alpha: Number(rows[0].alpha), beta: Number(rows[0].beta), attributed: body.bandit?.attribution?.attributed } };
      },
    },
    {
      name: "bandit-serve-accept-posterior-shift-idempotent",
      async run(ctx) {
        const st = (ctx as unknown as { _st: J33State })._st;
        // Serve: 126 pulls ≥ min_pulls, +500 arm posterior dominates → the
        // learned arm is served with the baseline disclosed.
        const r = await ctx.provider.offerStrategy.recommendV2({ orgId: st.orgId, disputeId: st.banditDisputeId });
        ctx.assert(r.bandit, "bandit block present");
        ctx.assertEqual(r.bandit!.gate, "active", "bandit past all gates");
        ctx.assertEqual(r.bandit!.armId, "delta_bps_+500", "learned arm served");
        ctx.assertEqual(r.bandit!.exploration, true, "exploration flagged");
        ctx.assertEqual(r.label, "bandit_active", "honesty label degraded one step");
        ctx.assert(r.bandit!.baselineUsd !== null, "baseline always disclosed");
        const served = r.recommendedOfferUsdStatisticalEstimate;
        ctx.assert(served !== null, "served estimate present");
        ctx.assertEqual(served, Math.round(r.bandit!.baselineUsd * 1.05 * 100) / 100, "served = baseline × 1.05");

        // Accept the served amount through the real submit/accept path.
        const sub = await ctx.provider.disputes.submitOffer({
          disputeId: st.banditDisputeId,
          offerType: "initiating_party",
          amount: served!.toFixed(2),
        });
        await ctx.provider.disputes.acceptOffer({ disputeId: st.banditDisputeId, offerId: sub.offerId });

        // Backdate the fresh assignment past the 1h attribution grace period
        // (the journey compresses the nightly cycle; fixtures-only edit). The
        // router wrote created_at via defaultNow(); rewrite it as a UTC ISO
        // wall clock (learningLoopRefresh convention) for TZ-safe window math.
        await ctx.sql.unsafe(
          `UPDATE bandit_assignments SET created_at = $1::timestamp WHERE suggestion_id = $2`,
          [new Date(Date.now() - 2 * 3600000).toISOString(), r.suggestionId],
        );
        const { getDb } = await import("../../db");
        const { runLearningLoopRefresh } = await import("../../scheduled/learningLoopRefresh");
        const db = await getDb();
        ctx.assert(db, "db available");
        await runLearningLoopRefresh(db!, new Date());
        const rows = await ctx.sql.unsafe(
          `SELECT alpha, beta, pulls FROM bandit_arm_stats
           WHERE org_id = $1 AND segment_key = $2 AND arm_id = 'delta_bps_+500'`,
          [st.orgId, st.segKey],
        );
        ctx.assertEqual(Number(rows[0].alpha), 12, "posterior shifted α 11 → 12 after the accepted serve");
        ctx.assertEqual(Number(rows[0].beta), 1, "β unchanged");
        // Idempotent re-attribution: a third refresh changes nothing.
        await runLearningLoopRefresh(db!, new Date());
        const again = await ctx.sql.unsafe(
          `SELECT alpha, beta, pulls FROM bandit_arm_stats
           WHERE org_id = $1 AND segment_key = $2 AND arm_id = 'delta_bps_+500'`,
          [st.orgId, st.segKey],
        );
        ctx.assertEqual(Number(again[0].alpha), 12, "re-attribution idempotent (α stable)");
        ctx.assertEqual(Number(again[0].pulls), Number(rows[0].pulls), "pulls stable on re-run");
        return { evidence: { served, alpha: Number(again[0].alpha) } };
      },
    },
    {
      name: "outcome-model-trained-prediction-and-calibration-join",
      async run(ctx) {
        const st = (ctx as unknown as { _st: J33State })._st;
        const gen = await ctx.provider.predictions.generate({
          disputeId: st.predDisputeId,
          billedAmount: 2000,
          qpaAmount: 1000,
          serviceType: SERVICE,
          patientState: STATE,
          currentStep: "STEP_10_OFFER_SUBMISSION",
        });
        ctx.assert(String(gen.modelVersion).startsWith("outcome-model-v2:v"), "trained source identified in modelVersion");
        // Recompute the expected shrunk win probability from the active
        // model's parameters (deterministic, no hard-coded constant).
        const mv = await ctx.sql.unsafe(
          `SELECT parameters FROM model_versions WHERE model_name = 'outcome-model-v2' AND status = 'active'
           ORDER BY version DESC LIMIT 1`,
        );
        ctx.assertEqual(mv.length, 1, "active outcome-model-v2 row");
        const { outcomeChainFromParams, predictOutcomeV2 } = await import("../../idr/outcome-model-v2");
        const chain = outcomeChainFromParams(mv[0].parameters as never, {
          idrEntityId: st.idre, serviceType: SERVICE, patientState: STATE,
        });
        const expected = predictOutcomeV2(chain);
        ctx.assert(expected !== null, "covered segment yields a prediction");
        ctx.assertEqual(gen.winProbability, Math.round(expected!.winProb * 100), "winProbability matches the trained segment rate");
        // Append-only calibration log row.
        const log = await ctx.sql.unsafe(
          `SELECT segment_tier, source, actual_winner FROM outcome_model_predictions WHERE dispute_id = $1`,
          [st.predDisputeId],
        );
        ctx.assertEqual(log.length, 1, "calibration log row appended");
        ctx.assertEqual(log[0].source, "trained", "log row sourced from the trained model");
        ctx.assert(log[0].actual_winner === null, "actuals not yet joined");
        // Determination lands → the nightly join fills actual_* exactly once.
        await ctx.sql.unsafe(
          `UPDATE disputes SET "determinationWinner" = 'initiating_party', "determinationAmount" = 1250, status = 'closed'
           WHERE id = $1`,
          [st.predDisputeId],
        );
        const { getDb } = await import("../../db");
        const { joinOutcomeActuals } = await import("../../scheduled/learningLoopRefresh");
        const db = await getDb();
        const j1 = await joinOutcomeActuals(db!, new Date());
        ctx.assert(j1.joined >= 1, "calibration join filled actuals");
        const joined = await ctx.sql.unsafe(
          `SELECT actual_winner, actual_amount_usd FROM outcome_model_predictions WHERE dispute_id = $1`,
          [st.predDisputeId],
        );
        ctx.assertEqual(joined[0].actual_winner, "initiating_party", "actual winner joined");
        ctx.assertEqual(Number(joined[0].actual_amount_usd), 1250, "actual amount joined");
        const j2 = await joinOutcomeActuals(db!, new Date());
        ctx.assertEqual(j2.joined, 0, "calibration join idempotent");
        return { evidence: { winProbability: gen.winProbability, modelVersion: gen.modelVersion } };
      },
    },
    {
      name: "next-actions-info-cards-present",
      async run(ctx) {
        const st = (ctx as unknown as { _st: J33State })._st;
        // limit: 50 (schema max) — accumulated seed data pushes cards past
        // the default limit:20 slice.
        const list = await ctx.provider.nextActions.list({ orgId: st.orgId, persona: "provider", limit: 50 });
        const idle = list.cards.find(c => c.actionKey === `idle-offer:${st.idleDisputeId}`);
        const adv = list.cards.find(c => c.actionKey === `advance:${st.idleDisputeId}`);
        ctx.assert(idle, "idle_offer card surfaced");
        ctx.assert(adv, "advance_step card surfaced");
        ctx.assertEqual(idle!.severity, "info", "idle card is info-severity");
        ctx.assertEqual(adv!.severity, "info", "advance card is info-severity");
        // Static order: the advance card (recently touched dispute set) is
        // the baseline the learned reorder in the next step must beat.
        ctx.assert(list.ranking.scope === "org_persona", "ranking block present");
        return { evidence: { cards: list.cards.length, label: list.ranking.label } };
      },
    },
    {
      name: "ranking-reorder-with-seeded-dismissals",
      async run(ctx) {
        const st = (ctx as unknown as { _st: J33State })._st;
        // Seeded dismissals/acts: idle_offer well-acted, advance_step
        // repeatedly dismissed (rejected) — both above the impressions floor.
        for (let i = 0; i < 12; i++) {
          await ctx.sql.unsafe(
            `INSERT INTO suggestion_events (id, org_id, user_id, suggestion_id, surface, action, model_name, metadata)
             VALUES ($1, $2, 'jrn-user-provider', $3, 'next_action', 'presented', 'next-actions-v1', $4::jsonb)`,
            [crypto.randomUUID(), st.orgId, ctx.ns(`j33-na-idle-${i}`), JSON.stringify({ kind: "idle_offer", persona: "provider" })],
          );
          if (i < 9) {
            await ctx.sql.unsafe(
              `INSERT INTO suggestion_events (id, org_id, user_id, suggestion_id, surface, action, model_name, metadata)
               VALUES ($1, $2, 'jrn-user-provider', $3, 'next_action', 'accepted', 'next-actions-v1', $4::jsonb)`,
              [crypto.randomUUID(), st.orgId, ctx.ns(`j33-na-idle-${i}`), JSON.stringify({ kind: "idle_offer", persona: "provider" })],
            );
          }
          await ctx.sql.unsafe(
            `INSERT INTO suggestion_events (id, org_id, user_id, suggestion_id, surface, action, model_name, metadata)
             VALUES ($1, $2, 'jrn-user-provider', $3, 'next_action', 'presented', 'next-actions-v1', $4::jsonb)`,
            [crypto.randomUUID(), st.orgId, ctx.ns(`j33-na-adv-${i}`), JSON.stringify({ kind: "advance_step", persona: "provider" })],
          );
          await ctx.sql.unsafe(
            `INSERT INTO suggestion_events (id, org_id, user_id, suggestion_id, surface, action, model_name, metadata)
             VALUES ($1, $2, 'jrn-user-provider', $3, 'next_action', 'rejected', 'next-actions-v1', $4::jsonb)`,
            [crypto.randomUUID(), st.orgId, ctx.ns(`j33-na-adv-${i}`), JSON.stringify({ kind: "advance_step", persona: "provider" })],
          );
        }
        // Real dismiss path: dismissing the advance card records a `rejected`
        // suggestion event; expiring the dismissal resurfaces the card.
        const advKey = `advance:${st.idleDisputeId}`;
        await ctx.provider.nextActions.dismiss({ actionKey: advKey });
        const rej = await ctx.sql.unsafe(
          `SELECT count(*)::int AS n FROM suggestion_events WHERE suggestion_id = $1 AND surface = 'next_action' AND action = 'rejected'`,
          [advKey],
        );
        ctx.assert(Number(rej[0].n) >= 1, "dismiss recorded a rejected event");
        await ctx.sql.unsafe(
          `UPDATE next_action_dismissals SET expires_at = now() - interval '1 second' WHERE user_id = 'jrn-user-provider' AND action_key = $1`,
          [advKey],
        );
        const { getDb } = await import("../../db");
        const { refreshRankingStats } = await import("../../scheduled/learningLoopRefresh");
        const db = await getDb();
        await refreshRankingStats(db!, new Date());
        const list = await ctx.provider.nextActions.list({ orgId: st.orgId, persona: "provider", limit: 50 });
        ctx.assertEqual(list.ranking.label, "learning_active", "learned ranking active above the floor");
        const idleIdx = list.cards.findIndex(c => c.kind === "idle_offer");
        const advIdx = list.cards.findIndex(c => c.kind === "advance_step");
        ctx.assert(idleIdx >= 0 && advIdx >= 0, "both info cards still surfaced");
        ctx.assertEqual(list.cards[idleIdx].severity, "info", "idle card info");
        ctx.assertEqual(list.cards[advIdx].severity, "info", "advance card info");
        ctx.assert(idleIdx < advIdx, "learned order: well-acted idle_offer outranks dismissed advance_step");
        // Fresh org: zero impressions → byte-identical static ordering.
        const other = await ctx.reviewer.orgs.create({ name: `J33 Fresh ${ctx.ns("j33fresh")}`, type: "provider" });
        const fresh = await ctx.reviewer.nextActions.list({ orgId: other.orgId, persona: "provider", limit: 50 });
        ctx.assertEqual(fresh.ranking.label, "static_ordering", "fresh org keeps static ordering");
        return { evidence: { idleIdx, advIdx, learnedItems: list.ranking.learnedItems } };
      },
    },
  ],
};
