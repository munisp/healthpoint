/**
 * J27: practice audit lifecycle (Phase 17, E1/E3/E5/E6).
 *
 *  Seed a practice's claims via an 837P fixture AND a FHIR bulk $export
 *  ndjson fixture → deterministic eligibility scoring → assert verdicts,
 *  CFR citations, missingFields behavior, and rollup numbers.
 *
 * Honesty: verdicts are deterministic eligibility rules (QUALIFIES /
 * BLOCKED / NEEDS_REVIEW) with CFR citations — never an assurance of
 * winning IDR. The rollup's win probability is a statistical estimate
 * (OutcomeNet, synthetic training data) and may be null when the model
 * service is unavailable; both states are asserted honest.
 *
 * Fixture dates are relative to run time so the §149.510(b)(2)(i) initiation
 * window is always in-window (DOS ~15d ago, initial payment ~5d ago).
 * The field-completion step updates staged rows via raw SQL (fixture seeding,
 * like other journeys' ctx.sql setup) — scoring itself goes through the real
 * practiceAudit.scoreClaims tRPC path.
 */
import type { Journey } from "../framework";

function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
}
function compact(d: string): string {
  return d.replace(/-/g, "");
}

function fixture837(dos: string): string {
  return [
    "ISA*00*          *00*          *ZZ*SUBMITTER      *ZZ*CLEARINGHOUSE  *260905*1200*^*00501*000000905*1*T*:~",
    "GS*HC*SUBMITTER*CLEARINGHOUSE*20260905*1200*1*X*005010X222A1~",
    "ST*837*0001*005010X222A1~",
    "NM1*41*2*JOURNEY BILLING*****XX*1234567893~",
    "NM1*85*2*JOURNEY MEDICAL GROUP*****XX*1234567893~",
    "N3*100 MAIN ST~",
    "N4*ALBUQUERQUE*NM*87101~",
    "REF*EI*461234567~",
    "NM1*QC*1*DOE*JANE~",
    "N3*22 PATIENT LN~",
    "N4*ALBUQUERQUE*NM*87102~",
    "NM1*PR*2*AETNA HEALTH*****PI*60054~",
    "CLM*J27-837-001*4200***23:B:1*Y*A*Y*Y~",
    "HI*ABK:R07.9~",
    "LX*1~",
    "SV1*HC:99285*4200*UN*1*23**1~",
    `DTP*472*D8*${compact(dos)}~`,
    "SE*20*0001~",
    "GE*1*1~",
    "IEA*1*000000905~",
  ].join("\n");
}

function fixtureNdjson(dos: string, paymentDate: string): string {
  const patient = { resourceType: "Patient", id: "j27-pat", address: [{ state: "NM" }] };
  const coverage = { resourceType: "Coverage", id: "j27-cov", class: [{ type: { coding: [{ code: "group" }] }, value: "GRP-27" }] };
  const org = { resourceType: "Organization", id: "j27-payer", name: "AETNA HEALTH", identifier: [{ value: "60054" }] };
  const prac = { resourceType: "Practitioner", id: "j27-prac", identifier: [{ system: "http://hl7.org/fhir/sid/us-npi", value: "1234567893" }] };
  const claim = {
    resourceType: "Claim", id: "j27-clm", identifier: [{ value: "J27-FHIR-001" }],
    patient: { reference: "Patient/j27-pat" },
    billablePeriod: { start: dos, end: dos },
    insurer: { reference: "Organization/j27-payer", display: "AETNA HEALTH" },
    provider: { reference: "Practitioner/j27-prac" },
    insurance: [{ sequence: 1, focal: true, coverage: { reference: "Coverage/j27-cov" } }],
    diagnosis: [{ sequence: 1, diagnosisCodeableConcept: { coding: [{ system: "http://hl7.org/fhir/sid/icd-10-cm", code: "R07.9" }] } }],
    item: [{ sequence: 1, productOrService: { coding: [{ system: "http://www.ama-assn.org/go/cpt", code: "99284" }] }, servicedDate: dos }],
    total: { value: 3100.0, currency: "USD" },
  };
  const eob = {
    resourceType: "ExplanationOfBenefit", id: "j27-eob",
    patient: { reference: "Patient/j27-pat" },
    claim: { reference: "Claim/j27-clm" },
    insurer: { reference: "Organization/j27-payer" },
    outcome: "complete",
    payment: { date: paymentDate, amount: { value: 800.0, currency: "USD" } },
    total: [
      { category: { coding: [{ code: "submitted" }] }, amount: { value: 3100.0 } },
      { category: { coding: [{ code: "payment" }] }, amount: { value: 800.0 } },
    ],
  };
  return [patient, coverage, org, prac, claim, eob].map(r => JSON.stringify(r)).join("\n");
}

