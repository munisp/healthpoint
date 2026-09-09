/**
 * J07–J11: lifecycle-FSM journeys (notice & consent, prior auth, GFE-PPDR,
 * submission automation, portal RPA dry-run).
 */
import type { Journey } from "../framework";
import { JOURNEY_TENANT } from "../framework";
import { expectTrpcError } from "./helpers";

const ALL_NOTICE_ELEMENTS = [
  "OON_PROVIDER_STATEMENT",
  "GFE_GOOD_FAITH_ESTIMATE",
  "PRIOR_AUTHORIZATION_STATEMENT",
  "IN_NETWORK_OPTION_STATEMENT",
  "CONSENT_OPTIONAL_STATEMENT",
  "ITEMS_SERVICES_LIST",
  "COST_SHARING_DISCLAIMER",
  "PLAN_CONTACT_INFO",
];

export const j07: Journey = {
  id: "J07",
  title: "Notice & consent waiver case create → transition with timing/content validation",
  actor: "provider",
  description:
    "noticeConsent.evaluateWaiverEligibility/validateTiming/validateContent + createCase → NOTICE_DELIVERED → CONSENT_SIGNED with retention + event chain verification.",
  steps: [
    {
      name: "validate-waiver-timing-content",
      async run(ctx) {
        const now = Date.now();
        const timing = {
          scheduledAt: new Date(now - 10 * 86400_000),
          serviceAt: new Date(now + 5 * 86400_000),
          noticeDeliveredAt: new Date(now - 1 * 3600_000),
          consentSignedAt: new Date(now - 0.5 * 3600_000),
        };
        (ctx as unknown as { _t: unknown })._t = timing;
        const elig = await ctx.provider.noticeConsent.evaluateWaiverEligibility({
          serviceCategory: "NON_EMERGENCY",
          providerInNetwork: false,
          noInNetworkProviderAvailable: false,
        });
        ctx.assert(elig.waivable === true, "non-emergency OON service is waivable", { elig });
        const badElig = await ctx.provider.noticeConsent.evaluateWaiverEligibility({
          serviceCategory: "EMERGENCY",
        });
        ctx.assert(badElig.waivable === false, "emergency services are non-waivable");
        const t = await ctx.provider.noticeConsent.validateTiming(timing);
        ctx.assert(t.compliant === true, "timing compliant (>=72h notice)", { violations: t.violations });
        const content = await ctx.provider.noticeConsent.validateContent({
          elementsProvided: ALL_NOTICE_ELEMENTS,
        });
        ctx.assert(content.complete === true, "all 8 required notice elements present");
        const partial = await ctx.provider.noticeConsent.validateContent({
          elementsProvided: ALL_NOTICE_ELEMENTS.slice(0, 3),
        });
        ctx.assert(partial.complete === false, "partial content rejected", { missing: partial.missing });
        return { evidence: { compliant: t.compliant } };
      },
    },
    {
      name: "create-case-and-transition",
      async run(ctx) {
        const timing = (ctx as unknown as { _t: never })._t;
        const caseId = ctx.ns("j07-case");
        (ctx as unknown as { _c: string })._c = caseId;
        const created = await ctx.provider.noticeConsent.createCase({
          tenantId: JOURNEY_TENANT,
          caseId,
          waiverInput: {
            serviceCategory: "NON_EMERGENCY",
            providerInNetwork: false,
            noInNetworkProviderAvailable: false,
          },
          timing,
          noticeElements: ALL_NOTICE_ELEMENTS,
          idempotencyKey: ctx.idem("j07-create"),
        });
        ctx.assertEqual(created.state, "NOTICE_REQUIRED", "case created in NOTICE_REQUIRED");
        // Idempotent replay: same key returns without CONFLICT.
        const replay = await ctx.provider.noticeConsent.createCase({
          tenantId: JOURNEY_TENANT,
          caseId,
          waiverInput: {
            serviceCategory: "NON_EMERGENCY",
            providerInNetwork: false,
            noInNetworkProviderAvailable: false,
          },
          timing,
          noticeElements: ALL_NOTICE_ELEMENTS,
          idempotencyKey: ctx.idem("j07-create"),
        });
        ctx.assertEqual(replay.state, "NOTICE_REQUIRED", "idempotent create replay");
        const delivered = await ctx.provider.noticeConsent.transition({
          tenantId: JOURNEY_TENANT, caseId, to: "NOTICE_DELIVERED",
          idempotencyKey: ctx.idem("j07-deliver"),
        });
        ctx.assertEqual(delivered.state, "NOTICE_DELIVERED", "notice delivered");
        const signed = await ctx.provider.noticeConsent.transition({
          tenantId: JOURNEY_TENANT, caseId, to: "CONSENT_SIGNED",
          idempotencyKey: ctx.idem("j07-sign"),
        });
        ctx.assertEqual(signed.state, "CONSENT_SIGNED", "consent signed");
        const caseData = ((signed as { data?: unknown }).data ?? signed) as { retentionUntil: unknown };
        ctx.assert(caseData.retentionUntil !== null, "7-year retention date computed");
        return { evidence: { caseId, state: signed.state } };
      },
    },
    {
      name: "verify-persistence-and-event-chain",
      async run(ctx) {
        const caseId = (ctx as unknown as { _c: string })._c;
        const loaded = await ctx.provider.noticeConsent.getCase({
          tenantId: JOURNEY_TENANT, caseId,
        });
        ctx.assert(loaded !== null, "case reloaded from store");
        const loadedData = ((loaded as unknown as { data?: { state?: string } }).data ?? loaded) as { state: string };
        ctx.assertEqual(loadedData.state, "CONSENT_SIGNED", "state persisted");
        const log = await ctx.provider.noticeConsent.getEvents({
          tenantId: JOURNEY_TENANT, caseId,
        });
        ctx.assert(log.events.length >= 3, "event log has create+2 transitions", {
          events: log.events.length,
        });
        ctx.assert(log.verification.ok === true, "hash-chained event log verifies");
        return { evidence: { state: loadedData.state, events: log.events.length } };
      },
    },
  ],
};

