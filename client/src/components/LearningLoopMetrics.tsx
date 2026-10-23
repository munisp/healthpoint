/**
 * LearningLoopMetrics — Phase 21 (S1 metrics surface). Summary card over
 * `feedback.metrics`: suggestions presented / accepted / edited / rejected
 * per surface with acceptance rates, plus keystroke and fields-changed
 * aggregates. Labeled OPERATIONAL TELEMETRY — these counts describe the
 * suggestion tooling's use, not dispute outcomes. Thin windows show an
 * honest "no suggestion activity" state; null rates render as "—" (never
 * zero-filled).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity } from "lucide-react";

const pct = (rate: number | null) => (rate == null ? "—" : `${Math.round(rate * 1000) / 10}%`);

export default function LearningLoopMetrics({ orgId }: { orgId: string }) {
  const [days, setDays] = useState(30);
  const q = trpc.feedback.metrics.useQuery(
    { orgId, days },
    { enabled: !!orgId, retry: 1 },
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity size={16} className="text-blue-500" />
          Suggestion telemetry
          <Badge variant="outline" className="text-xs">operational telemetry</Badge>
        </CardTitle>
        <div className="flex items-center gap-1">
          {[7, 30, 90].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                days === d ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-xs text-muted-foreground max-w-3xl">
          Acceptance of AI/learned suggestions (prefill, quarantine repair, offer strategy, next
          actions) across this organization. Operational telemetry about the suggestion tooling —
          it does not measure dispute outcomes. Suggestion events store hashes, never field values.
        </p>
        {q.isLoading && <p className="text-muted-foreground">Loading telemetry…</p>}
        {q.isError && <p role="alert" className="text-destructive">{q.error.message}</p>}
        {q.data && (
          <>
            {q.data.bySurface.length === 0 ? (
              <p className="text-muted-foreground">
                No suggestion activity in the last {q.data.windowDays} days — telemetry appears here
                once prefill, quarantine-repair, offer, or next-action suggestions are shown.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b">
                      <th className="py-1 pr-3 font-medium">Surface</th>
                      <th className="py-1 pr-3 font-medium">Model</th>
                      <th className="py-1 pr-3 font-medium text-right">Presented</th>
                      <th className="py-1 pr-3 font-medium text-right">Accepted</th>
                      <th className="py-1 pr-3 font-medium text-right">Edited</th>
                      <th className="py-1 pr-3 font-medium text-right">Rejected</th>
                      <th className="py-1 pr-3 font-medium text-right">Acceptance rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.bySurface.map((r, i) => (
                      <tr key={`${r.surface}-${r.modelName}-${i}`} className="border-b last:border-0">
                        <td className="py-1.5 pr-3 font-medium">{r.surface.replace(/_/g, " ")}</td>
                        <td className="py-1.5 pr-3 text-muted-foreground">{r.modelName}</td>
                        <td className="py-1.5 pr-3 text-right">{r.presented}</td>
                        <td className="py-1.5 pr-3 text-right">{r.accepted}</td>
                        <td className="py-1.5 pr-3 text-right">{r.edited}</td>
                        <td className="py-1.5 pr-3 text-right">{r.rejected}</td>
                        <td className="py-1.5 pr-3 text-right">
                          {pct(r.acceptanceRate)}
                          {r.acceptanceRate == null && (
                            <span className="block text-muted-foreground">no terminal events yet</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="border rounded p-2">
                <p className="text-xs text-muted-foreground">Avg keystrokes per prefilled dispute</p>
                <p className="text-lg font-semibold">
                  {q.data.keystrokesPerDispute.avgKeystrokes == null
                    ? "—"
                    : q.data.keystrokesPerDispute.avgKeystrokes}
                </p>
                {q.data.keystrokesPerDispute.avgKeystrokes == null && (
                  <p className="text-xs text-muted-foreground">no prefilled disputes in window</p>
                )}
              </div>
              <div className="border rounded p-2">
                <p className="text-xs text-muted-foreground">Avg fields changed per prefilled dispute</p>
                <p className="text-lg font-semibold">
                  {q.data.fieldsChangedRatio.avgRatio == null
                    ? "—"
                    : pct(q.data.fieldsChangedRatio.avgRatio)}
                </p>
                {q.data.fieldsChangedRatio.avgRatio == null && (
                  <p className="text-xs text-muted-foreground">no prefilled disputes in window</p>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">source: {q.data.source}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
