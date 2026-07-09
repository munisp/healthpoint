import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocation } from "wouter";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { TrendingUp, TrendingDown, Minus, Search, ExternalLink, Info } from "lucide-react";

// Benchmark contract rates by service type (% of Medicare as industry reference)
const BENCHMARK_RATES: Record<string, { low: number; median: number; high: number }> = {
  emergency_medicine: { low: 1.8, median: 2.4, high: 3.2 },
  anesthesiology: { low: 2.0, median: 2.8, high: 3.8 },
  radiology: { low: 1.5, median: 2.0, high: 2.8 },
  pathology: { low: 1.4, median: 1.9, high: 2.6 },
  neonatology: { low: 2.2, median: 3.0, high: 4.0 },
  air_ambulance: { low: 3.5, median: 5.0, high: 7.5 },
  ground_ambulance: { low: 1.8, median: 2.5, high: 3.5 },
  hospitalist: { low: 1.6, median: 2.2, high: 3.0 },
  intensivist: { low: 2.0, median: 2.7, high: 3.6 },
  other: { low: 1.5, median: 2.0, high: 2.8 },
};

// Estimated Medicare base rates by service type
const MEDICARE_BASE: Record<string, number> = {
  emergency_medicine: 320, anesthesiology: 580, radiology: 280, pathology: 160,
  neonatology: 1200, air_ambulance: 3200, ground_ambulance: 580, hospitalist: 180,
  intensivist: 520, other: 250,
};

function getRatePosition(billedAmount: number, serviceType: string): "below" | "in_range" | "above" {
  const base = MEDICARE_BASE[serviceType] ?? 250;
  const bench = BENCHMARK_RATES[serviceType] ?? BENCHMARK_RATES.other;
  const ratio = billedAmount / base;
  if (ratio < bench.low) return "below";
  if (ratio > bench.high) return "above";
  return "in_range";
}

export default function ContractRateComparison() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [serviceFilter, setServiceFilter] = useState("all");

  const { data, isLoading } = trpc.disputes.list.useQuery({ limit: 100, offset: 0 });
  const disputes = data?.items ?? [];

  const filtered = useMemo(() => {
    return disputes.filter(d =>
      (serviceFilter === "all" || d.serviceType === serviceFilter) &&
      (!search || d.referenceNumber?.toLowerCase().includes(search.toLowerCase()) ||
        d.respondingPartyName?.toLowerCase().includes(search.toLowerCase()))
    );
  }, [disputes, serviceFilter, search]);

  const withAnalysis = useMemo(() => {
    return filtered.map(d => {
      const billed = Number(d.billedAmount) || 0;
      const serviceType = d.serviceType ?? "other";
      const base = MEDICARE_BASE[serviceType] ?? 250;
      const bench = BENCHMARK_RATES[serviceType] ?? BENCHMARK_RATES.other;
      const position = getRatePosition(billed, serviceType);
      const medicareMultiple = billed > 0 ? (billed / base).toFixed(1) : null;
      const benchmarkLow = base * bench.low;
      const benchmarkHigh = base * bench.high;
      const variance = billed > 0 ? ((billed - base * bench.median) / (base * bench.median) * 100).toFixed(0) : null;
      return { ...d, position, medicareMultiple, benchmarkLow, benchmarkHigh, variance };
    });
  }, [filtered]);

  const chartData = useMemo(() => {
    const byService: Record<string, { above: number; in_range: number; below: number }> = {};
    withAnalysis.forEach(d => {
      const s = d.serviceType ?? "other";
      if (!byService[s]) byService[s] = { above: 0, in_range: 0, below: 0 };
      byService[s][d.position]++;
    });
    return Object.entries(byService).map(([service, counts]) => ({
      service: service.replace(/_/g, " "),
      ...counts,
    }));
  }, [withAnalysis]);

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);

  const aboveCount = withAnalysis.filter(d => d.position === "above").length;
  const inRangeCount = withAnalysis.filter(d => d.position === "in_range").length;
  const belowCount = withAnalysis.filter(d => d.position === "below").length;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <TrendingUp className="h-6 w-6 text-blue-600" />
          Contract Rate Comparison
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Compare billed amounts against industry contract rate benchmarks</p>
      </div>

      <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
        <Info className="h-4 w-4 shrink-0" />
        <span>Benchmarks are expressed as multiples of Medicare base rates using industry-average contract ranges. For informational purposes only.</span>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="border-red-200">
          <CardContent className="p-4 text-center">
            <div className="text-3xl font-bold text-red-600">{aboveCount}</div>
            <div className="text-xs text-muted-foreground mt-1">Above Benchmark Range</div>
          </CardContent>
        </Card>
        <Card className="border-green-200">
          <CardContent className="p-4 text-center">
            <div className="text-3xl font-bold text-green-600">{inRangeCount}</div>
            <div className="text-xs text-muted-foreground mt-1">Within Benchmark Range</div>
          </CardContent>
        </Card>
        <Card className="border-amber-200">
          <CardContent className="p-4 text-center">
            <div className="text-3xl font-bold text-amber-600">{belowCount}</div>
            <div className="text-xs text-muted-foreground mt-1">Below Benchmark Range</div>
          </CardContent>
        </Card>
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Rate Position by Service Type</CardTitle></CardHeader>
          <CardContent>
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="service" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="above" name="Above Range" fill="#ef4444" stackId="a" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="in_range" name="In Range" fill="#22c55e" stackId="a" />
                  <Bar dataKey="below" name="Below Range" fill="#f59e0b" stackId="a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search disputes..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={serviceFilter} onValueChange={setServiceFilter}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All Services" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Services</SelectItem>
            {Object.keys(BENCHMARK_RATES).map(s => <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, " ")}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Reference</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Payer</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Service</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Billed</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Benchmark Range</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Variance</th>
                  <th className="text-center px-4 py-3 font-medium text-muted-foreground">Position</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoading ? (
                  <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">Loading...</td></tr>
                ) : withAnalysis.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">No disputes found</td></tr>
                ) : (
                  withAnalysis.map(d => (
                    <tr key={d.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3 font-mono text-xs text-primary">{d.referenceNumber}</td>
                      <td className="px-4 py-3 text-sm truncate max-w-[140px]">{d.respondingPartyName}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="text-xs capitalize">{(d.serviceType ?? "other").replace(/_/g, " ")}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-medium">{d.billedAmount ? formatCurrency(Number(d.billedAmount)) : "—"}</td>
                      <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                        {formatCurrency(d.benchmarkLow)} – {formatCurrency(d.benchmarkHigh)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {d.variance !== null ? (
                          <span className={`text-xs font-medium ${Number(d.variance) > 0 ? "text-red-600" : Number(d.variance) < 0 ? "text-amber-600" : "text-green-600"}`}>
                            {Number(d.variance) > 0 ? "+" : ""}{d.variance}%
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {d.position === "above" ? (
                          <Badge className="bg-red-100 text-red-700 text-xs"><TrendingUp className="h-3 w-3 mr-1" />Above</Badge>
                        ) : d.position === "below" ? (
                          <Badge className="bg-amber-100 text-amber-700 text-xs"><TrendingDown className="h-3 w-3 mr-1" />Below</Badge>
                        ) : (
                          <Badge className="bg-green-100 text-green-700 text-xs"><Minus className="h-3 w-3 mr-1" />In Range</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Button variant="ghost" size="sm" onClick={() => navigate(`/disputes/${d.id}`)}>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