export const j08: Journey = {
  id: "J08",
  title: "Prior-auth request → PAS bundle → deadline clock",
  actor: "provider",
  description:
    "priorAuth.createRequest → DRAFT→SUBMITTED→APPROVED, computeDeadline (CMS-0057-F), buildPasBundle, submitViaPas fail-closed without payer endpoint.",
  steps: [
    {
      name: "create-request-and-deadline",
      async run(ctx) {
        const requestId = ctx.ns("j08-pa");
        (ctx as unknown as { _r: string })._r = requestId;
        const req = await ctx.provider.priorAuth.createRequest({
          tenantId: JOURNEY_TENANT,
          requestId,
          payerType: "MA",
          urgency: "STANDARD",
          idempotencyKey: ctx.idem("j08-create"),
        });
        ctx.assertEqual(req.state, "DRAFT", "PA request created in DRAFT");
        const deadline = await ctx.provider.priorAuth.computeDeadline({
          urgency: "STANDARD",
          payerType: "MA",
          submittedAt: new Date(),
        });
        ctx.assert(deadline !== null, "CMS-0057-F decision deadline computed", {
          deadline: JSON.stringify(deadline).slice(0, 200),
        });
        const urgent = await ctx.provider.priorAuth.computeDeadline({
          urgency: "EXPEDITED",
          payerType: "MA",
          submittedAt: new Date(),
        });
        ctx.assert(
          JSON.stringify(urgent) !== JSON.stringify(deadline),
          "expedited clock differs from standard clock"
        );
        return { evidence: { requestId } };
      },
    },
    {
      name: "submit-and-decide",
      async run(ctx) {
        const requestId = (ctx as unknown as { _r: string })._r;
        const submitted = await ctx.provider.priorAuth.transition({
          tenantId: JOURNEY_TENANT, requestId, to: "SUBMITTED",
          idempotencyKey: ctx.idem("j08-submit"),
        });
        ctx.assertEqual(submitted.state, "SUBMITTED", "submitted");
        const subData = ((submitted as { data?: unknown }).data ?? submitted) as { submittedAt: unknown };
        ctx.assert(subData.submittedAt !== null, "submittedAt stamped");
        // Denied without reason must fail (CMS-0057-F denial-reason guard).
        await expectTrpcError(
          ctx,
          ctx.provider.priorAuth.transition({
            tenantId: JOURNEY_TENANT, requestId, to: "DENIED",
            idempotencyKey: ctx.idem("j08-deny-noreason"),
          }),
          "BAD_REQUEST",
          "denial without reason rejected"
        );
        const approved = await ctx.provider.priorAuth.transition({
          tenantId: JOURNEY_TENANT, requestId, to: "APPROVED",
          idempotencyKey: ctx.idem("j08-approve"),
        });
        ctx.assertEqual(approved.state, "APPROVED", "approved");
        const appData = ((approved as { data?: unknown }).data ?? approved) as { decidedAt: unknown };
        ctx.assert(appData.decidedAt !== null, "decidedAt stamped");
        return { evidence: { state: approved.state } };
      },
    },
    {
      name: "pas-bundle-and-fail-closed-submission",
      async run(ctx) {
        const requestId = (ctx as unknown as { _r: string })._r;
        const bundle = await ctx.provider.priorAuth.buildPasBundle({
          id: requestId, urgency: "STANDARD",
        });
        ctx.assert(
          JSON.stringify(bundle).includes("Bundle") || JSON.stringify(bundle).includes("Claim"),
          "FHIR PAS bundle built"
        );
        const pas = await ctx.provider.priorAuth.submitViaPas({ id: requestId, urgency: "STANDARD" });
        ctx.assertEqual(pas.status, "BLOCKED", "PAS submission blocked without configured payer endpoint (fail-closed)");
        const config = await ctx.provider.priorAuth.getPaConfig();
        ctx.assert(typeof config.endpointConfigured === "boolean", "config exposes booleans only (no endpoint value)");
        const loaded = await ctx.provider.priorAuth.getRequest({ tenantId: JOURNEY_TENANT, requestId });
        const loadedData = ((loaded as unknown as { data?: { state?: string } } | null)?.data ?? loaded) as { state: string } | null;
        ctx.assertEqual(loadedData!.state, "APPROVED", "PA request state persisted");
        const log = await ctx.provider.priorAuth.getEvents({ tenantId: JOURNEY_TENANT, requestId });
        ctx.assert(log.verification.ok === true, "PA event chain verifies");
        return { evidence: { pasStatus: pas.status, state: loadedData!.state } };
      },
    },
  ],
};

