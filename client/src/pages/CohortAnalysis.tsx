import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp, TrendingDown, BarChart3, Target } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

export default function CohortAnalysis() {
  const [groupBy, setGroupBy] = useState<"serviceType" | "state" | "month">("serviceType");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data, isLoading } = trpc.dashboard.cohortAnalysis.useQuery({
    groupBy,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  const rows = data?.rows ?? [];
  const avgWinRate = rows.length > 0 ? Math.round(rows.reduce((s, r) => s + r.winRate, 0) / rows.length) : 0;
  const totalDisputes = rows.reduce((s, r) => s + r.total, 0);
  const bestCohort = rows.length > 0 ? rows.reduce((a, b) => a.winRate > b.winRate ? a : b) : null;
  const worstCohort = rows.length > 0 ? rows.reduce((a, b) => a.winRate < b.winRate ? a : b) : null;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Cohort Analysis</h1>
          <p className="text-muted-foreground text-sm mt-1">Outcome trends grouped by service type, state, or time period — sourced from closed disputes with determinations.</p>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-5">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="space-y-1.5">
                <Label>Group By</Label>
                <Select value={groupBy} onValueChange={(v) => setGroupBy(v as typeof groupBy)}>
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="serviceType">Service Type</SelectItem>
                    <SelectItem value="state">Patient State</SelectItem>
                    <SelectItem value="month">Month</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>From</Label>
                <Input type="date" className="w-40" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>To</Label>
                <Input type="date" className="w-40" value={dateTo} onChange={e => setDateTo(e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* KPI summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-5">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Disputes</p>
              <p className="text-2xl font-bold mt-1">{totalDisputes.toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Avg Win Rate</p>
              <p className="text-2xl font-bold mt-1">{avgWinRate}%</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1"><TrendingUp className="h-3 w-3 text-green-500" />Best Cohort</p>
              <p className="text-base font-semibold mt-1 truncate">{bestCohort?.label ?? "—"}</p>
              {bestCohort && <Badge variant="secondary" className="text-xs mt-1">{bestCohort.winRate}% win rate</Badge>}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1"><TrendingDown className="h-3 w-3 text-red-500" />Weakest Cohort</p>
              <p className="text-base font-semibold mt-1 truncate">{worstCohort?.label ?? "—"}</p>
              {worstCohort && <Badge variant="secondary" className="text-xs mt-1">{worstCohort.winRate}% win rate</Badge>}
            </CardContent>
          </Card>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-48"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="pt-10 pb-10 text-center text-muted-foreground">
              <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No closed disputes with determinations found.</p>
              <p className="text-sm mt-1">Cohort analysis requires disputes with a recorded determination winner.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Win Rate chart */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center gap-2"><Target className="h-4 w-4" />Win Rate by {groupBy === "serviceType" ? "Service Type" : groupBy === "state" ? "State" : "Month"}</CardTitle>
              </CardHeader>
              <CardContent>
                <div style={{ height: 300 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={rows} margin={{ top: 5, right: 10, left: 0, bottom: 60 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} />
                      <YAxis tickFormatter={(v) => `${v}%`} domain={[0, 100]} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: number) => [`${v}%`, "Win Rate"]} />
                      <Bar dataKey="winRate" radius={[4, 4, 0, 0]}>
                        {rows.map((r, i) => (
                          <Cell key={i} fill={r.winRate >= 60 ? "#22c55e" : r.winRate >= 40 ? "#f59e0b" : "#ef4444"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Volume chart */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center gap-2"><BarChart3 className="h-4 w-4" />Dispute Volume by {groupBy === "serviceType" ? "Service Type" : groupBy === "state" ? "State" : "Month"}</CardTitle>
              </CardHeader>
              <CardContent>
                <div style={{ height: 300 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={rows} margin={{ top: 5, right: 10, left: 0, bottom: 60 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="wins" name="Provider Wins" fill="#22c55e" stackId="a" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="losses" name="Payer Wins" fill="#ef4444" stackId="a" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Data table */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Detailed Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground text-xs uppercase tracking-wide">
                        <th className="text-left py-2 pr-4">Cohort</th>
                        <th className="text-right py-2 pr-4">Total</th>
                        <th className="text-right py-2 pr-4">Provider Wins</th>
                        <th className="text-right py-2 pr-4">Payer Wins</th>
                        <th className="text-right py-2 pr-4">Win Rate</th>
                        <th className="text-right py-2 pr-4">Avg Determination</th>
                        <th className="text-right py-2">Avg Days to Close</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="py-2 pr-4 font-medium">{r.label}</td>
                          <td className="text-right py-2 pr-4">{r.total}</td>
                          <td className="text-right py-2 pr-4 text-green-600">{r.wins}</td>
                          <td className="text-right py-2 pr-4 text-red-600">{r.losses}</td>
                          <td className="text-right py-2 pr-4">
                            <Badge variant={r.winRate >= 60 ? "default" : r.winRate >= 40 ? "secondary" : "destructive"} className="text-xs">
                              {r.winRate}%
                            </Badge>
                          </td>
                          <td className="text-right py-2 pr-4">${r.avgDetermination.toLocaleString()}</td>
                          <td className="text-right py-2">{r.avgDaysToClose}d</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
