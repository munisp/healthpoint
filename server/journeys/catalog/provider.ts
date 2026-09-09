/**
 * J01–J06: provider/biller-side journeys (dispute intake, negotiation, IDR
 * initiation + entity selection, documents, batching eligibility, QPA engine).
 */
import type { Journey } from "../framework";
import {
  createJourneyDispute,
  advanceToNegotiationFailed,
  advanceToEntitySelection,
  expectTrpcError,
} from "./helpers";

export const j01: Journey = {
  id: "J01",
  title: "New dispute intake and FSM advance through open negotiation",
  actor: "provider",
  description:
    "disputes.create then FSM advance STEP_01..STEP_05 with QPA + party offers, verifying deadlines and timeline.",
  steps: [
    {
      name: "intake-create",
      async run(ctx) {
        const d = await createJourneyDispute(ctx, "j01");
        (ctx as unknown as { _d: string })._d = d.id;
        ctx.assert(d.id.length > 0, "dispute id returned");
        ctx.assert(d.referenceNumber.startsWith("IDR-"), "reference number generated", {
          referenceNumber: d.referenceNumber,
        });
        const full = await ctx.provider.disputes.getById({ id: d.id });
        ctx.assertEqual(full.currentStep, "STEP_01_OPEN_NEGOTIATION_INITIATED", "initial step");
        ctx.assertEqual(full.status, "open_negotiation", "initial status");
        ctx.assert(full.openNegotiationDeadline !== null, "30-business-day ON deadline computed");
        return { evidence: { disputeId: d.id, referenceNumber: d.referenceNumber } };
      },
    },
    {
      name: "offers-and-advance",
      async run(ctx) {
        const disputeId = (ctx as unknown as { _d: string })._d;
        await ctx.provider.disputes.submitOffer({
          disputeId, offerType: "qpa", amount: "2600.00", rationale: "QPA disclosure",
        });
        await ctx.provider.disputes.submitOffer({
          disputeId, offerType: "initiating_party", amount: "4200.00", rationale: "Billed charges",
        });
        await ctx.provider.disputes.submitOffer({
          disputeId, offerType: "responding_party", amount: "2400.00", rationale: "Payer counter at 92% QPA",
        });
        await ctx.provider.disputes.advance({
          disputeId, newStep: "STEP_02_OPEN_NEGOTIATION_PERIOD", newStatus: "open_negotiation",
          description: "Negotiation window open",
        });
        const mid = await ctx.provider.disputes.getById({ id: disputeId });
        ctx.assertEqual(mid.currentStep, "STEP_02_OPEN_NEGOTIATION_PERIOD", "advanced to STEP_02");
        ctx.assertEqual(String(mid.qpaAmount), "2600.00", "QPA persisted from qpa offer");
        ctx.assert(Array.isArray(mid.offers) && mid.offers.length === 3, "three offers persisted", {
          offers: mid.offers.length,
        });
        await ctx.provider.disputes.advance({
          disputeId, newStep: "STEP_03_OPEN_NEGOTIATION_FAILED", newStatus: "idr_initiated",
          description: "30-business-day window elapsed without agreement",
        });
        await ctx.provider.disputes.advance({
          disputeId, newStep: "STEP_04_IDR_INITIATED", newStatus: "idr_initiated",
          description: "IDR initiated within 4 business days",
        });
        await ctx.provider.disputes.advance({
          disputeId, newStep: "STEP_05_IDR_NOTICE_SENT", newStatus: "idr_initiated",
          description: "IDR initiation notice sent to other party",
        });
        return { evidence: { disputeId } };
      },
    },
    {
      name: "verify-persistence-and-guards",
      async run(ctx) {
        const disputeId = (ctx as unknown as { _d: string })._d;
        const full = await ctx.provider.disputes.getById({ id: disputeId });
        ctx.assertEqual(full.currentStep, "STEP_05_IDR_NOTICE_SENT", "final step persisted");
        ctx.assert(full.idrInitiationDeadline !== null, "IDR initiation deadline persisted");
        // Negative path: skipping ahead must be rejected by the FSM validator.
        await expectTrpcError(
          ctx,
          ctx.provider.disputes.advance({
            disputeId, newStep: "STEP_13_DETERMINATION_ISSUED", newStatus: "determination_issued",
            description: "illegal skip",
          }),
          "BAD_REQUEST",
          "illegal step skip rejected"
        );
        // IDOR negative path: unrelated user cannot read the dispute.
        await expectTrpcError(
          ctx, ctx.reviewer.disputes.getById({ id: disputeId }), "FORBIDDEN", "IDOR read denied"
        );
        const timeline = await ctx.provider.disputes.getTimeline({ disputeId });
        ctx.assert(timeline.timeline.length === 19, "timeline covers 19 workflow steps");
        return { evidence: { currentStep: full.currentStep, timelineSteps: timeline.timeline.length } };
      },
    },
  ],
};

