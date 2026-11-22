/**
 * J32: intelligence & learning loop (Phase 21).
 *
 *  seed org + quarantined row + closed determinations → prefill.quarantineRows
 *  suggestions (reparse + org-prior gate) → repairQuarantinedRows with
 *  acceptedSuggestionIds (assisted provenance + accepted events) →
 *  runOfferModelTraining → offerStrategy.recommendV2 (trained segment,
 *  modelVersion block; honesty label on thin tiers) → nextActions.list
 *  surfaces the seeded deadline card → dismiss → excluded → expiry → back.
 *
 * Template: J30's pattern (real tRPC callers + ctx.sql for fixtures).
 */
import crypto from "node:crypto";
import type { Journey } from "../framework";

function claimLine(runId: string, i: number): string {
  return JSON.stringify({
    resourceType: "Claim",
    id: `j32-clm-${runId}-${i}`,
    identifier: [{ value: `J32-${runId}-${i}` }],
    status: "active",
    patient: { reference: `Patient/j32-pat-${runId}` },
    billablePeriod: { start: "2026-08-01", end: "2026-08-01" },
    insurer: { reference: "Organization/j32-payer", display: "AETNA HEALTH" },
    item: [{ sequence: 1, productOrService: { coding: [{ system: "http://www.ama-assn.org/go/cpt", code: "99285" }] }, servicedDate: "2026-08-01" }],
    total: { value: 4200.0, currency: "USD" },
  });
}

interface J32State {
  orgId: string;
  quarantineId: string;
  suggestionId: string;
  openDisputeId: string;
  modelVersionId: string;
}

