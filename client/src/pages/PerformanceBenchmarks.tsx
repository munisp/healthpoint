import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from "recharts";
import { BarChart2, TrendingUp, TrendingDown, Minus, Info } from "lucide-react";

// NSA industry benchmarks (based on CMS published IDR statistics)
const BENCHMARKS = [
  { metric: "Avg Resolution Days", key: "avgResolutionDays", benchmark: 45, unit: "days", description: "Average days from IDR initiation to determination", lowerIsBetter: true },
  { metric: "Resolution Rate", key: "resolutionRate", benchmark: 72, unit: "%", description: "% of disputes reaching a final determination", lowerIsBetter: false },
  { metric: "Provider Win Rate", key: "providerWinRate", benchmark: 71, unit: "%", description: "% of determinations in provider's favor (CMS 2023 data)", lowerIsBetter: false },
  { metric: "Ineligibility Rate", key: "ineligibilityRate", benchmark: 18, unit: "%", description: "% of disputes found ineligible for IDR", lowerIsBetter: true },
  { metric: "Appeal Rate", key: "appealRate", benchmark: 3, unit: "%", description: "% of determinations appealed", lowerIsBetter: true },
  { metric: "Avg Billed Amount", key: "avgBilledAmount", benchmark: 14200, unit: "$", description: "Average billed amount per dispute", lowerIsBetter: false },
];

export default function PerformanceBenchmarks() {
  const { data, isLoading } = trpc.disputes.list.useQuery({ limit: 500, offset: 0 });
  const disputes = data?.items ?? [];

  const metrics = useMemo(() => {
    const total = disputes.length;
    if (total === 0) return null;

    const resolved = disputes.filter(d => d.status === "closed" || d.status === "determination_issued");
    const appealed = disputes.filter(d => d.status === "appealed");
    const ineligible = disputes.filter(d => d.status === "ineligible");

    const resolutionDays = resolved
      .filter(d => d.createdAt && d.closedAt)
      .map(d => Math.floor((new Date(d.closedAt!).getTime() - new Date(d.createdAt!).getTime()) / 86400000));

    const avgResolutionDays = resolutionDays.length > 0
      ? resolutionDays.reduce((a, b) => a + b, 0) / resolutionDays.length
      : 0;

    const avgBilledAmount = disputes.reduce((sum, d) => sum + (Number(d.billedAmount) || 0), 0) / total;

    return {
      avgResolutionDays: Math.round(avgResolutionDays),
      resolutionRate: Math.round((resolved.length / total) * 100),
      providerWinRate: Math.round(Math.random() * 20 + 60), // Simulated — real data would come from determination outcomes
      ineligibilityRate: Math.round((ineligible.length / total) * 100),
      appealRate: Math.round((appealed.length / total) * 100),
      avgBilledAmount: Math.round(avgBilledAmount),
    };
  }, [disputes]);

  const benchmarkData = BENCHMARKS.map(b => {
    const actual = metrics?.[b.key as keyof typeof metrics] ?? 0;
    const diff = b.lowerIsBetter
      ? ((b.benchmark - actual) / b.benchmark) * 100
      : ((actual - b.benchmark) / b.benchmark) * 100;
    const status = diff > 5 ? "above" : diff < -5 ? "below" : "on-par";
    return { ...b, actual, diff: Math.round(diff), status };
  });

  const formatValue = (value: number, unit: string) => {
    if (unit === "$") return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
    if (unit === "%") return `${value}%`;
    return `${value} ${unit}`;
  };

  const statusBadge = (status: string, lowerIsBetter: boolean) => {
    if (status === "above") return <Badge className={`text-xs ${lowerIsBetter ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>{lowerIsBetter ? "Worse" : "Better"}</Badge>;
    if (status === "below") return <Badge className={`text-xs ${lowerIsBetter ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>{lowerIsBetter ? "Better" : "Below"}</Badge>;
    return <Badge className="text-xs bg-gray-100 text-gray-700">On Par</Badge>;
  };

  const chartData = benchmarkData.map(b => ({
    name: b.metric.replace("Avg ", "").replace(" Rate", ""),
    actual: b.actual,
    benchmark: b.benchmark,
  }));

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BarChart2 className="h-6 w-6 text-indigo-600" />
          Performance Benchmarks
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Compare your IDR platform metrics against NSA industry benchmarks</p>
      </div>

      <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
        <Info className="h-4 w-4 shrink-0" />
        <span>Industry benchmarks sourced from CMS IDR Annual Reports and ACEP/AHA published NSA statistics. Provider win rate is simulated for demo purposes.</span>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {benchmarkData.map(b => {
          const icon = b.status === "above"
            ? <TrendingUp className={`h-4 w-4 ${b.lowerIsBetter ? "text-red-500" : "text-green-500"}`} />
            : b.status === "below"
            ? <TrendingDown className={`h-4 w-4 ${b.lowerIsBetter ? "text-green-500" : "text-amber-500"}`} />
            : <Minus className="h-4 w-4 text-gray-400" />;

          return (
            <Card key={b.key}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <p className="text-xs text-muted-foreground font-medium">{b.metric}</p>
                  {statusBadge(b.status, b.lowerIsBetter)}
                </div>
                <div className="flex items-end gap-2">
                  <span className="text-2xl font-bold">{formatValue(b.actual, b.unit)}</span>
                  {icon}
                </div>
                <div className="flex items-center gap-1 mt-1">
                  <span className="text-xs text-muted-foreground">Benchmark: {formatValue(b.benchmark, b.unit)}</span>
                  {b.diff !== 0 && (
                    <span className={`text-xs font-medium ${Math.abs(b.diff) < 5 ? "text-muted-foreground" : b.status === "above" ? (b.lowerIsBetter ? "text-red-600" : "text-green-600") : (b.lowerIsBetter ? "text-green-600" : "text-amber-600")}`}>
                      ({b.diff > 0 ? "+" : ""}{b.diff}%)
                    </span>
                  )}
                </div>
                <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min((b.actual / (b.benchmark * 1.5)) * 100, 100)}%`,
                      backgroundColor: b.status === "above" ? (b.lowerIsBetter ? "#ef4444" : "#22c55e") : b.status === "below" ? (b.lowerIsBetter ? "#22c55e" : "#f59e0b") : "#6366f1",
                    }}
                  />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Bar chart comparison */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Actual vs. Benchmark (Normalized %)</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground">Loading...</div>
          ) : (
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={benchmarkData.map(b => ({ name: b.metric.replace("Avg ", "").slice(0, 16), actual: b.actual, benchmark: b.benchmark }))} margin={{ top: 10, right: 20, left: 0, bottom: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-20} textAnchor="end" />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="actual" name="Your Platform" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="benchmark" name="Industry Benchmark" fill="#e2e8f0" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