export const j09: Journey = {
  id: "J09",
  title: "GFE-PPDR eligibility → dispute create → transition",
  actor: "patient",
  description:
    "gfePpdr.computeDeadline/evaluateEligibility + createDispute → INITIATED (admin fee injected) → UNDER_REVIEW → DETERMINED (patient owes capped at GFE).",
  steps: [
    {
      name: "gfe-deadline-and-eligibility",
      async run(ctx) {
        const now = Date.now();
        const deadline = await ctx.patient.gfePpdr.computeDeadline({
          scheduledAt: new Date(now),
          serviceAt: new Date(now + 10 * 86400_000),
        });
        ctx.assert(deadline.deadline !== undefined, "GFE deadline computed", {
          deadline: JSON.stringify(deadline).slice(0, 160),
        });
        const eligible = await ctx.patient.gfePpdr.evaluateEligibility({
          gfeTotalUsd: 800,
          billedTotalUsd: 1500,
          billedAt: new Date(now - 30 * 86400_000),
          insuranceBilled: false,
        });
        ctx.assert(eligible.eligible === true, "PPDR-eligible ($700 > $400 over GFE, uninsured, <120 days)");
        const ineligible = await ctx.patient.gfePpdr.evaluateEligibility({
          gfeTotalUsd: 800,
          billedTotalUsd: 1000,
          billedAt: new Date(now - 30 * 86400_000),
          insuranceBilled: false,
        });
        ctx.assert(ineligible.eligible === false, "under $400 excess is ineligible");
        const content = await ctx.patient.gfePpdr.validateContent({ elementsProvided: [] });
        ctx.assert(content.complete === false, "empty GFE content incomplete");
        return { evidence: { eligible: eligible.eligible } };
      },
    },
    {
      name: "create-and-transition-ppdr",
      async run(ctx) {
        const disputeId = ctx.ns("j09-ppdr");
        (ctx as unknown as { _d: string })._d = disputeId;
        const created = await ctx.patient.gfePpdr.createDispute({
          tenantId: JOURNEY_TENANT,
          disputeId,
          gfeTotalUsd: 800,
          billedTotalUsd: 1500,
          billedAt: new Date(Date.now() - 30 * 86400_000),
          insuranceBilled: false,
          idempotencyKey: ctx.idem("j09-create"),
        });
        ctx.assertEqual(created.state, "DRAFT", "PPDR dispute created in DRAFT");
        // INITIATED without adminFeeUsd must be rejected (no hardcoded fee).
        await expectTrpcError(
          ctx,
          ctx.patient.gfePpdr.transition({
            tenantId: JOURNEY_TENANT, disputeId, to: "INITIATED",
            idempotencyKey: ctx.idem("j09-init-nofee"),
          }),
          "BAD_REQUEST",
          "INITIATED requires injected adminFeeUsd"
        );
        const initiated = await ctx.patient.gfePpdr.transition({
          tenantId: JOURNEY_TENANT, disputeId, to: "INITIATED", adminFeeUsd: 25,
          idempotencyKey: ctx.idem("j09-init"),
        });
        ctx.assertEqual(initiated.state, "INITIATED", "initiated with $25 admin fee");
        const review = await ctx.patient.gfePpdr.transition({
          tenantId: JOURNEY_TENANT, disputeId, to: "UNDER_REVIEW",
          idempotencyKey: ctx.idem("j09-review"),
        });
        ctx.assertEqual(review.state, "UNDER_REVIEW", "under SDR-entity review");
        return { evidence: { disputeId, state: review.state } };
      },
    },
    {
      name: "determination-capped-and-verified",
      async run(ctx) {
        const disputeId = (ctx as unknown as { _d: string })._d;
        const determined = await ctx.patient.gfePpdr.transition({
          tenantId: JOURNEY_TENANT, disputeId, to: "DETERMINED",
          determination: {
            entityId: "sdr-entity-journey",
            determinedAt: new Date(),
            patientOwesUsd: 800, // at the GFE total (the statutory ceiling)
            rationale: "Billed charges exceed GFE by more than $400",
          },
          idempotencyKey: ctx.idem("j09-determine"),
        });
        ctx.assertEqual(determined.state, "DETERMINED", "determined");
        // The store returns the case row envelope {state, version, data}.
        const caseData = ((determined as { data?: unknown }).data ?? determined) as {
          determination: { patientOwesUsd: number } | null;
        };
        ctx.assert(
          caseData.determination !== null && caseData.determination.patientOwesUsd <= 800,
          "patient owes capped at GFE total (149.620(f))",
          { determination: caseData.determination }
        );
        // Guard: a determination above the GFE total must be rejected. Build a
        // second dispute to UNDER_REVIEW and push an over-cap determination.
        const overId = ctx.ns("j09-ppdr-overcap");
        await ctx.patient.gfePpdr.createDispute({
          tenantId: JOURNEY_TENANT, disputeId: overId,
          gfeTotalUsd: 800, billedTotalUsd: 1500,
          billedAt: new Date(Date.now() - 30 * 86400_000), insuranceBilled: false,
          idempotencyKey: ctx.idem("j09-overcap-create"),
        });
        await ctx.patient.gfePpdr.transition({
          tenantId: JOURNEY_TENANT, disputeId: overId, to: "INITIATED", adminFeeUsd: 25,
          idempotencyKey: ctx.idem("j09-overcap-init"),
        });
        await ctx.patient.gfePpdr.transition({
          tenantId: JOURNEY_TENANT, disputeId: overId, to: "UNDER_REVIEW",
          idempotencyKey: ctx.idem("j09-overcap-review"),
        });
        await expectTrpcError(
          ctx,
          ctx.patient.gfePpdr.transition({
            tenantId: JOURNEY_TENANT, disputeId: overId, to: "DETERMINED",
            determination: {
              entityId: "sdr-entity-journey", determinedAt: new Date(),
              patientOwesUsd: 5000, rationale: "over cap",
            },
            idempotencyKey: ctx.idem("j09-overcap-det"),
          }),
          "BAD_REQUEST",
          "over-cap determination rejected (149.620(f))"
        );
        const loaded = await ctx.patient.gfePpdr.getDispute({ tenantId: JOURNEY_TENANT, disputeId });
        const loadedData = ((loaded as unknown as { data?: { state?: string } } | null)?.data ?? loaded) as { state: string } | null;
        ctx.assertEqual(loadedData!.state, "DETERMINED", "state persisted");
        const log = await ctx.patient.gfePpdr.getEvents({ tenantId: JOURNEY_TENANT, disputeId });
        ctx.assert(log.verification.ok === true, "PPDR event chain verifies");
        return { evidence: { state: loadedData!.state } };
      },
    },
  ],
};

