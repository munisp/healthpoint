import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { Network, Search, AlertTriangle, TrendingUp } from "lucide-react";

const SERVICE_TYPE_LABELS: Record<string, string> = {
  emergency_medicine: "Emergency Medicine", anesthesiology: "Anesthesiology",
  radiology: "Radiology", pathology: "Pathology", neonatology: "Neonatology",
  air_ambulance: "Air Ambulance", ground_ambulance: "Ground Ambulance",
  hospitalist: "Hospitalist", intensivist: "Intensivist", other: "Other",
};

const COLORS = ["#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd", "#ddd6fe", "#ede9fe", "#f5f3ff"];

export default function ProviderNetworkGapAnalyzer() {
  const [search, setSearch] = useState("");
  const [serviceFilter, setServiceFilter] = useState("all");

  const { data, isLoading } = trpc.disputes.list.useQuery({ limit: 200, offset: 0 });
  const disputes = data?.items ?? [];

  // Analyze network gaps: group disputes by payer and service type
  const gapAnalysis = useMemo(() => {
    const payerServiceMap: Record<string, Record<string, number>> = {};
    disputes.forEach(d => {
      const payer = d.respondingPartyName ?? "Unknown Payer";
      const service = d.serviceType ?? "other";
      if (!payerServiceMap[payer]) payerServiceMap[payer] = {};
      payerServiceMap[payer][service] = (payerServiceMap[payer][service] ?? 0) + 1;
    });

    return Object.entries(payerServiceMap)
      .map(([payer, services]) => ({
        payer,
        totalDisputes: Object.values(services).reduce((a, b) => a + b, 0),
        services,
        topService: Object.entries(services).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "other",
        uniqueServices: Object.keys(services).length,
        gapScore: Object.keys(services).length, // More service types = broader gap
      }))
      .sort((a, b) => b.totalDisputes - a.totalDisputes)
      .filter(p =>
        (!search || p.payer.toLowerCase().includes(search.toLowerCase())) &&
        (serviceFilter === "all" || p.services[serviceFilter] !== undefined)
      );
  }, [disputes, search, serviceFilter]);

  const serviceDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    disputes.forEach(d => {
      const s = d.serviceType ?? "other";
      counts[s] = (counts[s] ?? 0) + 1;
    });
    return Object.entries(counts)
      .map(([service, count]) => ({ service: SERVICE_TYPE_LABELS[service] ?? service, count }))
      .sort((a, b) => b.count - a.count);
  }, [disputes]);

  const topPayersByGap = gapAnalysis.slice(0, 6);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Network className="h-6 w-6 text-indigo-600" />
          Provider Network Gap Analyzer
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Identify out-of-network patterns and coverage gaps by payer and service type</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-3xl font-bold">{new Set(disputes.map(d => d.respondingPartyName)).size}</div>
            <div className="text-xs text-muted-foreground mt-1">Unique Payers</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-3xl font-bold">{new Set(disputes.map(d => d.serviceType)).size}</div>
            <div className="text-xs text-muted-foreground mt-1">Service Types</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-3xl font-bold">{disputes.length}</div>
            <div className="text-xs text-muted-foreground mt-1">Total Disputes</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-3xl font-bold text-amber-600">
              {gapAnalysis.filter(p => p.uniqueServices >= 3).length}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Payers with Broad Gaps</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Service type distribution */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Disputes by Service Type</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground">Loading...</div>
            ) : (
              <div style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={serviceDistribution} layout="vertical" margin={{ top: 5, right: 20, left: 80, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="service" tick={{ fontSize: 10 }} width={80} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Payer gap chart */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Top Payers by Dispute Volume</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground">Loading...</div>
            ) : (
              <div style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topPayersByGap.map(p => ({ name: p.payer.length > 20 ? p.payer.slice(0, 18) + "…" : p.payer, disputes: p.totalDisputes, services: p.uniqueServices }))} margin={{ top: 5, right: 20, left: 0, bottom: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-30} textAnchor="end" />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="disputes" name="Disputes" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search payers..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={serviceFilter} onValueChange={setServiceFilter}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All Services" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Services</SelectItem>
            {Object.entries(SERVICE_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Payer gap table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Payer Network Gap Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Payer</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Disputes</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Service Types</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Top Service</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Gap Indicator</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {gapAnalysis.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">No data</td></tr>
                ) : (
                  gapAnalysis.map((p, i) => (
                    <tr key={p.payer} className="hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">{p.payer}</td>
                      <td className="px-4 py-3 text-right">{p.totalDisputes}</td>
                      <td className="px-4 py-3 text-right">{p.uniqueServices}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="text-xs capitalize">{(SERVICE_TYPE_LABELS[p.topService] ?? p.topService)}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden max-w-[80px]">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.min((p.uniqueServices / 5) * 100, 100)}%`,
                                backgroundColor: p.uniqueServices >= 4 ? "#ef4444" : p.uniqueServices >= 2 ? "#f59e0b" : "#22c55e",
                              }}
                            />
                          </div>
                          <Badge className={`text-xs ${p.uniqueServices >= 4 ? "bg-red-100 text-red-700" : p.uniqueServices >= 2 ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>
                            {p.uniqueServices >= 4 ? "Broad" : p.uniqueServices >= 2 ? "Moderate" : "Narrow"}
                          </Badge>
                        </div>
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