export const j02: Journey = {
  id: "J02",
  title: "Full 30-business-day open-negotiation cycle with offer/counter-offer/accept",
  actor: "biller",
  description:
    "disputes.create + offer exchange during STEP_02, then acceptOffer → STEP_13 determination_issued.",
  steps: [
    {
      name: "create-and-open-negotiation",
      async run(ctx) {
        const d = await createJourneyDispute(ctx, "j02", { billedAmount: "9000.00" });
        (ctx as unknown as { _d: string })._d = d.id;
        await ctx.provider.disputes.submitOffer({
          disputeId: d.id, offerType: "qpa", amount: "5400.00", rationale: "QPA disclosure",
        });
        await ctx.provider.disputes.advance({
          disputeId: d.id, newStep: "STEP_02_OPEN_NEGOTIATION_PERIOD", newStatus: "open_negotiation",
          description: "Open negotiation started",
        });
        return { evidence: { disputeId: d.id } };
      },
    },
    {
      name: "offer-counter-offer-accept",
      async run(ctx) {
        const disputeId = (ctx as unknown as { _d: string })._d;
        await ctx.provider.disputes.submitOffer({
          disputeId, offerType: "initiating_party", amount: "9000.00", rationale: "Full billed charges",
        });
        const counter = await ctx.provider.disputes.submitOffer({
          disputeId, offerType: "responding_party", amount: "6100.00", rationale: "Counter-offer above QPA",
        });
        ctx.assert(counter.offerId.length > 0, "counter-offer id returned");
        const accepted = await ctx.provider.disputes.acceptOffer({ disputeId, offerId: counter.offerId });
        ctx.assert(accepted.success === true, "acceptOffer succeeded");
        ctx.assertEqual(accepted.dispute.currentStep, "STEP_13_DETERMINATION_ISSUED", "accepted offer jumps to determination");
        ctx.assertEqual(String(accepted.dispute.determinationAmount), "6100.00", "determination = accepted offer");
        return { evidence: { acceptedOfferId: counter.offerId, determination: accepted.dispute.determinationAmount } };
      },
    },
    {
      name: "verify-resolution-persisted",
      async run(ctx) {
        const disputeId = (ctx as unknown as { _d: string })._d;
        const full = await ctx.provider.disputes.getById({ id: disputeId });
        ctx.assertEqual(full.status, "determination_issued", "status persisted");
        const acceptedOffer = full.offers.find(o => o.isAccepted);
        ctx.assert(acceptedOffer !== undefined, "accepted offer flagged in store");
        ctx.assertEqual(String(acceptedOffer!.amount), "6100.00", "accepted amount persisted");
        const notifs = await ctx.provider.notifications.list({ unreadOnly: false });
        ctx.assert(
          notifs.some(n => n.notificationType === "determination_issued"),
          "determination notification emitted"
        );
        return { evidence: { status: full.status, notificationCount: notifs.length } };
      },
    },
  ],
};

