import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Clock, BarChart3, AlertCircle } from "lucide-react";

interface PayerStat {
  payerName: string;
  totalDisputes: number;
  avgResponseDays: number;
  medianResponseDays: number;
  onTimeRate: number; // % responded within 30 days
  overdueCount: number;
  trend: "improving" | "worsening" | "stable";
}

function TrendBadge({ trend }: { trend: PayerStat["trend"] }) {
  if (trend === "improving") return (
    <div className="flex items-center gap-1 text-green-600 text-xs">
      <TrendingDown size={12} /> Improving
    </div>
  );
  if (trend === "worsening") return (
    <div className="flex items-center gap-1 text-red-600 text-xs">
      <TrendingUp size={12} /> Worsening
    </div>
  );
  return <div className="text-xs text-slate-400">Stable</div>;
}

export default function PayerResponseTimeAnalytics() {
  const { data: allDisputes, isLoading } = trpc.disputes.list.useQuery({ limit: 500 });
  const disputes = (allDisputes?.items ?? []) as any[];

  const payerStats = useMemo<PayerStat[]>(() => {
    const byPayer: Record<string, any[]> = {};
    for (const d of disputes) {
      const payer = d.respondingPartyName ?? "Unknown Payer";
      if (!byPayer[payer]) byPayer[payer] = [];
      byPayer[payer].push(d);
    }

    return Object.entries(byPayer)
      .map(([payerName, ds]) => {
        const responseTimes = ds
          .filter(d => d.createdAt && d.updatedAt)
          .map(d => {
            const created = new Date(d.createdAt).getTime();
            const updated = new Date(d.updatedAt).getTime();
            return Math.round((updated - created) / (1000 * 60 * 60 * 24));
          })
          .filter(t => t >= 0 && t <= 365);

        if (responseTimes.length === 0) return null;

        const sorted = [...responseTimes].sort((a, b) => a - b);
        const avg = Math.round(responseTimes.reduce((s, t) => s + t, 0) / responseTimes.length);
        const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
        const onTimeCount = responseTimes.filter(t => t <= 30).length;
        const onTimeRate = Math.round((onTimeCount / responseTimes.length) * 100);
        const overdueCount = responseTimes.filter(t => t > 30).length;

        // Simulate trend by comparing first half vs second half
        const half = Math.floor(responseTimes.length / 2);
        const firstHalfAvg = half > 0 ? responseTimes.slice(0, half).reduce((s, t) => s + t, 0) / half : avg;
        const secondHalfAvg = half > 0 ? responseTimes.slice(half).reduce((s, t) => s + t, 0) / (responseTimes.length - half) : avg;
        const trend: PayerStat["trend"] =
          secondHalfAvg < firstHalfAvg - 2 ? "improving" :
          secondHalfAvg > firstHalfAvg + 2 ? "worsening" : "stable";

        return { payerName, totalDisputes: ds.length, avgResponseDays: avg, medianResponseDays: median, onTimeRate, overdueCount, trend };
      })
      .filter((s): s is PayerStat => s !== null)
      .sort((a, b) => b.avgResponseDays - a.avgResponseDays);
  }, [disputes]);

  const overallAvg = payerStats.length > 0
    ? Math.round(payerStats.reduce((s, p) => s + p.avgResponseDays, 0) / payerStats.length)
    : 0;
  const worstPayer = payerStats[0];
  const bestPayer = [...payerStats].sort((a, b) => a.avgResponseDays - b.avgResponseDays)[0];

  return (
    <DashboardLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-purple-100">
            <Clock size={20} className="text-purple-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Payer Response Time Analytics</h1>
            <p className="text-sm text-slate-500">Track how quickly each payer responds to IDR disputes</p>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="border-slate-200">
            <CardContent className="pt-4">
              <div className="text-xs text-slate-500 mb-1">Overall Avg Response</div>
              <div className="text-2xl font-bold text-slate-800">{overallAvg}d</div>
              <div className="text-xs text-slate-400">across all payers</div>
            </CardContent>
          </Card>
          <Card className="border-slate-200">
            <CardContent className="pt-4">
              <div className="text-xs text-slate-500 mb-1">Payers Tracked</div>
              <div className="text-2xl font-bold text-slate-800">{payerStats.length}</div>
              <div className="text-xs text-slate-400">unique payers</div>
            </CardContent>
          </Card>
          <Card className="border-green-200 bg-green-50">
            <CardContent className="pt-4">
              <div className="text-xs text-slate-500 mb-1">Fastest Payer</div>
              <div className="text-sm font-bold text-green-700 truncate">{bestPayer?.payerName ?? "—"}</div>
              <div className="text-xs text-green-600">{bestPayer?.avgResponseDays ?? 0}d avg</div>
            </CardContent>
          </Card>
          <Card className="border-red-200 bg-red-50">
            <CardContent className="pt-4">
              <div className="text-xs text-slate-500 mb-1">Slowest Payer</div>
              <div className="text-sm font-bold text-red-700 truncate">{worstPayer?.payerName ?? "—"}</div>
              <div className="text-xs text-red-600">{worstPayer?.avgResponseDays ?? 0}d avg</div>
            </CardContent>
          </Card>
        </div>

        {/* Table */}
        {isLoading ? (
          <Card className="border-slate-200">
            <CardContent className="py-12 text-center text-sm text-slate-400">Loading payer data...</CardContent>
          </Card>
        ) : payerStats.length === 0 ? (
          <Card className="border-slate-200">
            <CardContent className="py-12 text-center">
              <AlertCircle size={24} className="text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-400">No payer response data available</p>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-slate-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <BarChart3 size={14} className="text-purple-500" />
                Payer Response Time Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">Payer</th>
                      <th className="text-center px-3 py-2 text-xs font-semibold text-slate-500">Disputes</th>
                      <th className="text-center px-3 py-2 text-xs font-semibold text-slate-500">Avg Days</th>
                      <th className="text-center px-3 py-2 text-xs font-semibold text-slate-500">Median Days</th>
                      <th className="text-center px-3 py-2 text-xs font-semibold text-slate-500">On-Time Rate</th>
                      <th className="text-center px-3 py-2 text-xs font-semibold text-slate-500">Overdue</th>
                      <th className="text-center px-3 py-2 text-xs font-semibold text-slate-500">Trend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payerStats.map(p => (
                      <tr key={p.payerName} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-medium text-xs text-slate-800 max-w-[180px] truncate">{p.payerName}</div>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className="text-xs text-slate-700">{p.totalDisputes}</span>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className={`text-xs font-semibold ${p.avgResponseDays > 45 ? "text-red-600" : p.avgResponseDays > 30 ? "text-yellow-600" : "text-green-600"}`}>
                            {p.avgResponseDays}d
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className="text-xs text-slate-600">{p.medianResponseDays}d</span>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${p.onTimeRate >= 80 ? "bg-green-400" : p.onTimeRate >= 60 ? "bg-yellow-400" : "bg-red-400"}`}
                                style={{ width: `${p.onTimeRate}%` }}
                              />
                            </div>
                            <span className="text-xs text-slate-600">{p.onTimeRate}%</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-center">
                          {p.overdueCount > 0 ? (
                            <Badge className="text-xs bg-red-100 text-red-700">{p.overdueCount}</Badge>
                          ) : (
                            <span className="text-xs text-slate-400">0</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-center">
                          <TrendBadge trend={p.trend} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
