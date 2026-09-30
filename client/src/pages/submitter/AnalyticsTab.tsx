/**
 * AnalyticsTab — Phase16-FE. Per-client rollup cards (clientAnalytics) and
 * the breakeven calculator (breakevenAnalysis). All figures come straight
 * from the server; null win-rate states are shown honestly ("no determined
 * disputes yet") rather than estimated.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { SubmitterClient } from "./SubmitterConsole";

const usd = (v: number | null | undefined) => (v == null ? "—" : `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

function ClientRollupCard({ client }: { client: SubmitterClient }) {
  const q = trpc.submitter.clientAnalytics.useQuery({ submitterClientId: client.id });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {client.label}
          <Badge variant={client.status === "active" ? "secondary" : "outline"}>{client.status}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {q.isLoading && <p className="text-sm text-muted-foreground">Loading analytics…</p>}
        {q.isError && <p role="alert" className="text-sm text-destructive">{q.error.message}</p>}
        {q.data && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
            <div><p className="text-muted-foreground">Disputes</p><p className="text-lg font-semibold">{q.data.totalDisputes}</p></div>
            <div><p className="text-muted-foreground">Determined</p><p className="text-lg font-semibold">{q.data.determinedDisputes}</p></div>
            <div>
              <p className="text-muted-foreground">Win rate</p>
              <p className="text-lg font-semibold">{q.data.winRate == null ? "—" : `${q.data.winRate}%`}</p>
              {q.data.winRate == null && <p className="text-xs text-muted-foreground">no determined disputes yet</p>}
            </div>
            <div><p className="text-muted-foreground">Avg award (wins)</p><p className="text-lg font-semibold">{usd(q.data.avgAwardUsd)}</p></div>
            <div><p className="text-muted-foreground">Outstanding admin fees</p><p className="text-lg font-semibold">{usd(q.data.outstandingFeesUsd)}</p></div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BreakevenCalculator() {
  const [expectedAward, setExpectedAward] = useState("2500");
  const [batched, setBatched] = useState(false);
  const [lineItemCount, setLineItemCount] = useState("1");
  const [winRateOverride, setWinRateOverride] = useState("");
  const [submitted, setSubmitted] = useState<{ expectedAwardUsd: number; batched: boolean; lineItemCount: number; winRateOverride?: number } | null>(null);

  const q = trpc.submitter.breakevenAnalysis.useQuery(submitted!, { enabled: !!submitted });
  const awardNum = Number(expectedAward);
  const valid = Number.isFinite(awardNum) && awardNum > 0 &&
    (!winRateOverride.trim() || (Number(winRateOverride) >= 0 && Number(winRateOverride) <= 100));

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Breakeven calculator</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <Label htmlFor="be-award">Expected award (USD)</Label>
            <Input id="be-award" className="w-40" inputMode="decimal" value={expectedAward} onChange={e => setExpectedAward(e.target.value)} />
          </div>
          <div className="flex items-center gap-2 pb-1">
            <Checkbox id="be-batched" checked={batched} onCheckedChange={v => setBatched(v === true)} />
            <Label htmlFor="be-batched">Batched dispute</Label>
          </div>
          <div>
            <Label htmlFor="be-lines">Line items</Label>
            <Input id="be-lines" className="w-24" inputMode="numeric" value={lineItemCount} onChange={e => setLineItemCount(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="be-win">Win-rate override % (optional)</Label>
            <Input id="be-win" className="w-32" inputMode="decimal" placeholder="platform rate" value={winRateOverride} onChange={e => setWinRateOverride(e.target.value)} />
          </div>
          <Button size="sm" disabled={!valid || q.isFetching}
            onClick={() => setSubmitted({
              expectedAwardUsd: awardNum,
              batched,
              lineItemCount: Math.max(1, Math.min(50, Math.round(Number(lineItemCount) || 1))),
              winRateOverride: winRateOverride.trim() ? Number(winRateOverride) / 100 : undefined,
            })}>
            Calculate
          </Button>
        </div>

        {q.isFetching && <p className="text-sm text-muted-foreground">Calculating…</p>}
        {q.isError && <p role="alert" className="text-sm text-destructive">{q.error.message}</p>}
        {q.data && !q.isFetching && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <p className="text-muted-foreground">Admin fee (per party)</p>
                <p className="text-lg font-semibold">{usd(q.data.adminFeeUsd)}</p>
                <p className="text-xs text-muted-foreground">source: {q.data.adminFeeSource}</p>
              </div>
              <div>
                <p className="text-muted-foreground">IDRE fee range (at risk when losing)</p>
                <p className="text-lg font-semibold">{usd(q.data.idreFeeRangeUsd.min)} – {usd(q.data.idreFeeRangeUsd.max)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Win rate used</p>
                <p className="text-lg font-semibold">
                  {q.data.winRateUsed == null ? "—" : `${Math.round(q.data.winRateUsed * 1000) / 10}%`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {q.data.winRateUsed == null
                    ? "no determined disputes on platform yet — override above to model"
                    : q.data.platformSampleSize > 0
                      ? `platform rate, n=${q.data.platformSampleSize}`
                      : "override"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Expected net per dispute</p>
                <p className="text-lg font-semibold">{usd(q.data.expectedNetUsd)}</p>
              </div>
            </div>
            <div className="border rounded p-3">
              <p className="text-muted-foreground">Breakeven award (award at which EV = 0)</p>
              <p className="text-xl font-semibold">{usd(q.data.breakevenAwardUsd)}</p>
              {q.data.breakevenAwardUsd == null && (
                <p className="text-xs text-muted-foreground">Cannot compute without a win rate.</p>
              )}
            </div>
            <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-1">
              {q.data.notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
            {q.data.citations.length > 0 && (
              <p className="text-xs text-muted-foreground">Citations: {q.data.citations.join(" · ")}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AnalyticsTab({ clients }: { clients: SubmitterClient[] }) {
  return (
    <div className="space-y-4 pt-4">
      {!clients.length && (
        <p className="text-sm text-muted-foreground">No submitter clients yet — analytics appear once a delegation link exists.</p>
      )}
      {clients.map(c => <ClientRollupCard key={c.id} client={c} />)}
      <BreakevenCalculator />
    </div>
  );
}