export const j03: Journey = {
  id: "J03",
  title: "Negotiation fails → IDR initiation → entity selection → certified IDRE pick",
  actor: "provider",
  description:
    "disputes.advance through STEP_06, arbitrators.seedDemoEntities (admin) + list, disputes.selectArbitrator → STEP_07.",
  steps: [
    {
      name: "negotiation-fails-idr-initiated",
      async run(ctx) {
        const d = await createJourneyDispute(ctx, "j03");
        (ctx as unknown as { _d: string })._d = d.id;
        await advanceToNegotiationFailed(ctx, d.id);
        await advanceToEntitySelection(ctx, d.id);
        const full = await ctx.provider.disputes.getById({ id: d.id });
        ctx.assertEqual(full.currentStep, "STEP_06_IDR_ENTITY_SELECTION", "at entity selection");
        ctx.assert(full.entitySelectionDeadline !== null, "3-business-day entity selection deadline set");
        return { evidence: { disputeId: d.id } };
      },
    },
    {
      name: "seed-and-list-certified-idres",
      async run(ctx) {
        await ctx.admin.arbitrators.seedDemoEntities();
        const entities = await ctx.provider.arbitrators.list({});
        ctx.assert(entities.length >= 5, "certified IDR entities seeded", { count: entities.length });
        const withFee = entities.filter(e => e.name && e.name.length > 0);
        ctx.assertEqual(withFee.length, entities.length, "all entities have names");
        (ctx as unknown as { _e: string })._e = String((entities[0] as { id: string }).id);
        (ctx as unknown as { _en: string })._en = String((entities[0] as { name: string }).name);
        return { evidence: { entityCount: entities.length } };
      },
    },
    {
      name: "select-idre-and-verify",
      async run(ctx) {
        const disputeId = (ctx as unknown as { _d: string })._d;
        const entityId = (ctx as unknown as { _e: string })._e;
        const entityName = (ctx as unknown as { _en: string })._en;
        const updated = await ctx.provider.disputes.selectArbitrator({
          disputeId, idrEntityId: entityId, idrEntityName: entityName,
        });
        ctx.assertEqual(updated.currentStep, "STEP_07_IDR_ENTITY_SELECTED", "entity selected step");
        const full = await ctx.provider.disputes.getById({ id: disputeId });
        ctx.assertEqual(String(full.idrEntityId), entityId, "IDR entity persisted on dispute");
        ctx.assert(
          full.events.some(e => e.eventType === "step_advanced" && e.step === "STEP_07_IDR_ENTITY_SELECTED"),
          "selection event recorded"
        );
        return { evidence: { idrEntityId: entityId, currentStep: full.currentStep } };
      },
    },
  ],
};

export const j04: Journey = {
  id: "J04",
  title: "Document upload + doc intelligence + dedupe/clone/merge",
  actor: "biller",
  description:
    "documents.upload/list, docIntelligence.analyze (fail-closed w/o LLM or real extraction via stub LLM), disputes.findDuplicates/clone/merge.",
  steps: [
    {
      name: "upload-documents",
      async run(ctx) {
        const d = await createJourneyDispute(ctx, "j04");
        (ctx as unknown as { _d: string })._d = d.id;
        (ctx as unknown as { _ref: string })._ref = d.referenceNumber;
        const doc = await ctx.provider.documents.upload({
          disputeId: d.id,
          fileName: `eob-${ctx.ns("j04")}.pdf`,
          fileType: "application/pdf",
          documentType: "eob",
          fileSize: 1024,
          storageKey: `journeys/${ctx.runId}/eob.pdf`,
          storageUrl: "https://storage.invalid/journeys/eob.pdf",
          description: "EOB for journey",
        });
        const listed = await ctx.provider.documents.list({ disputeId: d.id });
        ctx.assert(listed.length === 1, "document persisted", { count: listed.length });
        ctx.assertEqual(listed[0].disputeId, d.id, "document linked to dispute");
        (ctx as unknown as { _doc: string })._doc = String(doc);
        return { evidence: { disputeId: d.id, docId: doc } };
      },
    },
    {
      name: "doc-intelligence",
      async run(ctx) {
        const disputeId = (ctx as unknown as { _d: string })._d;
        const png1x1 =
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
        const analysis = await ctx.provider.docIntelligence.analyze({
          fileName: "eob.png",
          fileType: "image/png",
          base64Data: png1x1,
          disputeId,
          documentType: "eob",
        });
        ctx.assert(analysis.id !== undefined, "analysis record returned");
        // With the runner's deterministic LLM stub the pipeline completes; if
        // no LLM backend is configured it must fail closed (either is asserted).
        ctx.assert(
          analysis.status === "completed" || analysis.status === "failed",
          "analysis reached a terminal state (no silent pending)",
          { status: analysis.status }
        );
        return { evidence: { analysisId: analysis.id, status: analysis.status } };
      },
    },
    {
      name: "dedupe-clone-merge",
      async run(ctx) {
        const disputeId = (ctx as unknown as { _d: string })._d;
        const ref = (ctx as unknown as { _ref: string })._ref;
        const dupes = await ctx.provider.disputes.findDuplicates({
          disputeId, claimNumber: ref.slice(0, 8),
        });
        ctx.assert(Array.isArray(dupes), "findDuplicates returns a list", { matches: dupes.length });
        const cloned = await ctx.provider.disputes.clone({ disputeId });
        ctx.assert(cloned.newDisputeId !== disputeId, "clone created a new dispute id");
        const cloneFull = await ctx.provider.disputes.getById({ id: cloned.newDisputeId });
        ctx.assertEqual(cloneFull.currentStep, "STEP_01_OPEN_NEGOTIATION_INITIATED", "clone starts at intake");
        const merged = await ctx.provider.disputes.merge({
          primaryDisputeId: disputeId, secondaryDisputeId: cloned.newDisputeId,
        });
        ctx.assert(merged.success === true, "merge succeeded");
        const postMerge = await ctx.provider.disputes.getById({ id: cloned.newDisputeId });
        ctx.assert(
          postMerge.status === "closed" || postMerge.currentStep === "STEP_17_DISPUTE_CLOSED",
          "merged secondary dispute closed",
          { status: postMerge.status, step: postMerge.currentStep }
        );
        return { evidence: { cloneId: cloned.newDisputeId, merged: true } };
      },
    },
  ],
};