export const j10: Journey = {
  id: "J10",
  title: "Submission automation: package build → submission FSM → eventLog → determination",
  actor: "biller",
  description:
    "submissionAutomation.buildPackage + create + transition DRAFT→PACKAGE_READY→SUBMITTED→ACKNOWLEDGED→IDRE_ASSIGNED→OFFER_SUBMITTED + recordDetermination + hash-chained eventLog.",
  steps: [
    {
      name: "build-package-and-create",
      async run(ctx) {
        const disputeId = ctx.ns("j10-sub");
        (ctx as unknown as { _d: string })._d = disputeId;
        const pkg = await ctx.provider.submissionAutomation.buildPackage({
          initiatingPartyName: "Journey Provider",
          initiatingPartyContactEmail: "provider@journey.test",
          respondingPartyName: "Journey Payer",
          claimNumber: "CLM-J10",
          serviceCode: "99285",
          dateOfService: "2026-08-01",
          billedCharge: 4200,
          qualifyingPaymentAmount: 2600,
          initiatingOffer: 4200,
          openNegotiationInitiationDate: "2026-08-15",
        });
        ctx.assert(pkg !== null, "package built", { pkg: JSON.stringify(pkg).slice(0, 200) });
        const sub = await ctx.provider.submissionAutomation.create({
          tenantId: JOURNEY_TENANT,
          disputeId,
          idempotencyKey: ctx.idem("j10-create"),
        });
        ctx.assertEqual(sub.state, "DRAFT", "submission created in DRAFT");
        // Duplicate active submission for same dispute → CONFLICT.
        await expectTrpcError(
          ctx,
          ctx.provider.submissionAutomation.create({ tenantId: JOURNEY_TENANT, disputeId }),
          "CONFLICT",
          "duplicate active submission rejected"
        );
        return { evidence: { disputeId } };
      },
    },
    {
      name: "fsm-advance-to-offer-submitted",
      async run(ctx) {
        const disputeId = (ctx as unknown as { _d: string })._d;
        const ready = await ctx.provider.submissionAutomation.transition({
          tenantId: JOURNEY_TENANT, disputeId, to: "PACKAGE_READY",
          idempotencyKey: ctx.idem("j10-ready"),
        });
        ctx.assertEqual(ready.state, "PACKAGE_READY", "package ready");
        const submitted = await ctx.provider.submissionAutomation.transition({
          tenantId: JOURNEY_TENANT, disputeId, to: "SUBMITTED",
          idempotencyKey: ctx.idem("j10-submit"),
        });
        ctx.assertEqual(submitted.state, "SUBMITTED", "submitted (attestation auto-applied)");
        // ACKNOWLEDGED without a CMS-format reference must fail closed.
        await expectTrpcError(
          ctx,
          ctx.provider.submissionAutomation.transition({
            tenantId: JOURNEY_TENANT, disputeId, to: "ACKNOWLEDGED",
            cmsDisputeReferenceNumber: "not a valid ref!",
            idempotencyKey: ctx.idem("j10-ack-bad"),
          }),
          "BAD_REQUEST",
          "bad CMS reference rejected"
        );
        const acked = await ctx.provider.submissionAutomation.transition({
          tenantId: JOURNEY_TENANT, disputeId, to: "ACKNOWLEDGED",
          cmsDisputeReferenceNumber: `CMS-${ctx.runId.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 20)}`,
          idempotencyKey: ctx.idem("j10-ack"),
        });
        ctx.assertEqual(acked.state, "ACKNOWLEDGED", "acknowledged with valid CMS ref");
        const assigned = await ctx.provider.submissionAutomation.transition({
          tenantId: JOURNEY_TENANT, disputeId, to: "IDRE_ASSIGNED",
          idempotencyKey: ctx.idem("j10-assign"),
        });
        ctx.assertEqual(assigned.state, "IDRE_ASSIGNED", "IDRE assigned");
        const offered = await ctx.provider.submissionAutomation.transition({
          tenantId: JOURNEY_TENANT, disputeId, to: "OFFER_SUBMITTED",
          idempotencyKey: ctx.idem("j10-offer"),
        });
        ctx.assertEqual(offered.state, "OFFER_SUBMITTED", "offer submitted");
        return { evidence: { state: offered.state } };
      },
    },
    {
      name: "record-determination-and-verify-log",
      async run(ctx) {
        const disputeId = (ctx as unknown as { _d: string })._d;
        const det = await ctx.provider.submissionAutomation.recordDetermination({
          tenantId: JOURNEY_TENANT,
          disputeId,
          determination: {
            idreId: "idre-journey",
            determinationDate: "2026-09-05",
            prevailingParty: "initiating",
            prevailingOffer: 4200,
            qpa: 2600,
            otherOffer: 2400,
            rationaleFactors: ["QPA proximity", "provider training"],
            adminFeeAmount: 50,
            idreFeeAmount: 400,
          },
          idempotencyKey: ctx.idem("j10-det"),
        });
        ctx.assert(det !== null, "determination recorded", { det: JSON.stringify(det).slice(0, 200) });
        const log = await ctx.provider.submissionAutomation.eventLog({
          tenantId: JOURNEY_TENANT, disputeId,
        });
        ctx.assert(log.events.length >= 6, "event log covers all transitions", {
          events: log.events.length,
        });
        ctx.assert(log.verification.ok === true, "submission event chain verifies");
        const states = log.events.map((e: { to?: string; toState?: string }) => e.to ?? e.toState);
        ctx.assert(states.includes("DETERMINATION_RECEIVED"), "auto-transition to DETERMINATION_RECEIVED logged");
        return { evidence: { events: log.events.length } };
      },
    },
  ],
};

