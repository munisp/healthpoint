/**
 * Report tab — three-lane retrospective classification + scorecard header.
 *
 * Scorecard figures come from trpc.practiceAudit.scoreAndSummarize
 * (server-computed). Win probability and projected net recovery are
 * STATISTICAL ESTIMATES (OutcomeNet, trained on SYNTHETIC data) and are
 * labeled as such everywhere they render.
 *
 * Lane assignment is CLIENT-COMPUTED (shared.ts classifyLane) from verdict +
 * initial payment/denial/service dates using the 30-business-day open
 * negotiation rule (45 CFR 149.510(a)(2)(viii)(B)) — the backend does not
 * yet expose a per-claim deadline projection (phase17-ce). Statutory holiday
 * calendars are NOT applied. Every lane surface carries this label.
 *
 * LANE A: QUALIFIES + inside window → actionable now.
 * LANE B: QUALIFIES + window closed → time-barred for IDR; appeal/contract
 *         lane (QPA variance evidence where amounts are present).
 * LANE C: everything else → payer-behavior intelligence aggregates.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { centsToUsd, classifyLane, type Lane, type PracticeClaim } from "./shared";

const LANE_META: Record<Lane, { title: string; badge: string; description: string }> = {
  A: {
    title: "LANE A — Actionable now",
    badge: "bg-green-100 text-green-800 border-green-300",
    description: "QUALIFIES claims whose client-computed 30-business-day negotiation window (45 CFR 149.510(a)(2)(viii)(B)) is still open.",
  },
  B: {
    title: "LANE B — Time-barred for IDR, recoverable",
    badge: "bg-amber-100 text-amber-800 border-amber-300",
    description: "QUALIFIES claims past the IDR initiation window — appeal / contract-enforcement lane. QPA variance evidence shown where amounts exist.",
  },
  C: {
    title: "LANE C — Intelligence",
    badge: "bg-slate-100 text-slate-700 border-slate-300",
    description: "BLOCKED / NEEDS_REVIEW / UNSCORED claims retained for payer-behavior aggregates.",
  },
};

export default function ReportTab({ orgId }: { orgId: string }) {
  const { data: summary, isLoading: summaryLoading } = trpc.practiceAudit.scoreAndSummarize.useQuery({ orgId });
  const claimsQuery = trpc.practiceAudit.listClaims.useQuery({ orgId, limit: 500 });
  const claims = useMemo(() => (claimsQuery.data ?? []) as unknown as PracticeClaim[], [claimsQuery.data]);
  const [winRateOverride, setWinRateOverride] = useState("");
  const sensitivityQuery = trpc.practiceAudit.scoreAndSummarize.useQuery(
    { orgId, winRateOverride: winRateOverride === "" ? undefined : Number(winRateOverride) },
    { enabled: winRateOverride !== "" && !Number.isNaN(Number(winRateOverride)) },
  );

  const lanes = useMemo(() => {
    const grouped: Record<Lane, { claim: PracticeClaim; basis: string; windowRemainingDays: number | null }[]> = { A: [], B: [], C: [] };
    for (const c of claims) {
      const a = classifyLane(c);
      grouped[a.lane].push({ claim: c, basis: a.basis, windowRemainingDays: a.windowRemainingDays });
    }
    return grouped;
  }, [claims]);

  const payerAgg = useMemo(() => {
    const byPayer = new Map<string, { claims: number; gapCents: number; blocked: number; needsReview: number }>();
    for (const c of claims) {
      const key = c.payerName ?? c.payerId ?? "unknown payer";
      const agg = byPayer.get(key) ?? { claims: 0, gapCents: 0, blocked: 0, needsReview: 0 };
      agg.claims++;
      agg.gapCents += Math.max(0, (c.billedCents ?? 0) - (c.allowedCents ?? c.paidCents ?? 0));
      if (c.score?.verdict === "BLOCKED") agg.blocked++;
      if (c.score?.verdict === "NEEDS_REVIEW") agg.needsReview++;
      byPayer.set(key, agg);
    }
    return [...byPayer.entries()].sort((a, b) => b[1].gapCents - a[1].gapCents);
  }, [claims]);

  const completenessDist = useMemo(() => {
    const buckets = [
      { label: "0–24%", min: 0, max: 24, count: 0 },
      { label: "25–49%", min: 25, max: 49, count: 0 },
      { label: "50–74%", min: 50, max: 74, count: 0 },
      { label: "75–99%", min: 75, max: 99, count: 0 },
      { label: "100%", min: 100, max: 100, count: 0 },
    ];
    for (const c of claims) {
      if (!c.score) continue;
      const b = buckets.find(x => c.score!.completenessPct >= x.min && c.score!.completenessPct <= x.max);
      if (b) b.count++;
    }
    return buckets;
  }, [claims]);

  const activeSummary = winRateOverride !== "" && sensitivityQuery.data ? sensitivityQuery.data : summary;

  return (
    <div className="space-y-4 mt-4">
      {/* Scorecard header */}
      <Card>
        <CardHeader><CardTitle className="text-base">Practice scorecard</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {summaryLoading && <p className="text-sm text-muted-foreground">Computing rollup…</p>}
          {activeSummary && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded border p-3">
                  <p className="text-xs text-muted-foreground">Total claims</p>
                  <p className="text-2xl font-semibold">{activeSummary.totalClaims}</p>
                  <p className="text-xs text-muted-foreground">
                    QUALIFIES {activeSummary.verdicts.QUALIFIES} · BLOCKED {activeSummary.verdicts.BLOCKED} ·
                    NEEDS_REVIEW {activeSummary.verdicts.NEEDS_REVIEW} · UNSCORED {activeSummary.verdicts.UNSCORED}
                  </p>
                </div>
                <div className="rounded border p-3">
                  <p className="text-xs text-muted-foreground">Billed − paid/allowed (qualifying)</p>
                  <p className="text-2xl font-semibold">${activeSummary.totalBilledMinusPaidUsd.toLocaleString()}</p>
                </div>
                <div className="rounded border p-3">
                  <p className="text-xs text-muted-foreground">Win probability — statistical estimate</p>
                  <p className="text-2xl font-semibold">
                    {activeSummary.winProbabilityStatisticalEstimate === null
                      ? "n/a"
                      : `${Math.round(activeSummary.winProbabilityStatisticalEstimate * 100)}%`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {activeSummary.winProbabilityStatisticalEstimate === null
                      ? "OutcomeNet service unreachable — honestly null."
                      : "OutcomeNet — trained on synthetic data; NOT a guarantee."}
                  </p>
                </div>
                <div className="rounded border p-3">
                  <p className="text-xs text-muted-foreground">Projected net recovery — statistical estimate</p>
                  <p className="text-2xl font-semibold">
                    {activeSummary.projectedNetRecoveryUsdStatisticalEstimate === null
                      ? "n/a"
                      : `$${activeSummary.projectedNetRecoveryUsdStatisticalEstimate.toLocaleString()}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Net of admin fee (${activeSummary.adminFeeUsd}) + IDRE fee floor (${activeSummary.idreFeeMinUsd}); expected value, not a promise.
                  </p>
                </div>
              </div>

              <div className="rounded border p-3">
                <p className="text-xs font-semibold mb-2">Completeness distribution (scored claims)</p>
                <div className="space-y-1">
                  {completenessDist.map(b => (
                    <div key={b.label} className="flex items-center gap-2 text-xs">
                      <span className="w-16">{b.label}</span>
                      <Progress value={claims.length ? (b.count / claims.length) * 100 : 0} className="h-2 flex-1" />
                      <span className="w-8 text-right">{b.count}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded border p-3 text-xs space-y-1">
                <p className="font-semibold">Model card — {activeSummary.modelCard.name}</p>
                <p>Trained on: {activeSummary.modelCard.trainedOn} data. {activeSummary.modelCard.note}</p>
                <p className="text-amber-700">Nothing on this page is a guarantee of winning an IDR determination.</p>
              </div>

              <div className="flex items-center gap-2 text-xs">
                <label htmlFor="pa-winrate">Sensitivity: override mean win probability (0–1)</label>
                <input
                  id="pa-winrate"
                  className="border rounded px-2 py-1 w-20 bg-background"
                  value={winRateOverride}
                  onChange={e => setWinRateOverride(e.target.value)}
                  placeholder="e.g. 0.6"
                />
                {winRateOverride !== "" && <Badge variant="outline" className="text-amber-700 border-amber-300">sensitivity scenario — not observed data</Badge>}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Lane cards */}
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-amber-700 border-amber-300">
          Lane assignment is client-computed from dates (30-business-day rule; no holiday calendar) — backend deadline projection pending (phase17-ce)
        </Badge>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {(["A", "B", "C"] as Lane[]).map(lane => (
          <Card key={lane}>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Badge variant="outline" className={LANE_META[lane].badge}>{LANE_META[lane].title}</Badge>
                <span className="text-muted-foreground font-normal">({lanes[lane].length})</span>
              </CardTitle>
              <p className="text-xs text-muted-foreground">{LANE_META[lane].description}</p>
            </CardHeader>
            <CardContent className="space-y-2 max-h-96 overflow-y-auto">
              {lane !== "C" && lanes[lane].map(({ claim, basis, windowRemainingDays }) => (
                <div key={claim.id} className="rounded border p-2 text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="font-mono">{claim.claimId ?? claim.id.slice(0, 8)}</span>
                    <span>{centsToUsd(claim.billedCents)}</span>
                  </div>
                  <p className="text-muted-foreground">{basis}</p>
                  {windowRemainingDays !== null && lane === "A" && (
                    <p className="text-green-700">≈{windowRemainingDays} calendar days left in window (client-computed)</p>
                  )}
                  {lane === "B" && claim.allowedCents != null && claim.billedCents != null && (
                    <p className="text-amber-800">
                      QPA-variance evidence: billed {centsToUsd(claim.billedCents)} vs allowed/paid {centsToUsd(claim.allowedCents ?? claim.paidCents)}
                      {" "}(gap {centsToUsd(Math.max(0, claim.billedCents - (claim.allowedCents ?? claim.paidCents ?? 0)))}).
                    </p>
                  )}
                </div>
              ))}
              {lane === "C" && (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="p-1">Payer</th>
                      <th className="p-1">Claims</th>
                      <th className="p-1">Gap</th>
                      <th className="p-1">Blocked</th>
                      <th className="p-1">Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payerAgg.map(([payer, agg]) => (
                      <tr key={payer} className="border-t">
                        <td className="p-1">{payer}</td>
                        <td className="p-1">{agg.claims}</td>
                        <td className="p-1">{centsToUsd(agg.gapCents)}</td>
                        <td className="p-1">{agg.blocked}</td>
                        <td className="p-1">{agg.needsReview}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {lanes[lane].length === 0 && lane !== "C" && (
                <p className="text-xs text-muted-foreground">No claims in this lane.</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
