import { useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  LineChart, Line, ReferenceLine, TooltipProps,
} from "recharts";
import {
  Building2, TrendingUp, DollarSign, Scale, Clock,
  BarChart2, LineChart as LineChartIcon, ChevronDown, X,
} from "lucide-react";

// 10 distinct colors for multi-payer comparison lines
const PAYER_COLORS = [
  "#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed",
  "#0891b2", "#db2777", "#65a30d", "#ea580c", "#6366f1",
];

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

type TrendWindow = "6m" | "12m" | "24m";
type TrendMetric = "winRate" | "recoveryRate";

// ── Multi-payer tooltip ──────────────────────────────────────────────────────
function MultiPayerTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background border border-border rounded-lg shadow-lg p-3 text-xs max-w-56">
      <p className="font-semibold mb-2 text-foreground">{label}</p>
      {payload
        .filter(p => p.value !== undefined && p.value !== null)
        .sort((a, b) => (b.value as number) - (a.value as number))
        .map(p => (
          <div key={p.dataKey} className="flex items-center gap-2 mb-1">
            <span className="h-2 w-2 rounded-full shrink-0" style={{ background: p.color }} />
            <span className="text-muted-foreground truncate flex-1">{p.name}:</span>
            <span className="font-medium shrink-0">{p.value}%</span>
          </div>
        ))}
    </div>
  );
}

// ── Single-payer tooltip (win + recovery) ────────────────────────────────────
function SinglePayerTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background border border-border rounded-lg shadow-lg p-3 text-xs">
      <p className="font-semibold mb-2">{label}</p>
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center gap-2 mb-1">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium">{p.value}%</span>
        </div>
      ))}
      {payload[0]?.payload?.disputes != null && (
        <p className="text-muted-foreground mt-1 pt-1 border-t border-border">
          {payload[0].payload.disputes} disputes · {payload[0].payload.won} won
        </p>
      )}
    </div>
  );
}