export const j11: Journey = {
  id: "J11",
  title: "Portal RPA dry-run → checkpoint → resolve → resume (fail-closed sandbox)",
  actor: "biller",
  description:
    "portalRpa.startRun (DRY_RUN) with unresolvable credentialsRef fails closed with evidence; portalMapInfo metadata; listCheckpoints; resolveCheckpoint on unknown id rejected; getRun re-reads persisted run.",
  steps: [
    {
      name: "portal-map-metadata",
      async run(ctx) {
        const info = await ctx.admin.portalRpa.portalMapInfo();
        ctx.assert(info.loaded === true, "portal map loaded");
        ctx.assert(typeof info.version === "string" && info.version.length > 0, "map versioned");
        ctx.assert(info.stepCount > 0, "map has steps", { stepCount: info.stepCount });
        return { evidence: { version: info.version, stepCount: info.stepCount } };
      },
    },
    {
      name: "dry-run-fails-closed-without-credentials",
      async run(ctx) {
        const submissionId = ctx.ns("j11-rpa");
        (ctx as unknown as { _s: string })._s = submissionId;
        const run = await ctx.provider.portalRpa.startRun({
          submissionId,
          portalFields: { initiatingPartyName: "Journey Provider" },
          credentialsRef: `env:${ctx.ns("j11-nonexistent-cred")}`,
          mode: "DRY_RUN",
        });
        ctx.assert(run.runId.length > 0, "run id returned");
        // No portal credentials configured in the sandbox → credential
        // resolution must fail closed (never fabricate a portal session).
        ctx.assert(
          run.status === "FAILED" || run.status === "CHECKPOINT_REQUIRED" || run.status === "BLOCKED",
          "run fails closed without credentials/portal",
          { status: run.status }
        );
        ctx.assert(run.timeline.length > 0, "run timeline recorded");
        (ctx as unknown as { _run: string })._run = run.runId;
        return { evidence: { runId: run.runId, status: run.status } };
      },
    },
    {
      name: "checkpoint-queue-and-verify-persistence",
      async run(ctx) {
        const submissionId = (ctx as unknown as { _s: string })._s;
        const runId = (ctx as unknown as { _run: string })._run;
        const checkpoints = await ctx.provider.portalRpa.listCheckpoints();
        ctx.assert(Array.isArray(checkpoints), "checkpoint queue listed", { count: checkpoints.length });
        // Resolving an unknown checkpoint must be rejected (no forged resume).
        await expectTrpcError(
          ctx,
          ctx.provider.portalRpa.resolveCheckpoint({
            submissionId,
            portalFields: {},
            credentialsRef: `env:${ctx.ns("j11-nonexistent-cred")}`,
            checkpointId: ctx.ns("j11-unknown-checkpoint"),
            humanCompleted: true,
          }),
          "BAD_REQUEST",
          "unknown checkpoint resolution rejected"
        );
        const reread = await ctx.provider.portalRpa.getRun({ runId });
        ctx.assertEqual(reread.runId, runId, "run persisted and re-readable");
        ctx.assertEqual(reread.submissionId, submissionId, "run linked to submission");
        return { evidence: { runId, status: reread.status } };
      },
    },
  ],
};