export const j27: Journey = {
  id: "J27",
  title: "Practice audit lifecycle: 837 + FHIR bulk → stage → score → rollup",
  actor: "provider",
  description:
    "A practice org ingests claims from an X12 837P file and a FHIR bulk $export ndjson (idempotent by content hash), scores them with the deterministic eligibility engine (verdicts + CFR citations + missingFields), completes eligibility-critical fields, rescores to QUALIFIES, and reads the per-practice rollup with honestly-labeled statistical estimates.",
  steps: [
    {
      name: "ingest-837",
      async run(ctx) {
        const org = await ctx.provider.orgs.create({ name: `Journey Practice ${ctx.ns("j27")}`, type: "provider" });
        (ctx as unknown as { _org: string })._org = org.orgId;
        const dos = isoDaysAgo(15);
        const res = await ctx.provider.practiceAudit.ingest837({ orgId: org.orgId, fileName: "j27.837", content: fixture837(dos) });
        ctx.assertEqual(res.parsedClaims, 1, "837 fixture parses to one claim");
        ctx.assertEqual(res.inserted, 1, "837 claim staged");
        // Idempotency: replaying the same file is a no-op.
        const replay = await ctx.provider.practiceAudit.ingest837({ orgId: org.orgId, fileName: "j27.837", content: fixture837(dos) });
        ctx.assertEqual(replay.inserted, 0, "837 replay inserts nothing");
        ctx.assertEqual(replay.skippedDuplicates, 1, "837 replay counted as duplicate");
        return { evidence: { orgId: org.orgId, inserted: res.inserted } };
      },
    },
    {
      name: "ingest-fhir-bulk",
      async run(ctx) {
        const orgId = (ctx as unknown as { _org: string })._org;
        const res = await ctx.provider.practiceAudit.ingestBulkNdjson({
          orgId,
          sourceRef: "j27-bulk-export",
          ndjson: fixtureNdjson(isoDaysAgo(15), isoDaysAgo(5)),
        });
        ctx.assertEqual(res.stats.claims, 1, "one FHIR Claim normalized");
        ctx.assertEqual(res.stats.eobsJoined, 1, "EOB joined to claim");
        ctx.assertEqual(res.inserted, 1, "FHIR claim staged");
        return { evidence: { stats: res.stats } };
      },
    },
    {
      name: "score-incomplete-claims-needs-review",
      async run(ctx) {
        const orgId = (ctx as unknown as { _org: string })._org;
        const res = await ctx.provider.practiceAudit.scoreClaims({ orgId });
        ctx.assertEqual(res.scored, 2, "both staged claims scored");
        for (const r of res.results) {
          // 837 and FHIR both lack planType/networkStatus (E6 honest nulls).
          ctx.assertEqual(r.verdict, "NEEDS_REVIEW", "incomplete claims are NEEDS_REVIEW, never QUALIFIES");
          ctx.assert(r.missingFields.includes("planType"), "planType flagged missing", { missing: r.missingFields });
          ctx.assert(r.missingFields.includes("networkStatus"), "networkStatus flagged missing");
        }
        const claims = await ctx.provider.practiceAudit.listClaims({ orgId });
        const withScore = claims.filter(c => c.score);
        ctx.assertEqual(withScore.length, 2, "scores persisted on claims");
        const rule = withScore[0].score!.rulesFired.find(f => f.rule === "field_completeness");
        ctx.assert(rule && rule.citation.includes("45 CFR"), "rulesFired carry CFR citations");
        return { evidence: { verdicts: res.results.map(r => r.verdict) } };
      },
    },
    {
      name: "complete-fields-rescore-qualifies",
      async run(ctx) {
        const orgId = (ctx as unknown as { _org: string })._org;
        // Fixture completion of eligibility-critical fields (manual-entry
        // simulation): plan type, network status, service category,
        // notice/consent status, NM (federal-path state) and a fresh
        // initial-payment date (in-window).
        const ipd = isoDaysAgo(5);
        await ctx.sql`
          UPDATE practice_claims
          SET "planType" = 'SELF_FUNDED',
              "serviceCategory" = 'EMERGENCY',
              "networkStatus" = 'out_of_network',
              "noticeConsentStatus" = 'none',
              "facilityState" = 'NM',
              "patientState" = 'NM',
              "initialPaymentDate" = ${ipd},
              "sourceProvenance" = "sourceProvenance" || '{"planType":{"source":"manual"},"networkStatus":{"source":"manual"}}'::jsonb
          WHERE "orgId" = ${orgId}
        `;
        const res = await ctx.provider.practiceAudit.scoreClaims({ orgId });
        ctx.assertEqual(res.scored, 2, "rescored both claims");
        for (const r of res.results) {
          ctx.assertEqual(r.verdict, "QUALIFIES", "completed claims QUALIFY (deterministic rules)");
          ctx.assertEqual(r.jurisdiction, "FEDERAL", "NM self-funded → FEDERAL jurisdiction");
        }
        const claims = await ctx.provider.practiceAudit.listClaims({ orgId });
        const scored = claims.filter(c => c.score);
        const jRule = scored[0].score!.rulesFired.find(f => f.rule === "jurisdiction");
        ctx.assert(jRule?.citation.includes("149.140"), "jurisdiction rule cites 45 CFR 149.140");
        const wRule = scored[0].score!.rulesFired.find(f => f.rule === "idr_initiation_window");
        ctx.assert(wRule?.citation.includes("149.510(b)(2)(i)"), "initiation window rule cites §149.510(b)(2)(i)");
        return { evidence: { ipd } };
      },
    },
    {
      name: "rollup-honest-estimates",
      async run(ctx) {
        const orgId = (ctx as unknown as { _org: string })._org;
        const sum = await ctx.provider.practiceAudit.scoreAndSummarize({ orgId });
        ctx.assertEqual(sum.totalClaims, 2, "rollup covers both claims");
        ctx.assertEqual(sum.verdicts.QUALIFIES, 2, "both QUALIFIES in rollup");
        ctx.assertEqual(sum.qualifyingClaims, 2, "qualifying claim count");
        // 420000 - 0 paid (837 has no EOB) + 310000 - 80000 = 650000 cents.
        ctx.assertEqual(sum.totalBilledMinusPaidUsd, 6500, "gap dollars = billed - allowed/paid");
        ctx.assertEqual(sum.modelCard.trainedOn, "synthetic", "OutcomeNet model card honestly labels synthetic training data");
        ctx.assert(
          sum.winProbabilityStatisticalEstimate === null ||
            (typeof sum.winProbabilityStatisticalEstimate === "number" &&
              sum.winProbabilityStatisticalEstimate >= 0 &&
              sum.winProbabilityStatisticalEstimate <= 1),
          "win probability is null (model service down) or a [0,1] statistical estimate",
          { p: sum.winProbabilityStatisticalEstimate }
        );
        ctx.assert(sum.verdictSemantics.includes("ELIGIBILITY"), "rollup restates verdict semantics (eligibility, not outcome assurance)");
        return {
          evidence: {
            verdicts: sum.verdicts,
            winProbabilityStatisticalEstimate: sum.winProbabilityStatisticalEstimate,
            projectedNetRecoveryUsdStatisticalEstimate: sum.projectedNetRecoveryUsdStatisticalEstimate,
          },
        };
      },
    },
  ],
};
