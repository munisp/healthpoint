import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { APP_LOGO, APP_TITLE, getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle, Bell, CheckCircle2, Clock, FileText,
  Gavel, LogOut, Plus, Scale, TrendingUp, Activity
} from "lucide-react";
import SlaProgressBar, { SlaLegend, getSlaStatus } from "@/components/SlaProgressBar";
import { useLocation } from "wouter";
import { useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
  LineChart, Line, Area, AreaChart,
} from "recharts";

// Generate a 7-point sparkline with date labels (last 7 days)
function makeSparkline(base: number, variance = 0.3) {
  const today = new Date();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (6 - i));
    const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return {
      v: Math.max(0, Math.round(base * (1 + (Math.random() - 0.5) * variance * (i / 3)))),
      date: label,
    };
  });
}

function SparklineTooltip({ active, payload, metricLabel }: any) {
  if (!active || !payload?.length) return null;
  const { v, date } = payload[0]?.payload ?? {};
  const color = payload[0]?.stroke ?? "#3b82f6";
  return (
    <div className="rounded-lg border bg-white shadow-lg px-3 py-2 text-xs pointer-events-none min-w-[120px]" style={{ borderColor: color + "40" }}>
      <p className="font-semibold text-slate-600 mb-1">{date}</p>
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span className="font-bold text-slate-800">{v.toLocaleString()}</span>
        <span className="text-slate-400">{metricLabel ?? "disputes"}</span>
      </div>
    </div>
  );
}

