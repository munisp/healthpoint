/**
 * J34: DataSketches KLL/HLL fallback (Phase 23).
 *
 *  seed a DEDICATED fixture user + org (so the creator→org attribution of the
 *  sketch write path is unambiguous) with 30 closed determinations in a
 *  unique leaf segment and a bulk-ingested claims surface of known distinct
 *  counts → POST /api/scheduled/learning-loop-refresh (handler path, as
 *  J33) → assert outcome_segment_sketches rows exist with NULL sketch (no
 *  datasketches extension in this environment) and EXACT row_count →
 *  generateOutcomePredictionFromModel returns estimateProvenance "exact"
 *  with numbers identical to the pure P22 recomputation →
 *  intelligence.ingestCardinality returns exact distinct counts with
 *  per-metric provenance "exact" → a second refresh does not accumulate.
 *
 * Sketch-path live execution is STATIC-ONLY here (extension absent); the
 * fallback path is EXECUTED-VERIFIED.
 *
 * Template: J33's pattern (real handler + ctx.sql for fixtures).
 */
import type { Request, Response } from "express";
import type { Journey } from "../framework";

const SERVICE = "emergency_medicine";
const STATE = "WA";

interface J34State {
  userId: string;
  orgId: string;
  idre: string;
  leafKey: string;
  predDisputeId: string;
}

