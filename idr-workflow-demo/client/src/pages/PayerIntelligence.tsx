import { useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { Building2, TrendingUp, TrendingDown, DollarSign, Scale, Clock, AlertTriangle } from "lucide-react";

const COLORS = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2"];

interface PayerStat {
  payerName: string;
  totalDisputes: number;
  wonDisputes: number;
  totalBilled: number;
  totalDetermination: number;
  avgDaysToClose: number;
  winRate: number;
  recoveryRate: number;
}

export default function PayerIntelligence() {
  const { data: disputes, isLoading } = trpc.disputes.list.useQuery({
    limit: 1000,
    offset: 0,
  });

  const payerStats = useMemo((): PayerStat[] => {
    if (!disputes) return [];
    const items = (disputes as { items: { id: string; payerName?: string; billedAmount?: string | null; determinationAmount?: string | null; status: string; createdAt?: Date | null; updatedAt?: Date | null }[] }).items ?? [];

    const map: Record<string, PayerStat> = {};

    for (const d of items) {
      const payer = (d as { payerName?: string }).payerName ?? "Unknown Payer";
      if (!map[payer]) {
        map[payer] = {
          payerName: payer,
          totalDisputes: 0,
          wonDisputes: 0,
          totalBilled: 0,
          totalDetermination: 0,
          avgDaysToClose: 0,
          winRate: 0,
          recoveryRate: 0,
        };
      }
      const stat = map[payer];
      stat.totalDisputes++;
      stat.totalBilled += Number(d.billedAmount ?? 0);
      stat.totalDetermination += Number(d.determinationAmount ?? 0);

      if (d.status === "closed") {
        const billed = Number(d.billedAmount ?? 0);
        const det = Number(d.determinationAmount ?? 0);
        if (det >= billed * 0.8) stat.wonDisputes++;
        const ms = (d.updatedAt ? new Date(d.updatedAt).getTime() : Date.now()) - (d.createdAt ? new Date(d.createdAt).getTime() : Date.now());
        stat.avgDaysToClose += ms / 86400000;
      }
    }

    return Object.values(map)
      .map(stat => {
        const closed = items.filter((d: { payerName?: string; status?: string }) => d.payerName === stat.payerName && d.status === "closed").length;
        return {
          ...stat,
          winRate: closed > 0 ? Math.round((stat.wonDisputes / closed) * 100) : 0,
          recoveryRate: stat.totalBilled > 0 ? Math.round((stat.totalDetermination / stat.totalBilled) * 100) : 0,
          avgDaysToClose: closed > 0 ? Math.round(stat.avgDaysToClose / closed) : 0,
        };
      })
      .sort((a, b) => b.totalDisputes - a.totalDisputes)
      .slice(0, 10);
  }, [disputes]);

  const topPayers = payerStats.slice(0, 6);

  const pieData = topPayers.map(p => ({
    name: p.payerName.length > 20 ? p.payerName.slice(0, 18) + "…" : p.payerName,
    value: p.totalDisputes,
  }));

  const totalDisputes = payerStats.reduce((s, p) => s + p.totalDisputes, 0);
  const totalBilled = payerStats.reduce((s, p) => s + p.totalBilled, 0);
  const avgWinRate = payerStats.length > 0
    ? Math.round(payerStats.reduce((s, p) => s + p.winRate, 0) / payerStats.length)
    : 0;

  return (
    <DashboardLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Building2 className="h-6 w-6 text-primary" />
              Payer Intelligence
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Per-payer dispute analytics — win rates, recovery rates, and dispute volumes
            </p>
          </div>
          <Badge variant="secondary">{payerStats.length} payers tracked</Badge>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Disputes", value: totalDisputes, icon: Scale, color: "text-blue-500" },
            { label: "Total Billed", value: `$${(totalBilled / 1000).toFixed(0)}K`, icon: DollarSign, color: "text-green-500" },
            { label: "Avg Win Rate", value: `${avgWinRate}%`, icon: TrendingUp, color: "text-purple-500" },
            { label: "Payers Tracked", value: payerStats.length, icon: Building2, color: "text-orange-500" },
          ].map(kpi => {
            const Icon = kpi.icon;
            return (
              <Card key={kpi.label}>
                <CardContent className="py-4 flex items-center gap-3">
                  <div className={`p-2 rounded-lg bg-muted ${kpi.color}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xl font-bold">{kpi.value}</p>
                    <p className="text-xs text-muted-foreground">{kpi.label}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Disputes by Payer Bar Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Disputes by Payer</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="h-64 flex items-center justify-center text-muted-foreground">Loading...</div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={topPayers} layout="vertical" margin={{ left: 16, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis
                      type="category"
                      dataKey="payerName"
                      width={120}
                      tick={{ fontSize: 10 }}
                      tickFormatter={v => v.length > 16 ? v.slice(0, 14) + "…" : v}
                    />
                    <Tooltip formatter={(v: number) => [v, "Disputes"]} />
                    <Bar dataKey="totalDisputes" fill="#2563eb" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Dispute Distribution Pie */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Dispute Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="h-64 flex items-center justify-center text-muted-foreground">Loading...</div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => [v, "Disputes"]} />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Win Rate by Payer */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Win Rate by Payer</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground">Loading...</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={topPayers}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="payerName" tick={{ fontSize: 10 }} tickFormatter={v => v.length > 12 ? v.slice(0, 10) + "…" : v} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
                  <Tooltip formatter={(v: number) => [`${v}%`, "Win Rate"]} />
                  <Bar dataKey="winRate" fill="#16a34a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Payer Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Payer Scorecard</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="py-8 text-center text-muted-foreground">Loading payer data...</div>
            ) : payerStats.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                <Building2 className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p>No dispute data available yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground text-xs">
                      <th className="text-left py-2 pr-4 font-medium">Payer</th>
                      <th className="text-right py-2 px-3 font-medium">Disputes</th>
                      <th className="text-right py-2 px-3 font-medium">Win Rate</th>
                      <th className="text-right py-2 px-3 font-medium">Recovery Rate</th>
                      <th className="text-right py-2 px-3 font-medium">Avg Days</th>
                      <th className="text-right py-2 pl-3 font-medium">Total Billed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payerStats.map(stat => (
                      <tr key={stat.payerName} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="py-3 pr-4 font-medium">{stat.payerName}</td>
                        <td className="py-3 px-3 text-right">{stat.totalDisputes}</td>
                        <td className="py-3 px-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Progress value={stat.winRate} className="w-16 h-1.5" />
                            <span className={stat.winRate >= 60 ? "text-green-600" : stat.winRate >= 40 ? "text-yellow-600" : "text-red-600"}>
                              {stat.winRate}%
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <span className={stat.recoveryRate >= 70 ? "text-green-600" : "text-muted-foreground"}>
                            {stat.recoveryRate}%
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <span className="flex items-center justify-end gap-1">
                            <Clock className="h-3 w-3 text-muted-foreground" />
                            {stat.avgDaysToClose}d
                          </span>
                        </td>
                        <td className="py-3 pl-3 text-right font-mono text-xs">
                          ${stat.totalBilled.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