export default function PayerIntelligence() {
  const [trendWindow, setTrendWindow] = useState<TrendWindow>("12m");
  const [trendMetric, setTrendMetric] = useState<TrendMetric>("winRate");
  // "all" = single-payer mode showing both win+recovery for one payer
  // "compare" = multi-select comparison mode
  const [trendMode, setTrendMode] = useState<"single" | "compare">("single");
  const [singlePayer, setSinglePayer] = useState<string>("all");
  const [selectedPayers, setSelectedPayers] = useState<string[]>([]);
  const [payerPickerOpen, setPayerPickerOpen] = useState(false);

  const { data: disputes, isLoading } = trpc.disputes.list.useQuery({ limit: 1000, offset: 0 });

  type DisputeItem = {
    id: string;
    payerName?: string | null;
    billedAmount?: string | null;
    determinationAmount?: string | null;
    status: string;
    createdAt?: Date | null;
    updatedAt?: Date | null;
  };

  const items = useMemo((): DisputeItem[] => {
    if (!disputes) return [];
    return ((disputes as { items: DisputeItem[] }).items ?? []);
  }, [disputes]);

  // ── Per-payer aggregate stats ─────────────────────────────────────────────
  const payerStats = useMemo((): PayerStat[] => {
    const map: Record<string, PayerStat> = {};
    for (const d of items) {
      const payer = d.payerName ?? "Unknown Payer";
      if (!map[payer]) {
        map[payer] = { payerName: payer, totalDisputes: 0, wonDisputes: 0, totalBilled: 0, totalDetermination: 0, avgDaysToClose: 0, winRate: 0, recoveryRate: 0 };
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
    return Object.values(map).map(stat => {
      const closed = items.filter(d => d.payerName === stat.payerName && d.status === "closed").length;
      return {
        ...stat,
        winRate: closed > 0 ? Math.round((stat.wonDisputes / closed) * 100) : 0,
        recoveryRate: stat.totalBilled > 0 ? Math.round((stat.totalDetermination / stat.totalBilled) * 100) : 0,
        avgDaysToClose: closed > 0 ? Math.round(stat.avgDaysToClose / closed) : 0,
      };
    }).sort((a, b) => b.totalDisputes - a.totalDisputes).slice(0, 10);
  }, [items]);

  // ── Month keys helper ─────────────────────────────────────────────────────
  const monthKeys = useMemo(() => {
    const windowMonths = trendWindow === "6m" ? 6 : trendWindow === "12m" ? 12 : 24;
    const now = new Date();
    const keys: string[] = [];
    for (let i = windowMonths - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    return keys;
  }, [trendWindow]);

  const monthLabel = (key: string) => {
    const [year, month] = key.split("-");
    return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  };

  // ── Single-payer trend data (win + recovery for one payer) ────────────────
  const singleTrend = useMemo(() => {
    const filtered = singlePayer === "all" ? items : items.filter(d => d.payerName === singlePayer);
    const buckets: Record<string, { disputes: number; won: number; billed: number; det: number }> = {};
    monthKeys.forEach(m => { buckets[m] = { disputes: 0, won: 0, billed: 0, det: 0 }; });
    for (const d of filtered) {
      if (d.status !== "closed") continue;
      const closeDate = d.updatedAt ? new Date(d.updatedAt) : null;
      if (!closeDate) continue;
      const key = `${closeDate.getFullYear()}-${String(closeDate.getMonth() + 1).padStart(2, "0")}`;
      if (!buckets[key]) continue;
      buckets[key].disputes++;
      const billed = Number(d.billedAmount ?? 0);
      const det = Number(d.determinationAmount ?? 0);
      buckets[key].billed += billed;
      buckets[key].det += det;
      if (det >= billed * 0.8) buckets[key].won++;
    }
    return monthKeys.map(key => {
      const b = buckets[key];
      return {
        month: monthLabel(key),
        monthKey: key,
        disputes: b.disputes,
        won: b.won,
        winRate: b.disputes > 0 ? Math.round((b.won / b.disputes) * 100) : 0,
        recoveryRate: b.billed > 0 ? Math.round((b.det / b.billed) * 100) : 0,
      };
    });
  }, [items, monthKeys, singlePayer]);

  // ── Multi-payer comparison data ───────────────────────────────────────────
  // Shape: [{ month, "PayerA_winRate": 72, "PayerB_winRate": 55, ... }]
  const multiTrend = useMemo(() => {
    const payersToPlot = selectedPayers.length > 0 ? selectedPayers : payerStats.slice(0, 3).map(p => p.payerName);

    // Build per-payer monthly buckets
    const perPayer: Record<string, Record<string, { disputes: number; won: number; billed: number; det: number }>> = {};
    for (const payer of payersToPlot) {
      perPayer[payer] = {};
      monthKeys.forEach(m => { perPayer[payer][m] = { disputes: 0, won: 0, billed: 0, det: 0 }; });
    }

    for (const d of items) {
      const payer = d.payerName ?? "Unknown Payer";
      if (!perPayer[payer]) continue;
      if (d.status !== "closed") continue;
      const closeDate = d.updatedAt ? new Date(d.updatedAt) : null;
      if (!closeDate) continue;
      const key = `${closeDate.getFullYear()}-${String(closeDate.getMonth() + 1).padStart(2, "0")}`;
      if (!perPayer[payer][key]) continue;
      perPayer[payer][key].disputes++;
      const billed = Number(d.billedAmount ?? 0);
      const det = Number(d.determinationAmount ?? 0);
      perPayer[payer][key].billed += billed;
      perPayer[payer][key].det += det;
      if (det >= billed * 0.8) perPayer[payer][key].won++;
    }

    return monthKeys.map(key => {
      const row: Record<string, string | number> = { month: monthLabel(key), monthKey: key };
      for (const payer of payersToPlot) {
        const b = perPayer[payer]?.[key] ?? { disputes: 0, won: 0, billed: 0, det: 0 };
        const val = trendMetric === "winRate"
          ? (b.disputes > 0 ? Math.round((b.won / b.disputes) * 100) : 0)
          : (b.billed > 0 ? Math.round((b.det / b.billed) * 100) : 0);
        row[payer] = val;
      }
      return row;
    });
  }, [items, monthKeys, selectedPayers, payerStats, trendMetric]);

  const activePayers = selectedPayers.length > 0 ? selectedPayers : payerStats.slice(0, 3).map(p => p.payerName);

  const togglePayer = (name: string) => {
    setSelectedPayers(prev =>
      prev.includes(name) ? prev.filter(p => p !== name) : prev.length < 8 ? [...prev, name] : prev
    );
  };

  // ── Summary KPIs ──────────────────────────────────────────────────────────
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

  const trendDirection = useMemo(() => {
    const recent = singleTrend.slice(-3).filter(m => m.disputes > 0);
    if (recent.length < 2) return null;
    return recent[recent.length - 1].winRate - recent[0].winRate;
  }, [singleTrend]);

  const payerOptions = [{ value: "all", label: "All Payers" }, ...payerStats.map(p => ({ value: p.payerName, label: p.payerName }))];

  return (
    <DashboardLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Building2 className="h-6 w-6 text-primary" />
              Payer Intelligence
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Per-payer dispute analytics — win rates, recovery rates, trends, and volumes
            </p>
          </div>
          <Badge variant="secondary">{payerStats.length} payers tracked</Badge>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Disputes", value: totalDisputes, icon: Scale, color: "text-blue-500" },
            { label: "Total Billed", value: `$${(totalBilled / 1000).toFixed(0)}K`, icon: DollarSign, color: "text-green-500" },
            {
              label: "Avg Win Rate", value: `${avgWinRate}%`, icon: TrendingUp, color: "text-purple-500",
              sub: trendDirection !== null
                ? trendDirection > 0 ? `↑ ${trendDirection}pp last 3 mo`
                : trendDirection < 0 ? `↓ ${Math.abs(trendDirection)}pp last 3 mo`
                : "Stable last 3 mo"
                : undefined,
            },
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
                    {kpi.sub && (
                      <p className={`text-xs font-medium mt-0.5 ${trendDirection && trendDirection > 0 ? "text-green-600" : "text-red-500"}`}>
                        {kpi.sub}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* ── TREND LINE CHART ─────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div>
                <CardTitle className="text-sm flex items-center gap-2">
                  <LineChartIcon className="h-4 w-4 text-primary" />
                  {trendMode === "single" ? "Win Rate & Recovery Rate Over Time" : "Multi-Payer Win Rate Comparison"}
                </CardTitle>
                <CardDescription className="text-xs mt-1">
                  {trendMode === "single"
                    ? `Monthly trend — ${singlePayer === "all" ? "all payers" : singlePayer}`
                    : `Comparing ${activePayers.length} payer${activePayers.length !== 1 ? "s" : ""} — ${trendMetric === "winRate" ? "Win Rate" : "Recovery Rate"}`}
                </CardDescription>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {/* Mode toggle */}
                <div className="flex items-center border rounded-lg p-0.5 gap-0.5">
                  <Button
                    variant={trendMode === "single" ? "default" : "ghost"}
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setTrendMode("single")}
                  >
                    Single Payer
                  </Button>
                  <Button
                    variant={trendMode === "compare" ? "default" : "ghost"}
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setTrendMode("compare")}
                  >
                    Compare
                  </Button>
                </div>

                {trendMode === "single" ? (
                  <Select value={singlePayer} onValueChange={setSinglePayer}>
                    <SelectTrigger className="h-8 w-44 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {payerOptions.map(o => (
                        <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <>
                    {/* Metric selector */}
                    <div className="flex items-center border rounded-lg p-0.5 gap-0.5">
                      <Button
                        variant={trendMetric === "winRate" ? "default" : "ghost"}
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => setTrendMetric("winRate")}
                      >
                        Win Rate
                      </Button>
                      <Button
                        variant={trendMetric === "recoveryRate" ? "default" : "ghost"}
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => setTrendMetric("recoveryRate")}
                      >
                        Recovery
                      </Button>
                    </div>

                    {/* Multi-payer picker */}
                    <Popover open={payerPickerOpen} onOpenChange={setPayerPickerOpen}>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 text-xs gap-1">
                          <Building2 className="h-3.5 w-3.5" />
                          {selectedPayers.length === 0 ? "Top 3 payers" : `${selectedPayers.length} selected`}
                          <ChevronDown className="h-3 w-3 ml-0.5" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 p-3" align="end">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-semibold">Select payers to compare</p>
                            <p className="text-xs text-muted-foreground">Max 8</p>
                          </div>
                          {selectedPayers.length > 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-xs w-full mb-2 text-muted-foreground"
                              onClick={() => setSelectedPayers([])}
                            >
                              Clear selection (use top 3)
                            </Button>
                          )}
                          {payerStats.map((p, i) => (
                            <div key={p.payerName} className="flex items-center gap-2 py-1">
                              <Checkbox
                                id={`payer-${i}`}
                                checked={selectedPayers.includes(p.payerName)}
                                onCheckedChange={() => togglePayer(p.payerName)}
                                disabled={!selectedPayers.includes(p.payerName) && selectedPayers.length >= 8}
                              />
                              <Label htmlFor={`payer-${i}`} className="text-xs cursor-pointer flex-1 truncate">
                                {p.payerName}
                              </Label>
                              <span
                                className="h-2.5 w-2.5 rounded-full shrink-0"
                                style={{ background: PAYER_COLORS[i % PAYER_COLORS.length] }}
                              />
                            </div>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </>
                )}

                {/* Time window */}
                <div className="flex items-center border rounded-lg p-0.5 gap-0.5">
                  {(["6m", "12m", "24m"] as TrendWindow[]).map(w => (
                    <Button
                      key={w}
                      variant={trendWindow === w ? "default" : "ghost"}
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => setTrendWindow(w)}
                    >
                      {w}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            {/* Active payer chips in compare mode */}
            {trendMode === "compare" && activePayers.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {activePayers.map((name, i) => (
                  <Badge
                    key={name}
                    variant="secondary"
                    className="text-xs gap-1 pr-1"
                    style={{ borderLeft: `3px solid ${PAYER_COLORS[i % PAYER_COLORS.length]}` }}
                  >
                    {name.length > 22 ? name.slice(0, 20) + "…" : name}
                    {selectedPayers.includes(name) && (
                      <button onClick={() => togglePayer(name)} className="hover:text-destructive">
                        <X className="h-2.5 w-2.5" />
                      </button>
                    )}
                  </Badge>
                ))}
              </div>
            )}
          </CardHeader>

          <CardContent>
            {isLoading ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground">Loading...</div>
            ) : trendMode === "single" ? (
              <>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={singleTrend} margin={{ top: 8, right: 24, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} tickLine={false} axisLine={false} width={36} />
                    <Tooltip content={<SinglePayerTooltip />} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                    <ReferenceLine y={50} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" strokeOpacity={0.4} />
                    <ReferenceLine y={avgWinRate} stroke="#7c3aed" strokeDasharray="6 3" strokeOpacity={0.3}
                      label={{ value: `Avg ${avgWinRate}%`, position: "insideTopRight", fontSize: 10, fill: "#7c3aed" }} />
                    <Line type="monotone" dataKey="winRate" name="Win Rate" stroke="#2563eb" strokeWidth={2.5}
                      dot={{ r: 3, fill: "#2563eb", strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls={false} />
                    <Line type="monotone" dataKey="recoveryRate" name="Recovery Rate" stroke="#16a34a" strokeWidth={2.5}
                      strokeDasharray="5 3" dot={{ r: 3, fill: "#16a34a", strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
                <div className="grid grid-cols-3 gap-3 mt-4 pt-3 border-t border-border">
                  {(() => {
                    const withData = singleTrend.filter(m => m.disputes > 0);
                    const latestWin = withData.length > 0 ? withData[withData.length - 1].winRate : 0;
                    const latestRec = withData.length > 0 ? withData[withData.length - 1].recoveryRate : 0;
                    const totalClosed = singleTrend.reduce((s, m) => s + m.disputes, 0);
                    return [
                      { label: "Latest Win Rate", value: `${latestWin}%`, color: latestWin >= 60 ? "text-green-600" : latestWin >= 40 ? "text-yellow-600" : "text-red-500" },
                      { label: "Latest Recovery Rate", value: `${latestRec}%`, color: latestRec >= 70 ? "text-green-600" : "text-muted-foreground" },
                      { label: `Closed (${trendWindow})`, value: totalClosed, color: "text-foreground" },
                    ].map(s => (
                      <div key={s.label} className="text-center">
                        <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                        <p className="text-xs text-muted-foreground">{s.label}</p>
                      </div>
                    ));
                  })()}
                </div>
              </>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={multiTrend} margin={{ top: 8, right: 24, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} tickLine={false} axisLine={false} width={36} />
                    <Tooltip content={<MultiPayerTooltip />} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                    <ReferenceLine y={50} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" strokeOpacity={0.4} />
                    {activePayers.map((payer, i) => (
                      <Line
                        key={payer}
                        type="monotone"
                        dataKey={payer}
                        name={payer.length > 18 ? payer.slice(0, 16) + "…" : payer}
                        stroke={PAYER_COLORS[i % PAYER_COLORS.length]}
                        strokeWidth={2}
                        dot={{ r: 3, fill: PAYER_COLORS[i % PAYER_COLORS.length], strokeWidth: 0 }}
                        activeDot={{ r: 5 }}
                        connectNulls={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>

                {/* Comparison summary table */}
                <div className="mt-4 pt-3 border-t border-border overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-muted-foreground border-b">
                        <th className="text-left py-1.5 pr-4 font-medium">Payer</th>
                        <th className="text-right py-1.5 px-3 font-medium">Overall {trendMetric === "winRate" ? "Win Rate" : "Recovery"}</th>
                        <th className="text-right py-1.5 px-3 font-medium">Latest Month</th>
                        <th className="text-right py-1.5 pl-3 font-medium">Trend</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activePayers.map((name, i) => {
                        const stat = payerStats.find(p => p.payerName === name);
                        const overall = stat ? (trendMetric === "winRate" ? stat.winRate : stat.recoveryRate) : 0;
                        const withData = multiTrend.filter(m => (m[name] as number) > 0);
                        const latest = withData.length > 0 ? (withData[withData.length - 1][name] as number) : 0;
                        const first = withData.length > 1 ? (withData[0][name] as number) : latest;
                        const delta = latest - first;
                        return (
                          <tr key={name} className="border-b last:border-0">
                            <td className="py-2 pr-4 flex items-center gap-2">
                              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: PAYER_COLORS[i % PAYER_COLORS.length] }} />
                              <span className="font-medium truncate max-w-32">{name}</span>
                            </td>
                            <td className="py-2 px-3 text-right font-medium">{overall}%</td>
                            <td className="py-2 px-3 text-right">{latest}%</td>
                            <td className={`py-2 pl-3 text-right font-medium ${delta > 0 ? "text-green-600" : delta < 0 ? "text-red-500" : "text-muted-foreground"}`}>
                              {delta > 0 ? `↑ ${delta}pp` : delta < 0 ? `↓ ${Math.abs(delta)}pp` : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Bar charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-muted-foreground" />
                Disputes by Payer
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="h-64 flex items-center justify-center text-muted-foreground">Loading...</div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={topPayers} layout="vertical" margin={{ left: 16, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="payerName" width={120} tick={{ fontSize: 10 }}
                      tickFormatter={v => v.length > 16 ? v.slice(0, 14) + "…" : v} />
                    <Tooltip formatter={(v: number) => [v, "Disputes"]} />
                    <Bar dataKey="totalDisputes" fill="#2563eb" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Dispute Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="h-64 flex items-center justify-center text-muted-foreground">Loading...</div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2} dataKey="value">
                      {pieData.map((_, i) => <Cell key={i} fill={PAYER_COLORS[i % PAYER_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => [v, "Disputes"]} />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Win Rate bar */}
        <Card>
          <CardHeader className="pb-2">
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

        {/* Payer Scorecard */}
        <Card>
          <CardHeader className="pb-2">
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