export const j34: Journey = {
  id: "J34",
  title: "DataSketches fallback: exact-only sketches maintenance, prediction provenance, ingest cardinality",
  actor: "provider",
  description:
    "Seeds a dedicated user+org with a covered leaf segment and a claims surface of known cardinalities, drives the nightly learning-loop refresh through its scheduled handler, proves outcome_segment_sketches rows are written with NULL sketch and exact row_count (idempotent across refreshes), the trained prediction read reports estimateProvenance \"exact\", and intelligence.ingestCardinality reports exact distinct counts per metric with sketchCapable=false.",
  steps: [
    {
      name: "seed-dedicated-user-org-disputes-and-claims",
      async run(ctx) {
        const { canonicalSegmentKey } = await import("../../idr/segment-keys");
        const userId = ctx.ns("j34-user");
        const idre = ctx.ns("j34-idre");
        const st: J34State = {
          userId,
          orgId: "",
          idre,
          leafKey: canonicalSegmentKey("idr_entity_x_service_x_patientstate", {
            idrEntityId: idre, serviceType: SERVICE, patientState: STATE,
          }),
          predDisputeId: ctx.ns("j34-pred"),
        };
        (ctx as unknown as { _st: J34State })._st = st;

        // Dedicated user (a shared fixture user would make the creator→org
        // MIN("orgId") attribution span other journeys' orgs).
        await ctx.sql.unsafe(
          `INSERT INTO users (id, name, email, "loginMethod", role)
           VALUES ($1, 'J34 User', $2, 'test', 'user') ON CONFLICT DO NOTHING`,
          [userId, `${userId}@test.local`],
        );
        // Org + owner membership via the real tRPC path (creates both rows).
        const { rootRouter } = await import("../../app-router");
        const { makeCtxForUser } = await import("../framework");
        const urows = await ctx.sql.unsafe(`SELECT * FROM users WHERE id = $1`, [userId]);
        ctx.assertEqual(urows.length, 1, "dedicated user seeded");
        const caller = rootRouter.createCaller(makeCtxForUser(urows[0] as never));
        const org = await caller.orgs.create({ name: `J34 Practice ${ctx.ns("j34")}`, type: "provider" });
        st.orgId = org.orgId;

        // 30 closed determinations in a unique leaf segment (18/12 wins).
        for (let i = 0; i < 30; i++) {
          await ctx.sql.unsafe(
            `INSERT INTO disputes (id, "referenceNumber", "initiatingPartyId", "initiatingPartyType", "initiatingPartyName",
               "respondingPartyName", "serviceType", "serviceDate", "patientState", "facilityState", "cptCodes",
               "billedAmount", "qpaAmount", "determinationAmount", "determinationWinner", "idrEntityId", status, "createdBy")
             VALUES ($1, $2, $3, 'provider', 'J34 Provider', 'J34 Payer', '${SERVICE}',
               '2026-06-01', '${STATE}', '${STATE}', '["99285"]', 2000, 1000, $4, $5, $6, 'closed', $3)
             ON CONFLICT DO NOTHING`,
            [ctx.ns(`j34-det-${i}`), `J34D-${ctx.runId.slice(-6)}-${i}`, userId,
              i % 2 === 0 ? 1200 : 1000, i < 18 ? "initiating_party" : "responding_party", idre],
          );
        }
        // Open dispute for the prediction read.
        await ctx.sql.unsafe(
          `INSERT INTO disputes (id, "referenceNumber", "initiatingPartyId", "initiatingPartyType", "initiatingPartyName",
             "respondingPartyName", "serviceType", "serviceDate", "patientState", "facilityState", "cptCodes",
             "billedAmount", "qpaAmount", "respondingPartyOffer", "idrEntityId", status, "createdBy")
           VALUES ($1, $2, $3, 'provider', 'J34 Provider', 'J34 Payer', '${SERVICE}',
             '2026-08-01', '${STATE}', '${STATE}', '["99285"]', 2000, 1000, 600, $4, 'offer_submission', $3)
           ON CONFLICT DO NOTHING`,
          [st.predDisputeId, `J34P-${ctx.runId.slice(-6)}`, userId, idre],
        );
        // Claims surface: 8 rows, 3 patients, 2 rendering NPIs, 5 ICNs.
        for (let i = 0; i < 8; i++) {
          await ctx.sql.unsafe(
            `INSERT INTO practice_claims (id, "orgId", source, "contentSha256", "patientRef", "renderingNpi", "claimId")
             VALUES ($1, $2, 'csv', $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
            [
              ctx.ns(`j34-pc-${i}`), st.orgId,
              // deterministic 64-char hex stand-in
              `${ctx.runId}${i}`.padEnd(64, "0").slice(0, 64).replace(/[^0-9a-z]/g, "a"),
              `j34-pat-${ctx.runId.slice(-6)}-${i % 3}`,
              `223456789${i % 2}`,
              `j34-icn-${ctx.runId.slice(-6)}-${i % 5}`,
            ],
          );
        }
        return { evidence: { orgId: st.orgId, leafKey: st.leafKey } };
      },
    },
    {
      name: "refresh-writes-exact-sketch-rows",
      async run(ctx) {
        const st = (ctx as unknown as { _st: J34State })._st;
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
          sketches?: { result?: { rows: number; sketchActive: boolean }; error?: string };
          outcomeModel?: { training?: { status: string } };
        };
        ctx.assert(body.ok === true, "refresh handler ok");
        ctx.assert(!body.sketches?.error, `sketch maintenance error: ${body.sketches?.error ?? "none"}`);
        ctx.assertEqual(body.sketches?.result?.sketchActive, false, "extension absent → sketch path inactive");
        ctx.assertEqual(body.outcomeModel?.training?.status, "active", "exact outcome model trained");

        // Rows exist for this org with NULL sketch and EXACT row_count.
        const rows = await ctx.sql.unsafe(
          `SELECT segment_key, row_count, sketch FROM outcome_segment_sketches WHERE org_id = $1`,
          [st.orgId],
        );
        ctx.assert(rows.length >= 5, "five tier rows written for the org", { rows: rows.length });
        const leaf = rows.find(r => r.segment_key === st.leafKey);
        ctx.assert(leaf, "leaf segment row exists");
        ctx.assertEqual(Number(leaf!.row_count), 30, "leaf row_count is the exact seeded count");
        ctx.assert(leaf!.sketch === null, "sketch bytes NULL without the extension");
        const platform = rows.find(r => r.segment_key === "platform");
        ctx.assert(platform, "platform row exists");
        ctx.assertEqual(Number(platform!.row_count), 30, "platform row_count exact");
        // Independent exactness cross-check (creator→org attribution).
        const expect30 = await ctx.sql.unsafe(
          `SELECT COUNT(*)::int AS n FROM disputes d
           WHERE d."determinationWinner" IS NOT NULL AND d."determinationAmount" IS NOT NULL
             AND (SELECT MIN(m."orgId") FROM org_memberships m WHERE m."userId" = d."createdBy") = $1`,
          [st.orgId],
        );
        ctx.assertEqual(Number(platform!.row_count), Number(expect30[0].n), "row_count matches independent attribution count");
        return { evidence: { rows: rows.length, leafRowCount: Number(leaf!.row_count) } };
      },
    },
    {
      name: "prediction-read-provenance-exact",
      async run(ctx) {
        const st = (ctx as unknown as { _st: J34State })._st;
        const { getDb } = await import("../../db");
        const db = await getDb();
        ctx.assert(db, "db available");
        const drows = await ctx.sql.unsafe(`SELECT * FROM disputes WHERE id = $1`, [st.predDisputeId]);
        ctx.assertEqual(drows.length, 1, "prediction dispute seeded");
        const { generateOutcomePredictionFromModel } = await import("../../idr/outcome-prediction-source");
        const trained = await generateOutcomePredictionFromModel(db!, drows[0] as never);
        ctx.assert(trained !== null, "trained prediction produced for covered segment");
        ctx.assertEqual(trained!.estimateProvenance, "exact", "provenance exact without the extension");
        ctx.assertEqual(trained!.segmentKey, st.leafKey, "leaf segment key used");
        // Byte-identical cold start: numbers equal the pure P22 recomputation.
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
        ctx.assertEqual(trained!.winProbability, Math.round(expected!.winProb * 100), "winProbability matches pure recomputation");
        ctx.assertEqual(trained!.prediction.awardP50Usd, expected!.awardP50Usd, "award median matches pure recomputation");
        ctx.assert(!trained!.keyFactors.join("\n").includes("KLL"), "no sketch language in exact mode");
        return { evidence: { winProbability: trained!.winProbability, provenance: trained!.estimateProvenance } };
      },
    },
    {
      name: "ingest-cardinality-exact-counts",
      async run(ctx) {
        const st = (ctx as unknown as { _st: J34State })._st;
        const { rootRouter } = await import("../../app-router");
        const { makeCtxForUser } = await import("../framework");
        const urows = await ctx.sql.unsafe(`SELECT * FROM users WHERE id = $1`, [st.userId]);
        const caller = rootRouter.createCaller(makeCtxForUser(urows[0] as never));
        const r = await caller.intelligence.ingestCardinality({ orgId: st.orgId });
        ctx.assertEqual(r.rowCount, 8, "claims row count");
        ctx.assertEqual(r.sketchCapable, false, "extension absent → sketchCapable false");
        ctx.assertEqual(r.patients.value, 3, "exact distinct patients");
        ctx.assertEqual(r.patients.estimateProvenance, "exact", "patients provenance exact");
        ctx.assertEqual(r.renderingNpis.value, 2, "exact distinct rendering NPIs");
        ctx.assertEqual(r.renderingNpis.estimateProvenance, "exact", "NPIs provenance exact");
        ctx.assertEqual(r.icns.value, 5, "exact distinct ICNs");
        ctx.assertEqual(r.icns.estimateProvenance, "exact", "ICNs provenance exact");
        // Cross-org isolation.
        let forbidden = false;
        try {
          await ctx.reviewer.intelligence.ingestCardinality({ orgId: st.orgId });
        } catch (e) {
          forbidden = (e as { code?: string }).code === "FORBIDDEN" || String(e).includes("FORBIDDEN");
        }
        ctx.assert(forbidden, "reviewer cannot read another org's cardinality");
        return { evidence: { rowCount: r.rowCount, patients: r.patients.value, npis: r.renderingNpis.value, icns: r.icns.value } };
      },
    },
    {
      name: "second-refresh-idempotent",
      async run(ctx) {
        const st = (ctx as unknown as { _st: J34State })._st;
        const { getDb } = await import("../../db");
        const { runLearningLoopRefresh } = await import("../../scheduled/learningLoopRefresh");
        const db = await getDb();
        const out = await runLearningLoopRefresh(db!, new Date());
        ctx.assert(!out.sketches?.error, "second refresh sketch step clean");
        const rows = await ctx.sql.unsafe(
          `SELECT segment_key, row_count, sketch FROM outcome_segment_sketches WHERE org_id = $1`,
          [st.orgId],
        );
        const leaf = rows.find(r => r.segment_key === st.leafKey);
        ctx.assert(leaf, "leaf row still present after re-refresh");
        ctx.assertEqual(Number(leaf!.row_count), 30, "row_count NOT accumulated on re-run");
        ctx.assert(leaf!.sketch === null, "sketch still NULL");
        return { evidence: { leafRowCount: Number(leaf!.row_count), rows: rows.length } };
      },
    },
  ],
};
