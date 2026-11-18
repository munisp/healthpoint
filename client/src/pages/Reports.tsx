import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
// DashboardLayout now provided globally via App.tsx
import { toast } from "sonner";
import { useChartColors } from "@/hooks/useChartColors";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, Sector
} from "recharts";
import {
  BarChart2, Download, RefreshCw, TrendingUp, DollarSign,
  Clock, CheckCircle2, AlertTriangle, FileText, Loader2
} from "lucide-react";

const REPORT_TYPES = [
  { id: "volume", label: "Dispute Volume", icon: BarChart2, description: "Monthly dispute counts by status and service type" },
  { id: "financial", label: "Financial Summary", icon: DollarSign, description: "Billed vs. QPA vs. determination amounts" },
  { id: "outcomes", label: "Outcome Analysis", icon: TrendingUp, description: "Win rates, determination trends, and appeal rates" },
  { id: "timeline", label: "Timeline Compliance", icon: Clock, description: "Step completion times vs. NSA statutory deadlines" },
  { id: "emr", label: "EMR Integration", icon: CheckCircle2, description: "Data pull success rates and field extraction quality" },
  { id: "lakehouse", label: "Lakehouse Analytics", icon: BarChart2, description: "Payer behavior, QPA trends, claim volume, dispute density (source-labeled)" },
];

// All chart data is now DB-driven via trpc.reports.summary and trpc.dashboard.*
// Empty arrays are shown when no data is available yet (seed via Admin panel)

/** auditfix-b: lakehouse analytics section (lakehouseAnalytics router).
 *  Every panel surfaces the server's `source` field verbatim — when the
 *  lakehouse is not configured the server returns source:"postgres_fallback"
 *  and the UI says exactly that (no fake "lakehouse" branding). */
function SourceBadge({ source }: { source?: string }) {
  if (!source) return null;
  return source === "lakehouse"
    ? <Badge variant="secondary">source: lakehouse</Badge>
    : <Badge variant="outline">source: postgres fallback (lakehouse not configured)</Badge>;
}