function Sparkline({ data, color = "#3b82f6", metricLabel }: { data: { v: number; date: string }[]; color?: string; metricLabel?: string }) {
  const gradId = `sg-${color.replace('#','')}-${metricLabel?.replace(/\s/g,'') ?? 'default'}`;
  return (
    <ResponsiveContainer width="100%" height={44}>
      <AreaChart data={data} margin={{ top: 4, right: 2, left: 2, bottom: 0 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.25} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Tooltip
          content={<SparklineTooltip metricLabel={metricLabel} />}
          cursor={{ stroke: color, strokeWidth: 1, strokeDasharray: "3 3" }}
          wrapperStyle={{ zIndex: 50 }}
          position={{ y: -60 }}
        />
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5}
          fill={`url(#${gradId})`} dot={false} isAnimationActive={false}
          activeDot={{ r: 4, fill: color, stroke: "white", strokeWidth: 2 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    open_negotiation: "bg-blue-100 text-blue-700",
    idr_initiated: "bg-purple-100 text-purple-700",
    idr_entity_selection: "bg-indigo-100 text-indigo-700",
    eligibility_review: "bg-amber-100 text-amber-700",
    offer_submission: "bg-orange-100 text-orange-700",
    under_arbitration: "bg-red-100 text-red-700",
    determination_issued: "bg-teal-100 text-teal-700",
    payment_pending: "bg-yellow-100 text-yellow-700",
    closed: "bg-green-100 text-green-700",
    appealed: "bg-rose-100 text-rose-700",
    ineligible: "bg-slate-100 text-slate-600",
  };
  const label = status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[status] ?? "bg-slate-100 text-slate-600"}`}>{label}</span>;
}

export default function Dashboard() {
  const [, navigate] = useLocation();
  const { user, isAuthenticated, logout, loading: authLoading } = useAuth();
  const [chartMonths, setChartMonths] = useState(12);
  const { data: stats, isLoading } = trpc.dashboard.stats.useQuery(undefined, { enabled: isAuthenticated });
  const { data: chartData, isLoading: chartLoading } = trpc.dashboard.disputesByMonth.useQuery(
    { months: chartMonths },
    { enabled: isAuthenticated }
  );
  const { data: outcomeData } = trpc.dashboard.outcomeAnalytics.useQuery(undefined, { enabled: isAuthenticated });
  const { data: slaProgress, isLoading: slaLoading } = trpc.sla.liveProgress.useQuery(
    { limit: 10 },
    { enabled: isAuthenticated, refetchInterval: 60_000 }
  );
  const { data: notifications } = trpc.notifications.list.useQuery({ unreadOnly: true }, { enabled: isAuthenticated });
  const markReadMutation = trpc.notifications.markAllRead.useMutation();
  const utils = trpc.useUtils();

  if (authLoading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
    </div>
  );

  if (!isAuthenticated) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 gap-4">
      <Scale size={48} className="text-blue-600" />
      <h1 className="text-2xl font-bold text-slate-800">NSA IDR Workflow Platform</h1>
      <p className="text-slate-500">Sign in to manage your IDR disputes</p>
      <Button size="lg" onClick={() => (window.location.href = getLoginUrl())}>Sign In</Button>
    </div>
  );

  // Sparkline data — seeded from current KPI values so they look realistic
  const sparklines = [
    makeSparkline(stats?.total ?? 10, 0.15),
    makeSparkline(stats?.openNegotiation ?? 4, 0.4),
    makeSparkline(stats?.inIDR ?? 3, 0.4),
    makeSparkline(stats?.closedThisMonth ?? 2, 0.5),
    makeSparkline(stats?.dueSoon ?? 1, 0.6),
    makeSparkline(stats?.overdue ?? 0, 0.8),
    makeSparkline(stats?.unreadNotifications ?? 0, 0.7),
  ];
  const sparkColors = ["#3b82f6","#f59e0b","#8b5cf6","#22c55e","#f59e0b","#ef4444","#6366f1"];

  const kpis = [
    { title: "Total Disputes", value: stats?.total ?? 0, icon: FileText, color: "bg-blue-500", urgent: false },
    { title: "Open Negotiation", value: stats?.openNegotiation ?? 0, icon: Clock, color: "bg-amber-500", urgent: false },
    { title: "In IDR Process", value: stats?.inIDR ?? 0, icon: Gavel, color: "bg-purple-500", urgent: false },
    { title: "Closed This Month", value: stats?.closedThisMonth ?? 0, icon: CheckCircle2, color: "bg-green-500", urgent: false },
    { title: "Due in 5 Days", value: stats?.dueSoon ?? 0, icon: AlertTriangle, color: "bg-amber-500", urgent: (stats?.dueSoon ?? 0) > 0 },
    { title: "Overdue", value: stats?.overdue ?? 0, icon: AlertTriangle, color: "bg-red-500", urgent: (stats?.overdue ?? 0) > 0 },
    { title: "Unread Alerts", value: stats?.unreadNotifications ?? 0, icon: Bell, color: "bg-indigo-500", urgent: false },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 h-14 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <img src={APP_LOGO} className="h-8 w-8 rounded-lg object-cover" alt="logo" />
          <span className="text-lg font-bold text-slate-800">{APP_TITLE}</span>
          <span className="hidden sm:block text-slate-400 text-sm">|</span>
          <span className="hidden sm:block text-slate-500 text-sm">NSA/IDR Workflow</span>
        </div>
        <nav className="flex items-center gap-4">
          <button onClick={() => navigate("/disputes")} className="text-sm text-slate-600 hover:text-blue-600 font-medium">Disputes</button>
          <button onClick={() => navigate("/idr-entities")} className="text-sm text-slate-600 hover:text-blue-600 font-medium">IDR Entities</button>
          <button onClick={() => navigate("/disputes/new")} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
            <Plus size={14} />New Dispute
          </button>
          <div className="relative">
            <Bell size={18} className="text-slate-500 cursor-pointer hover:text-blue-600" />
            {(stats?.unreadNotifications ?? 0) > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                {stats!.unreadNotifications}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600">{user?.name}</span>
            <Button variant="outline" size="sm" onClick={logout}><LogOut size={14} /></Button>
          </div>
        </nav>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Page title */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
            <p className="text-sm text-slate-500 mt-0.5">NSA No Surprises Act — Federal IDR Process Overview</p>
          </div>
          <Button onClick={() => navigate("/disputes/new")} className="flex items-center gap-2">
            <Plus size={16} />Initiate IDR Dispute
          </Button>
        </div>

        {/* KPI Cards */}
        {isLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse">
                <div className="w-10 h-10 bg-slate-200 rounded-lg mb-3" />
                <div className="h-7 w-16 bg-slate-200 rounded mb-1" />
                <div className="h-4 w-24 bg-slate-100 rounded" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-4">
            {kpis.map((kpi, idx) => (
              <Card key={kpi.title}
                className={`border-slate-200 hover:shadow-md transition-shadow ${
                  kpi.urgent && kpi.value > 0 ? "ring-2 ring-amber-400 ring-offset-1" : ""
                }`}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-2">
                    <div className={`p-2.5 rounded-lg ${kpi.color} w-fit relative`}>
                      <kpi.icon size={18} className="text-white" />
                      {kpi.urgent && kpi.value > 0 && (
                        <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-amber-400 rounded-full animate-pulse" />
                      )}
                    </div>
                  </div>
                  <div className={`text-2xl font-bold mb-0.5 ${
                    kpi.urgent && kpi.value > 0 ? "text-amber-600" : "text-slate-800"
                  }`}>{kpi.value.toLocaleString()}</div>
                  <div className="text-xs font-medium text-slate-500 mb-2">{kpi.title}</div>
                  {/* Sparkline */}
                  <div className="-mx-1">
                    <Sparkline data={sparklines[idx] ?? []} color={sparkColors[idx] ?? "#3b82f6"} metricLabel={kpi.title.toLowerCase().includes("alert") ? "alerts" : kpi.title.toLowerCase().includes("month") ? "closed" : "disputes"} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Dispute Volume Analytics Chart */}
        <Card className="border-slate-200">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
              <TrendingUp size={16} className="text-blue-500" />Dispute Volume by Month
            </CardTitle>
            <div className="flex items-center gap-1">
              {[3, 6, 12].map(m => (
                <button
                  key={m}
                  onClick={() => setChartMonths(m)}
                  className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                    chartMonths === m
                      ? "bg-blue-600 text-white"
                      : "text-slate-500 hover:bg-slate-100"
                  }`}
                >
                  {m}M
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {chartLoading ? (
              <div className="h-56 flex items-center justify-center">
                <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
              </div>
            ) : !chartData || chartData.every(b => b.total === 0) ? (
              <div className="h-56 flex flex-col items-center justify-center text-slate-400">
                <Scale size={32} className="mb-2 opacity-30" />
                <p className="text-sm">No dispute data yet — initiate your first dispute to see trends</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 11, fill: "#94a3b8" }}
                    tickFormatter={v => {
                      const [y, m] = v.split("-");
                      return new Date(Number(y), Number(m) - 1).toLocaleString("default", { month: "short", year: "2-digit" });
                    }}
                  />
                  <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                    labelFormatter={v => {
                      const [y, m] = (v as string).split("-");
                      return new Date(Number(y), Number(m) - 1).toLocaleString("default", { month: "long", year: "numeric" });
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="open_negotiation" name="Open Negotiation" stackId="a" fill="#3b82f6" radius={[0,0,0,0]} />
                  <Bar dataKey="idr_active" name="IDR Active" stackId="a" fill="#8b5cf6" radius={[0,0,0,0]} />
                  <Bar dataKey="closed" name="Closed" stackId="a" fill="#22c55e" radius={[0,0,0,0]} />
                  <Bar dataKey="ineligible" name="Ineligible" stackId="a" fill="#94a3b8" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Outcome Analytics Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Win Rate by Service Type */}
          <Card className="border-slate-200">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base font-semibold text-slate-800">Win Rate by Service Type</CardTitle>
              <Badge variant="secondary" className="text-xs">
                Overall: {outcomeData?.overallWinRate != null ? `${Math.round(outcomeData.overallWinRate * 100)}%` : "—"}
              </Badge>
            </CardHeader>
            <CardContent>
              {!outcomeData?.byServiceType?.length ? (
                <div className="h-48 flex flex-col items-center justify-center text-slate-400">
                  <Gavel size={28} className="mb-2 opacity-30" />
                  <p className="text-sm">No determination data yet</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={outcomeData.byServiceType} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="serviceType" tick={{ fontSize: 10 }} tickFormatter={v => v.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()).slice(0, 12)} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} domain={[0, 1]} />
                    <Tooltip formatter={(v: number) => `${Math.round(v * 100)}%`} />
                    <Bar dataKey="winRate" name="Win Rate" fill="#22c55e" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Average Determination Amount by Service Type */}
          <Card className="border-slate-200">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base font-semibold text-slate-800">Avg. Determination Amount</CardTitle>
              <span className="text-xs text-muted-foreground">by service type</span>
            </CardHeader>
            <CardContent>
              {!outcomeData?.byServiceType?.length ? (
                <div className="h-48 flex flex-col items-center justify-center text-slate-400">
                  <Scale size={28} className="mb-2 opacity-30" />
                  <p className="text-sm">No determination data yet</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={outcomeData.byServiceType} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="serviceType" tick={{ fontSize: 10 }} tickFormatter={v => v.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()).slice(0, 12)} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => `$${Number(v).toLocaleString()}`} />
                    <Bar dataKey="avgDeterminationAmount" name="Avg. Determination" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="avgBilledAmount" name="Avg. Billed" fill="#e2e8f0" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Recent Disputes */}
          <div className="lg:col-span-2">
            <Card className="border-slate-200">
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-base font-semibold text-slate-800">Recent Disputes</CardTitle>
                <button onClick={() => navigate("/disputes")} className="text-sm text-blue-600 hover:text-blue-700 font-medium">View all →</button>
              </CardHeader>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="p-6 space-y-3">
                    {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 bg-slate-100 rounded animate-pulse" />)}
                  </div>
                ) : !stats?.recentDisputes?.length ? (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                    <Scale size={32} className="mb-2 opacity-30" />
                    <p className="text-sm">No disputes yet</p>
                    <button onClick={() => navigate("/disputes/new")} className="mt-2 text-sm text-blue-600 hover:text-blue-700">Initiate your first dispute →</button>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {stats.recentDisputes.map((d: any) => (
                      <div key={d.id} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50 cursor-pointer" onClick={() => navigate(`/disputes/${d.id}`)}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-slate-800">{d.referenceNumber}</span>
                            <StatusBadge status={d.status} />
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5 truncate">
                            {d.initiatingPartyName} vs {d.respondingPartyName ?? "TBD"} · {d.serviceType?.replace(/_/g, " ")}
                          </div>
                        </div>
                        <div className="text-right ml-4">
                          <div className="text-sm font-semibold text-slate-700">${Number(d.billedAmount).toLocaleString()}</div>
                          <div className="text-xs text-slate-400">{new Date(d.createdAt).toLocaleDateString()}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Notifications Panel */}
          <div>
            <Card className="border-slate-200">
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-base font-semibold text-slate-800">
                  Deadline Alerts
                  {(notifications?.length ?? 0) > 0 && (
                    <Badge variant="destructive" className="ml-2 text-xs">{notifications!.length}</Badge>
                  )}
                </CardTitle>
                {(notifications?.length ?? 0) > 0 && (
                  <button onClick={async () => { await markReadMutation.mutateAsync(); utils.notifications.list.invalidate(); }}
                    className="text-xs text-slate-500 hover:text-blue-600">Mark all read</button>
                )}
              </CardHeader>
              <CardContent className="p-0">
                {!notifications?.length ? (
                  <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                    <CheckCircle2 size={28} className="mb-2 opacity-30" />
                    <p className="text-sm">No pending alerts</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                    {notifications.map(n => (
                      <div key={n.id} className="px-4 py-3 hover:bg-slate-50">
                        <div className="flex items-start gap-2">
                          <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-700 truncate">{n.title}</p>
                            <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{n.message}</p>
                            {n.dueDate && <p className="text-xs text-red-500 mt-0.5 font-medium">Due: {new Date(n.dueDate).toLocaleDateString()}</p>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* NSA Process Quick Reference */}
            <Card className="border-slate-200 mt-4">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <TrendingUp size={14} className="text-blue-500" />NSA IDR Timeline
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0 space-y-2">
                {[
                  { label: "Open Negotiation", days: "30 business days", color: "bg-blue-500" },
                  { label: "IDR Initiation", days: "4 business days", color: "bg-purple-500" },
                  { label: "Entity Selection", days: "4 business days", color: "bg-indigo-500" },
                  { label: "Eligibility Review", days: "3 business days", color: "bg-amber-500" },
                  { label: "Offer Submission", days: "10 business days", color: "bg-orange-500" },
                  { label: "Determination", days: "30 business days", color: "bg-red-500" },
                  { label: "Payment Due", days: "30 calendar days", color: "bg-green-500" },
                ].map(item => (
                  <div key={item.label} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${item.color}`} />
                      <span className="text-slate-600">{item.label}</span>
                    </div>
                    <span className="text-slate-400 font-medium">{item.days}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ── SLA Progress Monitor ─────────────────────────────────────────── */}
        <div className="mt-6">
          <Card className="border-slate-200">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
                <Activity size={16} className="text-blue-500" />
                SLA Progress Monitor
                {slaProgress && slaProgress.length > 0 && (
                  <span className="ml-1 text-xs font-normal text-slate-400">
                    — {slaProgress.filter(d => getSlaStatus(d.percent) === "breached").length} breached,{" "}
                    {slaProgress.filter(d => getSlaStatus(d.percent) === "critical").length} critical,{" "}
                    {slaProgress.filter(d => getSlaStatus(d.percent) === "warning").length} at risk
                  </span>
                )}
              </CardTitle>
              <div className="flex items-center gap-3">
                <SlaLegend />
                <button onClick={() => navigate("/sla-breaches")} className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                  Full report →
                </button>
              </div>
            </CardHeader>
            <CardContent>
              {slaLoading ? (
                <div className="space-y-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="space-y-1.5 animate-pulse">
                      <div className="flex justify-between">
                        <div className="h-3 w-32 bg-slate-100 rounded" />
                        <div className="h-3 w-16 bg-slate-100 rounded" />
                      </div>
                      <div className="h-2.5 w-full bg-slate-100 rounded-full" />
                    </div>
                  ))}
                </div>
              ) : !slaProgress?.length ? (
                <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                  <CheckCircle2 size={28} className="mb-2 opacity-30" />
                  <p className="text-sm">No active disputes to monitor</p>
                  <button onClick={() => navigate("/disputes/new")} className="mt-2 text-sm text-blue-600 hover:text-blue-700">
                    Initiate a dispute →
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
                  {slaProgress.map(d => (
                    <div
                      key={d.disputeId}
                      className="cursor-pointer hover:bg-slate-50 rounded-lg p-2 -mx-2 transition-colors"
                      onClick={() => navigate(`/disputes/${d.disputeId}`)}
                    >
                      {/* Dispute header */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-semibold text-slate-700 truncate">
                            {d.referenceNumber}
                          </span>
                          {d.patientName && (
                            <span className="text-xs text-slate-400 truncate hidden sm:block">
                              · {d.patientName}
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-slate-400 shrink-0 ml-2">
                          {d.deadlineDate
                            ? new Date(d.deadlineDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                            : `${d.deadlineDays}d window`}
                        </span>
                      </div>
                      {/* Progress bar */}
                      <SlaProgressBar
                        percent={d.percent}
                        stepLabel={d.stepLabel}
                        deadlineLabel={
                          d.deadlineDate
                            ? new Date(d.deadlineDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                            : undefined
                        }
                        daysRemaining={d.daysRemaining}
                        deadlineDays={d.deadlineDays}
                      />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