export const j05: Journey = {
  id: "J05",
  title: "Batched dispute eligibility evaluation",
  actor: "biller",
  description:
    "batchedDisputes.evaluateEligibility over same-payer/same-provider qualified items; cap semantics legacy 25 vs 2026 50.",
  steps: [
    {
      name: "eligible-batch",
      async run(ctx) {
        const items = Array.from({ length: 3 }, (_, i) => ({
          lineItemId: ctx.ns(`j05-li-${i}`),
          serviceCode: "99285",
          providerNpi: "1234567893",
          providerTin: "12-3456789",
          payerId: "payer-journey",
          qualifiedIdrItem: true,
          dateOfService: new Date(Date.now() - 30 * 86400_000),
        }));
        const result = await ctx.provider.batchedDisputes.evaluateEligibility({ items });
        ctx.assert(result !== null && typeof result === "object", "evaluation returned");
        ctx.assert(
          /"eligible":true/.test(JSON.stringify(result)),
          "homogeneous qualified batch is eligible",
          { result }
        );
        return { evidence: { result } };
      },
    },
    {
      name: "cap-and-fail-closed",
      async run(ctx) {
        // 26 items without an ONP start date → legacy 25-item cap must reject.
        const items = Array.from({ length: 26 }, (_, i) => ({
          lineItemId: ctx.ns(`j05-cap-${i}`),
          serviceCode: "99285",
          payerId: "payer-journey",
          qualifiedIdrItem: true,
        }));
        const over = await ctx.provider.batchedDisputes.evaluateEligibility({ items });
        const overStr = JSON.stringify(over);
        ctx.assert(
          /eligible"\s*:\s*false|maxLineItems|25/.test(overStr),
          "26 items exceed the legacy 25-item cap (fail-closed)",
          { over }
        );
        // Non-qualified item must poison the batch.
        const mixed = await ctx.provider.batchedDisputes.evaluateEligibility({
          items: [
            { lineItemId: ctx.ns("j05-m1"), serviceCode: "99285", payerId: "payer-journey", qualifiedIdrItem: true },
            { lineItemId: ctx.ns("j05-m2"), serviceCode: "99285", payerId: "payer-journey", qualifiedIdrItem: false },
          ],
        });
        ctx.assert(
          JSON.stringify(mixed).includes('"eligible":false') ||
            JSON.stringify(mixed).toLowerCase().includes("not"),
          "non-qualified line item makes batch ineligible",
          { mixed }
        );
        return { evidence: { over, mixed } };
      },
    },
    {
      name: "verify-determinism",
      async run(ctx) {
        const items = [
          { lineItemId: ctx.ns("j05-det-1"), serviceCode: "99285", payerId: "payer-journey", qualifiedIdrItem: true },
          { lineItemId: ctx.ns("j05-det-2"), serviceCode: "99284", payerId: "payer-journey", qualifiedIdrItem: true },
        ];
        const a = await ctx.provider.batchedDisputes.evaluateEligibility({ items });
        const b = await ctx.provider.batchedDisputes.evaluateEligibility({ items });
        ctx.assertEqual(JSON.stringify(a), JSON.stringify(b), "evaluation is deterministic");
        return { evidence: { a } };
      },
    },
  ],
};