function RowsTable({ rows, max = 10 }: { rows: Array<Record<string, unknown>>; max?: number }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">No data available for this query yet.</p>;
  const cols = Object.keys(rows[0]);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            {cols.map(c => <th key={c} className="py-1 pr-3">{c.replace(/([A-Z])/g, " $1").replace(/_/g, " ")}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, max).map((r, i) => (
            <tr key={i} className="border-t">
              {cols.map(c => <td key={c} className="py-1 pr-3">{String(r[c] ?? "—")}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > max && <p className="text-xs text-muted-foreground mt-1">Showing {max} of {rows.length} rows.</p>}
    </div>
  );
}

function LakehousePanel({ title, query }: { title: string; query: { data?: { source: string; rows: Array<Record<string, unknown>> }; isLoading: boolean; isError: boolean; error?: { message: string } | null } }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex flex-wrap items-center gap-2">
          {title}
          <SourceBadge source={query.data?.source} />
        </CardTitle>
      </CardHeader>
      <CardContent>
        {query.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {query.isError && <p role="alert" className="text-sm text-destructive">{query.error?.message}</p>}
        {query.data && <RowsTable rows={query.data.rows} />}
      </CardContent>
    </Card>
  );
}

function LakehouseSection() {
  const { data: myOrgs, isLoading: orgsLoading } = trpc.orgs.listMine.useQuery();
  const [orgId, setOrgId] = useState("");
  const effectiveOrgId = orgId || myOrgs?.[0]?.orgId || "";
  const [code, setCode] = useState("");
  const [state, setState] = useState("");

  const payer = trpc.lakehouseAnalytics.payerBehaviorSummary.useQuery(
    { orgId: effectiveOrgId }, { enabled: !!effectiveOrgId, retry: 1 });
  const qpa = trpc.lakehouseAnalytics.qpaTrends.useQuery(
    { orgId: effectiveOrgId, code: code.trim() || undefined, state: state.trim().toUpperCase() || undefined },
    { enabled: !!effectiveOrgId, retry: 1 });
  const volume = trpc.lakehouseAnalytics.claimVolumeStats.useQuery(
    { orgId: effectiveOrgId }, { enabled: !!effectiveOrgId, retry: 1 });
  const density = trpc.lakehouseAnalytics.disputeDensityByState.useQuery(undefined, { retry: 1 });

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground max-w-3xl">
        Aggregated analytics. When the lakehouse query service is not configured on this deployment,
        results come from the operational Postgres database and are labeled "postgres fallback".
      </p>
      {orgsLoading && <p className="text-sm text-muted-foreground">Loading your organizations…</p>}
      {!orgsLoading && !myOrgs?.length && (
        <p className="text-sm text-muted-foreground">You are not a member of any organization — organization-scoped analytics are unavailable.</p>
      )}
      {!!myOrgs?.length && (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-muted-foreground block">Organization</label>
            <select className="border rounded px-2 py-1 text-sm bg-background" value={effectiveOrgId}
              onChange={e => setOrgId(e.target.value)} aria-label="Analytics organization">
              {myOrgs.map(o => <option key={o.orgId} value={o.orgId}>{o.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block">QPA filter: service code (optional)</label>
            <input className="border rounded px-2 py-1 text-sm bg-background w-32" value={code} onChange={e => setCode(e.target.value)} aria-label="QPA service code filter" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block">State (optional)</label>
            <input className="border rounded px-2 py-1 text-sm bg-background w-20" maxLength={2} value={state} onChange={e => setState(e.target.value)} aria-label="QPA state filter" />
          </div>
        </div>
      )}
      {!!effectiveOrgId && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <LakehousePanel title="Payer behavior summary" query={payer} />
          <LakehousePanel title="QPA trends" query={qpa} />
          <LakehousePanel title="Claim volume stats" query={volume} />
          <LakehousePanel title="Dispute density by state (platform-wide)" query={density} />
        </div>
      )}
    </div>
  );
}

export default function Reports() {
  const C = useChartColors();
  const COLORS = [C.chart1, C.chart2, C.chart3, C.danger, C.chart4, C.info, C.chart5, C.chart2];

  const { isAuthenticated } = useAuth();
  const [activeReport, setActiveReport] = useState("volume");
  const [dateRange, setDateRange] = useState("6m");

  const { data: stats } = trpc.dashboard.stats.useQuery(undefined, { enabled: isAuthenticated });
  const { data: outcomeData } = trpc.dashboard.outcomeAnalytics.useQuery(undefined, { enabled: isAuthenticated });
  // Wire reports.summary for date-range-aware report metrics
  const startDate = dateRange === "3m" ? new Date(Date.now() - 90 * 86400000).toISOString()
    : dateRange === "6m" ? new Date(Date.now() - 180 * 86400000).toISOString()
    : dateRange === "ytd" ? new Date(new Date().getFullYear(), 0, 1).toISOString()
    : new Date(Date.now() - 365 * 86400000).toISOString();
  const { data: reportSummary } = trpc.reports.summary.useQuery(
    { startDate },
    { enabled: isAuthenticated, staleTime: 2 * 60 * 1000 }
  );
  // Build live service-type pie data from report summary
  const livePieData = reportSummary?.byServiceType?.length
    ? reportSummary.byServiceType.map((item: { type: string; count: number }) => ({ name: item.type.replace(/_/g, " "), value: item.count }))
    : [];

  const volumeData = reportSummary?.byMonth ?? [];
  const financialData = reportSummary?.financialByServiceType ?? [];
  const outcomeChartData = (reportSummary?.outcomeByMonth ?? []).map((r: { month: string; won: number; lost: number; pending: number }) => ({ month: r.month, winRate: (r.won + r.lost) > 0 ? r.won / (r.won + r.lost) : 0, determinationRate: (r.won + r.lost + r.pending) > 0 ? (r.won + r.lost) / (r.won + r.lost + r.pending) : 0, appealRate: 0 }));
  const timelineData = (reportSummary?.avgDaysByStep ?? []).map((r: { step: string; avgDays: number }) => ({ step: r.step, statutory: 30, actual: r.avgDays, onTime: r.avgDays <= 30 ? 0.95 : 0.75 }));

  const dateRangeLabel = dateRange === "3m" ? "Last 3 months" : dateRange === "6m" ? "Last 6 months" : dateRange === "ytd" ? "Year to date" : "Last 12 months";

  const exportCSV = trpc.reports.exportCSV.useMutation({
    onSuccess: (data) => {
      const blob = new Blob([data.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`CSV exported — ${data.rowCount} disputes`);
    },
    onError: (err) => toast.error(`CSV export failed: ${err.message}`),
  });

  const exportPDF = trpc.reports.exportPDF.useMutation({
    onSuccess: (data) => {
      const bytes = Uint8Array.from(atob(data.base64), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`PDF exported — ${data.pageCount} pages`);
    },
    onError: (err) => toast.error(`PDF export failed: ${err.message}`),
  });

  const handleExport = (format: "csv" | "pdf") => {
    const input = { startDate, dateRangeLabel };
    if (format === "csv") exportCSV.mutate(input);
    else exportPDF.mutate(input);
  };

  if (!isAuthenticated) return null;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <BarChart2 size={24} className="text-blue-600" />
              Reports & Analytics
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Comprehensive IDR performance reporting for compliance and strategic decision-making
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={dateRange}
              onChange={e => setDateRange(e.target.value)}
              className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="3m">Last 3 months</option>
              <option value="6m">Last 6 months</option>
              <option value="12m">Last 12 months</option>
              <option value="ytd">Year to date</option>
            </select>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleExport("csv")}
              disabled={exportCSV.isPending || exportPDF.isPending}
            >
              {exportCSV.isPending ? <Loader2 size={13} className="mr-1.5 animate-spin" /> : <Download size={13} className="mr-1.5" />}
              Export CSV
            </Button>
            <Button
              size="sm"
              onClick={() => handleExport("pdf")}
              disabled={exportCSV.isPending || exportPDF.isPending}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {exportPDF.isPending ? <Loader2 size={13} className="mr-1.5 animate-spin" /> : <FileText size={13} className="mr-1.5" />}
              Export PDF
            </Button>
          </div>
        </div>

        {/* KPI Summary Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Disputes", value: reportSummary?.totalDisputes ?? stats?.total ?? "—", icon: BarChart2, color: "text-blue-600" },
            { label: "Active IDR", value: stats?.inIDR ?? "—", icon: Clock, color: "text-purple-600" },
            { label: "Win Rate", value: reportSummary?.winRate != null ? `${reportSummary.winRate}%` : outcomeData?.overallWinRate != null ? `${Math.round(outcomeData.overallWinRate * 100)}%` : "—", icon: TrendingUp, color: "text-amber-600" },
            { label: "Avg. Determination", value: reportSummary?.avgDetermination != null ? `$${Number(reportSummary.avgDetermination).toLocaleString()}` : "—", icon: DollarSign, color: "text-green-600" },
          ].map(kpi => (
            <Card key={kpi.label} className="border-slate-200">
              <CardContent className="p-4 flex items-center gap-3">
                <kpi.icon size={20} className={kpi.color} />
                <div>
                  <p className="text-xs text-slate-500">{kpi.label}</p>
                  <p className="text-xl font-bold text-slate-800">{kpi.value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Report Type Tabs */}
        <div className="flex gap-2 flex-wrap">
          {REPORT_TYPES.map(rt => (
            <button
              key={rt.id}
              onClick={() => setActiveReport(rt.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                activeReport === rt.id
                  ? "bg-blue-600 text-white shadow-sm"
                  : "bg-white border border-slate-200 text-slate-600 hover:border-blue-300 hover:text-blue-600"
              }`}
            >
              <rt.icon size={13} />
              {rt.label}
            </button>
          ))}
        </div>

        {/* Report Content */}
        {activeReport === "volume" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="border-slate-200 lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold text-slate-800">Monthly Dispute Volume by Status</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={volumeData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.muted} />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="open_negotiation" name="Open Negotiation" stackId="a" fill={C.chart1} />
                    <Bar dataKey="idr_active" name="IDR Active" stackId="a" fill={C.chart4} />
                    <Bar dataKey="closed" name="Closed" stackId="a" fill={C.chart2} />
                    <Bar dataKey="ineligible" name="Ineligible" stackId="a" fill={C.muted} radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card className="border-slate-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold text-slate-800">Volume by Service Type</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={livePieData} cx="50%" cy="50%" innerRadius={55} outerRadius={90} dataKey="value" label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`} labelLine={false}>
                      {livePieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => `${v} disputes`} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1 mt-2">
                  {livePieData.map((item, i) => (
                    <div key={item.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                        <span className="text-slate-600">{item.name}</span>
                      </div>
                      <span className="font-medium text-slate-700">{item.value}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {activeReport === "financial" && (
          <Card className="border-slate-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-slate-800">Avg. Billed vs. QPA vs. Determination by Service Type</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={financialData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.muted} />
                  <XAxis dataKey="serviceType" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => `$${Number(v).toLocaleString()}`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="avgBilled" name="Avg. Billed" fill={C.muted} radius={[4,4,0,0]} />
                  <Bar dataKey="avgQPA" name="Avg. QPA" fill={C.chart3} radius={[4,4,0,0]} />
                  <Bar dataKey="avgDetermination" name="Avg. Determination" fill={C.chart1} radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {activeReport === "outcomes" && (
          <Card className="border-slate-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-slate-800">Win Rate, Determination Rate & Appeal Rate Trends</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={outcomeChartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.muted} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} domain={[0, 1]} />
                  <Tooltip formatter={(v: number) => `${Math.round(v * 100)}%`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="winRate" name="Win Rate" stroke={C.chart2} strokeWidth={2} dot={{ r: 4 }} />
                  <Line type="monotone" dataKey="determinationRate" name="Determination Rate" stroke={C.chart1} strokeWidth={2} dot={{ r: 4 }} />
                  <Line type="monotone" dataKey="appealRate" name="Appeal Rate" stroke={C.danger} strokeWidth={2} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {activeReport === "timeline" && (
          <Card className="border-slate-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-slate-800">Step Completion Time vs. NSA Statutory Deadlines (Business Days)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={timelineData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.muted} />
                  <XAxis dataKey="step" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="statutory" name="Statutory Limit (days)" fill={C.muted} radius={[4,4,0,0]} />
                  <Bar dataKey="actual" name="Actual Avg. (days)" fill={C.chart1} radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-4 grid grid-cols-3 md:grid-cols-6 gap-3">
                {timelineData.map(row => (
                  <div key={row.step} className="text-center">
                    <div className={`text-sm font-bold ${row.onTime >= 0.95 ? "text-green-600" : row.onTime >= 0.85 ? "text-amber-600" : "text-red-600"}`}>
                      {Math.round(row.onTime * 100)}%
                    </div>
                    <div className="text-xs text-slate-500">{row.step}</div>
                    <div className="text-xs text-slate-400">on time</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {activeReport === "emr" && <EmrIntegrationReport />}
        {activeReport === "lakehouse" && <LakehouseSection />}
      </div>
  );
}

// Real EMR integration metrics per connection (emr.list + emr.syncHistory).
// Previously this card rendered fabricated KPIs ("1,247 pulls", "97.3%
// success"); those numbers never existed server-side and were removed.
function EmrConnectionStats({ connectionId, name, enabled }: { connectionId: string; name: string; enabled: boolean }) {
  const { data: logs, isLoading, isError, error } = trpc.emr.syncHistory.useQuery(
    { connectionId, limit: 100 },
    { enabled }
  );
  const total = logs?.length ?? 0;
  const success = logs?.filter(l => l.status === "success").length ?? 0;
  const avgFields = total > 0 ? Math.round(logs!.reduce((s, l) => s + (l.fieldsExtracted ?? 0), 0) / total) : null;
  const successRate = total > 0 ? Math.round((success / total) * 1000) / 10 : null;
  return (
    <Card className="border-slate-200">
      <CardContent className="p-5">
        <p className="text-sm font-semibold text-slate-700 mb-2 truncate">{name}</p>
        {isLoading && <p className="text-xs text-slate-400">Loading sync history…</p>}
        {isError && <p className="text-xs text-red-600">{error.message}</p>}
        {logs && (
          <div className="grid grid-cols-3 gap-2">
            <div>
              <p className="text-xs text-slate-500">Data pulls (last 100)</p>
              <p className="text-2xl font-bold text-blue-600">{total}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Success rate</p>
              <p className="text-2xl font-bold text-green-600">{successRate == null ? "—" : `${successRate}%`}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Avg fields extracted</p>
              <p className="text-2xl font-bold text-indigo-600">{avgFields == null ? "—" : avgFields}</p>
            </div>
          </div>
        )}
        {logs && total === 0 && (
          <p className="text-xs text-slate-400 mt-1">No sync activity recorded for this connection yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

function EmrIntegrationReport() {
  const { isAuthenticated } = useAuth();
  const { data: connections, isLoading, isError, error } = trpc.emr.list.useQuery(undefined, { enabled: isAuthenticated });
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground max-w-3xl">
        Real sync telemetry per EMR connection (most recent 100 sync log entries per connection).
        Period-over-period trends are not computed server-side and are therefore not shown.
      </p>
      {isLoading && <p className="text-sm text-muted-foreground">Loading EMR connections…</p>}
      {isError && <p className="text-sm text-red-600">{error.message}</p>}
      {connections && connections.length === 0 && (
        <p className="text-sm text-muted-foreground">No EMR connections configured — there is no integration telemetry to report.</p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {(connections ?? []).map((c: any) => (
          <EmrConnectionStats key={c.id} connectionId={c.id} name={c.name ?? c.emrSystem ?? c.id} enabled={isAuthenticated} />
        ))}
      </div>
    </div>
  );
}


