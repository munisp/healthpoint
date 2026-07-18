import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import DashboardLayout from "@/components/DashboardLayout";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell,
} from "recharts";
import {
  BarChart2, Download, TrendingUp, DollarSign,
  Clock, CheckCircle2, FileText, Sparkles, RefreshCw, AlertCircle,
} from "lucide-react";

const COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];

const REPORT_TYPES = [
  { id: "volume", label: "Dispute Volume", icon: BarChart2 },
  { id: "financial", label: "Financial Summary", icon: DollarSign },
  { id: "outcomes", label: "Outcome Analysis", icon: TrendingUp },
  { id: "timeline", label: "Timeline Compliance", icon: Clock },
  { id: "emr", label: "EMR Integration", icon: CheckCircle2 },
];

const DATE_RANGE_LABELS: Record<string, string> = {
  "3m": "Last 3 months",
  "6m": "Last 6 months",
  "12m": "Last 12 months",
  "ytd": "Year to date",
};

export default function Reports() {
  const { isAuthenticated } = useAuth();
  const [activeReport, setActiveReport] = useState("volume");
  const [dateRange, setDateRange] = useState("6m");
  const [aiSummary, setAiSummary] = useState<{ text: string; generatedAt: string } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExportingCSV, setIsExportingCSV] = useState(false);
  const [isExportingPDF, setIsExportingPDF] = useState(false);

  const startDate = dateRange === "3m" ? new Date(Date.now() - 90 * 86400000).toISOString()
    : dateRange === "6m" ? new Date(Date.now() - 180 * 86400000).toISOString()
    : dateRange === "ytd" ? new Date(new Date().getFullYear(), 0, 1).toISOString()
    : new Date(Date.now() - 365 * 86400000).toISOString();

  const dateRangeLabel = DATE_RANGE_LABELS[dateRange] ?? "Last 6 months";

  const { data: stats } = trpc.dashboard.stats.useQuery(undefined, { enabled: isAuthenticated });
  const { data: outcomeData } = trpc.dashboard.outcomeAnalytics.useQuery(undefined, { enabled: isAuthenticated });
  const { data: reportSummary } = trpc.reports.summary.useQuery(
    { startDate },
    { enabled: isAuthenticated, staleTime: 2 * 60 * 1000 }
  );

  const generateSummaryMutation = trpc.reports.generateExecutiveSummary.useMutation({
    onSuccess: (data) => {
      setAiSummary({ text: data.summary, generatedAt: data.generatedAt });
      setIsGenerating(false);
      toast.success("AI executive summary generated");
    },
    onError: (err) => {
      setIsGenerating(false);
      toast.error(`Failed to generate summary: ${err.message}`);
    },
  });

  const exportCSVMutation = trpc.reports.exportCSV.useMutation({
    onSuccess: (data) => {
      setIsExportingCSV(false);
      const blob = new Blob([data.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`CSV downloaded — ${data.rowCount} disputes`);
    },
    onError: (err) => {
      setIsExportingCSV(false);
      toast.error(`CSV export failed: ${err.message}`);
    },
  });

  const exportPDFMutation = trpc.reports.exportPDF.useMutation({
    onSuccess: (data) => {
      setIsExportingPDF(false);
      const bytes = Uint8Array.from(atob(data.base64), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: data.contentType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`PDF downloaded — ${data.pageCount} pages`);
    },
    onError: (err) => {
      setIsExportingPDF(false);
      toast.error(`PDF export failed: ${err.message}`);
    },
  });

  const handleGenerateSummary = () => {
    setIsGenerating(true);
    generateSummaryMutation.mutate({ startDate, dateRangeLabel });
  };

  const handleExportCSV = () => {
    setIsExportingCSV(true);
    exportCSVMutation.mutate({ startDate, dateRangeLabel, executiveSummary: aiSummary?.text });
  };

  const handleExportPDF = () => {
    setIsExportingPDF(true);
    exportPDFMutation.mutate({
      startDate,
      dateRangeLabel,
      executiveSummary: aiSummary?.text,
      executiveSummaryGeneratedAt: aiSummary?.generatedAt,
    });
  };

  const livePieData = reportSummary?.byServiceType?.length
    ? reportSummary.byServiceType.map((item: { type: string; count: number }) => ({
        name: item.type.replace(/_/g, " "),
        value: item.count,
      }))
    : [];

  if (!isAuthenticated) return null;

  return (
    <DashboardLayout>
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
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={dateRange}
              onChange={e => { setDateRange(e.target.value); setAiSummary(null); }}
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
              onClick={handleExportCSV}
              disabled={isExportingCSV || isExportingPDF}
            >
              {isExportingCSV
                ? <><RefreshCw size={13} className="mr-1.5 animate-spin" />Exporting…</>
                : <><Download size={13} className="mr-1.5" />CSV</>}
            </Button>
            <Button
              size="sm"
              className="bg-blue-600 hover:bg-blue-700 text-white"
              onClick={handleExportPDF}
              disabled={isExportingPDF || isExportingCSV}
            >
              {isExportingPDF
                ? <><RefreshCw size={13} className="mr-1.5 animate-spin" />Generating…</>
                : <><FileText size={13} className="mr-1.5" />Export PDF</>}
            </Button>
          </div>
        </div>

        {/* AI Executive Summary Panel */}
        <Card className="border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
                <Sparkles size={16} className="text-blue-600" />
                AI Executive Summary
                <span className="text-xs font-normal text-slate-500 ml-1">
                  — Included in PDF export when generated
                </span>
              </CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={handleGenerateSummary}
                disabled={isGenerating}
                className="border-blue-300 text-blue-700 hover:bg-blue-100"
              >
                {isGenerating
                  ? <><RefreshCw size={13} className="mr-1.5 animate-spin" />Analyzing…</>
                  : aiSummary
                    ? <><RefreshCw size={13} className="mr-1.5" />Regenerate</>
                    : <><Sparkles size={13} className="mr-1.5" />Generate Summary</>}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isGenerating && (
              <div className="flex items-center gap-3 py-4 text-slate-500">
                <RefreshCw size={16} className="animate-spin text-blue-500" />
                <span className="text-sm">Analyzing {dateRangeLabel.toLowerCase()} of dispute data…</span>
              </div>
            )}
            {!isGenerating && !aiSummary && (
              <div className="flex items-start gap-3 py-3 text-slate-500">
                <AlertCircle size={16} className="mt-0.5 text-slate-400 shrink-0" />
                <p className="text-sm">
                  Click <strong>Generate Summary</strong> to produce an AI-powered executive analysis of your
                  {" "}{dateRangeLabel.toLowerCase()} IDR performance — including dispute trends, financial
                  outcomes, and strategic recommendations. The summary will be prepended to the PDF export.
                </p>
              </div>
            )}
            {!isGenerating && aiSummary && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">
                    <Sparkles size={10} />
                    AI-Generated · {dateRangeLabel}
                  </span>
                  <span className="text-xs text-slate-400">
                    {new Date(aiSummary.generatedAt).toLocaleString()}
                  </span>
                </div>
                <div className="prose prose-sm max-w-none text-slate-700 leading-relaxed whitespace-pre-line">
                  {aiSummary.text}
                </div>
                <p className="text-xs text-slate-400 italic">
                  This summary will be included as the first page of the PDF export.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

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
                {reportSummary?.byMonth?.length ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={reportSummary.byMonth} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="open_negotiation" name="Open Negotiation" stackId="a" fill="#3b82f6" />
                      <Bar dataKey="idr_active" name="IDR Active" stackId="a" fill="#8b5cf6" />
                      <Bar dataKey="closed" name="Closed" stackId="a" fill="#22c55e" />
                      <Bar dataKey="ineligible" name="Ineligible" stackId="a" fill="#94a3b8" radius={[4,4,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[280px] flex items-center justify-center text-slate-400 text-sm">
                    No dispute volume data for this period
                  </div>
                )}
              </CardContent>
            </Card>
            <Card className="border-slate-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold text-slate-800">Volume by Service Type</CardTitle>
              </CardHeader>
              <CardContent>
                {livePieData.length ? (
                  <>
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie data={livePieData} cx="50%" cy="50%" innerRadius={55} outerRadius={90} dataKey="value" label={({ percent }) => `${(percent * 100).toFixed(0)}%`} labelLine={false}>
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
                  </>
                ) : (
                  <div className="h-[220px] flex items-center justify-center text-slate-400 text-sm">No data</div>
                )}
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
              {reportSummary?.financialByServiceType?.length ? (
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={reportSummary.financialByServiceType} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="serviceType" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${(v/1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => `$${Number(v).toLocaleString()}`} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="avgBilled" name="Avg. Billed" fill="#e2e8f0" radius={[4,4,0,0]} />
                    <Bar dataKey="avgQPA" name="Avg. QPA" fill="#f59e0b" radius={[4,4,0,0]} />
                    <Bar dataKey="avgDetermination" name="Avg. Determination" fill="#3b82f6" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[320px] flex items-center justify-center text-slate-400 text-sm">
                  No financial data for this period
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeReport === "outcomes" && (
          <Card className="border-slate-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-slate-800">Win Rate & Determination Rate Trends</CardTitle>
            </CardHeader>
            <CardContent>
              {reportSummary?.outcomeByMonth?.length ? (
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart
                    data={reportSummary.outcomeByMonth.map((r: { month: string; won: number; lost: number; pending: number }) => ({
                      month: r.month,
                      winRate: (r.won + r.lost) > 0 ? r.won / (r.won + r.lost) : 0,
                      determinationRate: (r.won + r.lost + r.pending) > 0 ? (r.won + r.lost) / (r.won + r.lost + r.pending) : 0,
                    }))}
                    margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} domain={[0, 1]} />
                    <Tooltip formatter={(v: number) => `${Math.round(v * 100)}%`} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="winRate" name="Win Rate" stroke="#22c55e" strokeWidth={2} dot={{ r: 4 }} />
                    <Line type="monotone" dataKey="determinationRate" name="Determination Rate" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[320px] flex items-center justify-center text-slate-400 text-sm">
                  No determination data yet — close some disputes to see outcome trends
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeReport === "timeline" && (
          <Card className="border-slate-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-slate-800">Step Completion Time vs. NSA Statutory Deadlines (Business Days)</CardTitle>
            </CardHeader>
            <CardContent>
              {reportSummary?.avgDaysByStep?.length ? (
                <>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart
                      data={reportSummary.avgDaysByStep.map((r: { step: string; avgDays: number }) => ({
                        step: r.step,
                        statutory: 30,
                        actual: r.avgDays,
                        onTime: r.avgDays <= 30 ? 0.95 : 0.75,
                      }))}
                      margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="step" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="statutory" name="Statutory Limit (days)" fill="#e2e8f0" radius={[4,4,0,0]} />
                      <Bar dataKey="actual" name="Actual Avg. (days)" fill="#3b82f6" radius={[4,4,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="mt-4 grid grid-cols-3 md:grid-cols-6 gap-3">
                    {reportSummary.avgDaysByStep.map((r: { step: string; avgDays: number }) => (
                      <div key={r.step} className="text-center">
                        <div className={`text-sm font-bold ${r.avgDays <= 30 ? "text-green-600" : "text-red-600"}`}>
                          {r.avgDays === 0 ? "—" : `${r.avgDays}d`}
                        </div>
                        <div className="text-xs text-slate-500">{r.step}</div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-slate-400 text-sm">
                  No timeline data for this period
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeReport === "emr" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              { label: "Total Data Pulls", value: "1,247", trend: "+12% vs last period", color: "text-blue-600" },
              { label: "Success Rate", value: "97.3%", trend: "+0.8% vs last period", color: "text-green-600" },
              { label: "Avg. Fields Extracted", value: "14.2 / 16", trend: "+1.1 vs last period", color: "text-indigo-600" },
              { label: "Avg. Field Confidence", value: "91.4%", trend: "+2.3% vs last period", color: "text-amber-600" },
            ].map(kpi => (
              <Card key={kpi.label} className="border-slate-200">
                <CardContent className="p-5">
                  <p className="text-xs text-slate-500 mb-1">{kpi.label}</p>
                  <p className={`text-3xl font-bold ${kpi.color}`}>{kpi.value}</p>
                  <p className="text-xs text-green-600 mt-1">{kpi.trend}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