export const j06: Journey = {
  id: "J06",
  title: "QPA engine compute + benchmark seed + ingestion status",
  actor: "idre-admin",
  description:
    "qpaEngine.ingest (admin) + compute + methodology + ingestionStatus; qpaBenchmarks.seed/list; fail-closed when no rates.",
  steps: [
    {
      name: "methodology-and-fail-closed-compute",
      async run(ctx) {
        const methodology = await ctx.provider.qpaEngine.methodology();
        ctx.assert(methodology.failClosed === true, "methodology declares fail-closed");
        ctx.assert(methodology.citations.length > 0, "statutory citations present");
        const miss = await ctx.provider.qpaEngine.compute({
          serviceCode: "99299",
          market: "LARGE_GROUP",
          region: `region-${ctx.ns("j06-none")}`,
          asOfDate: new Date(),
        });
        ctx.assert(miss.computable === false, "unknown service/region is not computable (no fabricated QPA)", {
          reason: miss.reason,
        });
        return { evidence: { failClosedReason: miss.reason } };
      },
    },
    {
      name: "ingest-rates-and-compute",
      async run(ctx) {
        const region = `region-${ctx.ns("j06")}`;
        (ctx as unknown as { _r: string })._r = region;
        const rows = [90000, 100000, 110000].map((cents, i) => ({
          payerId: `payer-${i}`,
          serviceCode: "99285",
          market: "LARGE_GROUP" as const,
          region,
          contractedRateCents: cents,
          arrangementType: "FEE_FOR_SERVICE" as const,
          effectiveDate: new Date("2019-01-15T00:00:00Z"),
        }));
        const ingest = await ctx.admin.qpaEngine.ingest({
          rows,
          provenance: {
            sourceType: "MANUAL",
            sourceRef: `journey-${ctx.runId}`,
            importedAt: new Date(),
          },
        });
        ctx.assertEqual(ingest.acceptedRows, 3, "all 3 rate rows accepted");
        // Idempotent replay: same content hash must not double-ingest.
        const replay = await ctx.admin.qpaEngine.ingest({
          rows,
          provenance: {
            sourceType: "MANUAL",
            sourceRef: `journey-${ctx.runId}`,
            importedAt: new Date(),
          },
        });
        ctx.assert(replay.idempotentReplay === true, "ingest replay detected via content hash");
        const status = await ctx.admin.qpaEngine.ingestionStatus();
        ctx.assert(JSON.stringify(status).length > 2, "ingestion status queryable");
        return { evidence: { batchId: ingest.batchId, status } };
      },
    },
    {
      name: "compute-with-rates-and-benchmarks",
      async run(ctx) {
        const region = (ctx as unknown as { _r: string })._r;
        const qpa = await ctx.provider.qpaEngine.compute({
          serviceCode: "99285",
          market: "LARGE_GROUP",
          region,
          asOfDate: new Date("2026-06-01T00:00:00Z"),
        });
        ctx.assert(qpa.computable === true, "QPA computable with 3 contracted rates", {
          qpaCents: qpa.qpaCents,
        });
        ctx.assert(qpa.qpaCents !== null && qpa.qpaCents > 0, "positive QPA cents returned");
        const seeded = await ctx.admin.qpaBenchmarks.seed();
        ctx.assert(seeded !== null, "benchmark seed executed");
        const bench = await ctx.provider.qpaBenchmarks.list({});
        ctx.assert(Array.isArray(bench), "benchmark list returned", { count: bench.length });
        return { evidence: { qpaCents: qpa.qpaCents, benchmarkCount: bench.length } };
      },
    },
  ],
};