export const j32: Journey = {
  id: "J32",
  title: "Intelligence & learning loop: feedback → quarantine suggestions → offer model v2 → next actions",
  actor: "provider",
  description:
    "Seeds an org with a quarantined ndjson row and 25 closed determinations in one segment, then exercises the Phase 21 surface end-to-end: quarantine-repair suggestions with the org-prior n>=5 gate, assisted repair with accepted suggestion events, nightly offer-model training + recommendV2 with the modelVersion honesty block, and the next-action queue with dismissal expiry.",
  steps: [
    {
      name: "seed-org-and-fixtures",
      async run(ctx) {
        const org = await ctx.provider.orgs.create({ name: `J32 Practice ${ctx.ns("j32")}`, type: "provider" });
        const st: J32State = { orgId: org.orgId, quarantineId: "", suggestionId: "", openDisputeId: "", modelVersionId: "" };
        (ctx as unknown as { _st: J32State })._st = st;
        // Org priors: 5 staged claims with planType SELF_FUNDED.
        for (let i = 0; i < 5; i++) {
          await ctx.sql.unsafe(
            `INSERT INTO practice_claims (id, "orgId", source, "contentSha256", "planType")
             VALUES ($1, $2, 'csv', $3, 'SELF_FUNDED') ON CONFLICT DO NOTHING`,
            [ctx.ns(`j32-pc-${i}`), st.orgId, crypto.createHash("sha256").update(ctx.ns(`pc-${i}`)).digest("hex")],
          );
        }
        // Quarantined row (session + claim_quarantine).
        const sessionId = crypto.randomUUID();
        await ctx.sql.unsafe(
          `INSERT INTO bulk_upload_sessions (id, org_id, created_by_user_id, file_name, file_type, declared_size_bytes, chunk_size_bytes, total_chunks, status)
           VALUES ($1, $2, $3, 'j32.ndjson', 'ndjson', 10, 8388608, 1, 'completed')`,
          [sessionId, st.orgId, "jrn-user-provider"],
        );
        st.quarantineId = crypto.randomUUID();
        await ctx.sql.unsafe(
          `INSERT INTO claim_quarantine (id, session_id, org_id, row_number, raw_payload, error_reason, missing_fields)
           VALUES ($1, $2, $3, 1, $4, 'validation failed', $5::jsonb)`,
          // phase22-fix2: missing_fields is jsonb — pass the array, not
          // JSON.stringify (postgres.js double-encodes string params for
          // ::jsonb slots). raw_payload stays a string: that column is text.
          [st.quarantineId, sessionId, st.orgId, claimLine(ctx.runId, 1), ["claimId", "planType"]],
        );
        // 25 closed determinations in a unique leaf segment + 1 open dispute
        // with a near open-negotiation deadline.
        const idre = ctx.ns("j32-idre");
        for (let i = 0; i < 25; i++) {
          await ctx.sql.unsafe(
            `INSERT INTO disputes (id, "referenceNumber", "initiatingPartyId", "initiatingPartyType", "initiatingPartyName",
               "respondingPartyName", "serviceType", "serviceDate", "patientState", "facilityState", "cptCodes",
               "billedAmount", "qpaAmount", "determinationAmount", "determinationWinner", "idrEntityId", status, "createdBy")
             VALUES ($1, $2, 'jrn-user-provider', 'provider', 'J32 Provider', 'J32 Payer', 'emergency_medicine',
               '2026-06-01', 'TX', 'TX', '["99285"]', 2000, 1000, $3, $4, $5, 'closed', 'jrn-user-provider')
             ON CONFLICT DO NOTHING`,
            [ctx.ns(`j32-det-${i}`), `J32D-${ctx.runId.slice(-6)}-${i}`, i % 2 === 0 ? 1200 : 1000, i < 18 ? "initiating_party" : "responding_party", idre],
          );
        }
        st.openDisputeId = ctx.ns("j32-open");
        await ctx.sql.unsafe(
          `INSERT INTO disputes (id, "referenceNumber", "initiatingPartyId", "initiatingPartyType", "initiatingPartyName",
             "respondingPartyName", "serviceType", "serviceDate", "patientState", "facilityState", "cptCodes",
             "billedAmount", "qpaAmount", "respondingPartyOffer", "idrEntityId", status, "createdBy", "openNegotiationDeadline")
           VALUES ($1, $2, 'jrn-user-provider', 'provider', 'J32 Provider', 'J32 Payer', 'emergency_medicine',
             '2026-08-01', 'TX', 'TX', '["99285"]', 2000, 1000, 600, $3, 'offer_submission', 'jrn-user-provider',
             now() + interval '2 days')
           ON CONFLICT DO NOTHING`,
          [st.openDisputeId, `J32O-${ctx.runId.slice(-6)}`, idre],
        );
        return { evidence: { orgId: st.orgId } };
      },
    },
    {
      name: "quarantine-suggestions-with-org-prior-gate",
      async run(ctx) {
        const st = (ctx as unknown as { _st: J32State })._st;
        const res = await ctx.provider.prefill.quarantineRows({ orgId: st.orgId, quarantineIds: [st.quarantineId] });
        ctx.assertEqual(res.rows.length, 1, "one suggestion set returned");
        st.suggestionId = res.rows[0].suggestionId;
        const byField = new Map(res.rows[0].suggestions.map(s => [s.field, s]));
        ctx.assert(byField.get("claimId")?.source === "reparse", "claimId suggestion from reparse");
        ctx.assert(byField.get("planType")?.source === "org_prior" && byField.get("planType")?.suggestedValue === "SELF_FUNDED", "planType org prior (n=5 meets gate)");
        const presented = await ctx.sql.unsafe(
          `SELECT count(*)::int AS n FROM suggestion_events WHERE suggestion_id = $1 AND action = 'presented'`,
          [st.suggestionId],
        );
        ctx.assertEqual(Number(presented[0].n), res.rows[0].suggestions.length, "presented events recorded per suggestion");
        return { evidence: { suggestions: res.rows[0].suggestions.length } };
      },
    },
    {
      name: "assisted-repair-records-accepted-events",
      async run(ctx) {
        const st = (ctx as unknown as { _st: J32State })._st;
        const rep = await ctx.provider.bulkUpload.repairQuarantinedRows({
          orgId: st.orgId,
          updates: [{
            quarantineId: st.quarantineId,
            fields: {
              claimId: `J32-${ctx.runId}-1`,
              payerName: "AETNA HEALTH",
              serviceDate: "2026-08-01",
              patientState: "TX", facilityState: "TX",
              networkStatus: "out_of_network",
              cptCodes: ["99285"],
              billedCents: 420000, paidCents: 10000,
              initialPaymentDate: "2026-08-15",
            },
          }],
          acceptedSuggestionIds: [st.suggestionId],
        });
        ctx.assertEqual(rep.results.length, 1, "one repair result");
        const accepted = await ctx.sql.unsafe(
          `SELECT count(*)::int AS n FROM suggestion_events WHERE suggestion_id = $1 AND action = 'accepted'`,
          [st.suggestionId],
        );
        ctx.assert(Number(accepted[0].n) >= 1, "accepted terminal events recorded");
        if (rep.results[0].claimDbId) {
          const pc = await ctx.sql.unsafe(
            `SELECT "sourceProvenance"::text AS p FROM practice_claims WHERE id = $1`,
            [rep.results[0].claimDbId],
          );
          ctx.assert(String(pc[0]?.p ?? "").includes("quarantine-repair (assisted)"), "assisted provenance recorded");
        }
        return { evidence: { repaired: rep.repaired, claimDbId: rep.results[0].claimDbId } };
      },
    },
    {
      name: "offer-model-training-and-recommendV2",
      async run(ctx) {
        const st = (ctx as unknown as { _st: J32State })._st;
        const { getDb } = await import("../../db");
        const { runOfferModelTraining } = await import("../../scheduled/offerModelRefresh");
        const db = await getDb();
        ctx.assert(db, "db available");
        const t = await runOfferModelTraining(db!, new Date());
        ctx.assertEqual(t.status, "active", "model trained active on seeded determinations");
        ctx.assert(t.trainingSampleSize >= 25, "sample size includes seeded segment");
        st.modelVersionId = t.modelVersionId;
        const r = await ctx.provider.offerStrategy.recommendV2({ orgId: st.orgId, disputeId: st.openDisputeId });
        ctx.assertEqual(r.label, "statistical_estimate", "trained segment yields statistical_estimate");
        ctx.assertEqual(r.modelVersion.id, t.modelVersionId, "modelVersion block carried in payload");
        ctx.assertEqual(r.features.segmentTierUsed, "idr_entity_x_service_x_patientstate", "leaf segment used");
        ctx.assert(r.recommendedOfferUsdStatisticalEstimate !== null, "estimate present");
        ctx.assert(typeof r.honestyNote === "string" && r.honestyNote.length > 20, "honesty note present");
        return { evidence: { version: t.version, tier: r.features.segmentTierUsed, estimate: r.recommendedOfferUsdStatisticalEstimate } };
      },
    },
    {
      name: "next-actions-deadline-card-and-dismissal",
      async run(ctx) {
        const st = (ctx as unknown as { _st: J32State })._st;
        const key = `deadline:${st.openDisputeId}:open_negotiation`;
        const list = await ctx.provider.nextActions.list({ orgId: st.orgId });
        ctx.assert(list.cards.some(c => c.actionKey === key), "deadline card surfaced");
        await ctx.provider.nextActions.dismiss({ actionKey: key });
        const after = await ctx.provider.nextActions.list({ orgId: st.orgId });
        ctx.assert(!after.cards.some(c => c.actionKey === key), "dismissed card excluded");
        await ctx.sql.unsafe(
          `UPDATE next_action_dismissals SET expires_at = now() - interval '1 second' WHERE user_id = 'jrn-user-provider' AND action_key = $1`,
          [key],
        );
        const back = await ctx.provider.nextActions.list({ orgId: st.orgId });
        ctx.assert(back.cards.some(c => c.actionKey === key), "expired dismissal resurfaces card");
        return { evidence: { cards: back.cards.length } };
      },
    },
    {
      name: "feedback-metrics-reflect-events",
      async run(ctx) {
        const st = (ctx as unknown as { _st: J32State })._st;
        const m = await ctx.provider.feedback.metrics({ orgId: st.orgId, days: 30 });
        const qr = m.bySurface.find(r => r.surface === "quarantine_repair");
        ctx.assert(qr && qr.presented >= 1 && qr.accepted >= 1, "quarantine_repair metrics aggregated");
        const na = m.bySurface.find(r => r.surface === "next_action");
        ctx.assert(na && na.presented >= 1, "next_action impressions recorded");
        const off = m.bySurface.find(r => r.surface === "offer_recommendation");
        ctx.assert(off && off.presented >= 1, "offer_recommendation presented recorded");
        return { evidence: { surfaces: m.bySurface.map(s => s.surface) } };
      },
    },
  ],
};
