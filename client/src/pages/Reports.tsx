import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import DashboardLayout from "@/components/DashboardLayout";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, Sector
} from "recharts";
import {
  BarChart2, Download, RefreshCw, TrendingUp, DollarSign,
  Clock, CheckCircle2, AlertTriangle, FileText
} from "lucide-react";

const COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];

const REPORT_TYPES = [
  { id: "volume", label: "Dispute Volume", icon: BarChart2, description: "Monthly dispute counts by status and service type" },
  { id: "financial", label: "Financial Summary", icon: DollarSign, description: "Billed vs. QPA vs. determination amounts" },
  { id: "outcomes", label: "Outcome Analysis", icon: TrendingUp, description: "Win rates, determination trends, and appeal rates" },
  { id: "timeline", label: "Timeline Compliance", icon: Clock, description: "Step completion times vs. NSA statutory deadlines" },
  { id: "emr", label: "EMR Integration", icon: CheckCircle2, description: "Data pull success rates and field extraction quality" },
];

// Mock report data — in production these would come from tRPC procedures
const MOCK_VOLUME_DATA = [
  { month: "Jan", open_negotiation: 12, idr_active: 8, closed: 15, ineligible: 3 },
  { month: "Feb", open_negotiation: 15, idr_active: 11, closed: 18, ineligible: 2 },
  { month: "Mar", open_negotiation: 9, idr_active: 14, closed: 22, ineligible: 4 },
  { month: "Apr", open_negotiation: 18, idr_active: 9, closed: 19, ineligible: 1 },
  { month: "May", open_negotiation: 21, idr_active: 16, closed: 25, ineligible: 3 },
  { month: "Jun", open_negotiation: 17, idr_active: 13, closed: 28, ineligible: 2 },
];

const MOCK_FINANCIAL_DATA = [
  { serviceType: "Emergency", avgBilled: 4200, avgQPA: 2800, avgDetermination: 3100 },
  { serviceType: "Anesthesiology", avgBilled: 6800, avgQPA: 4200, avgDetermination: 4900 },
  { serviceType: "Air Ambulance", avgBilled: 38000, avgQPA: 22000, avgDetermination: 26500 },
  { serviceType: "Radiology", avgBilled: 2100, avgQPA: 1400, avgDetermination: 1650 },
  { serviceType: "Pathology", avgBilled: 1800, avgQPA: 1100, avgDetermination: 1300 },
];

const MOCK_OUTCOME_DATA = [
  { month: "Jan", winRate: 0.72, determinationRate: 0.85, appealRate: 0.08 },
  { month: "Feb", winRate: 0.68, determinationRate: 0.82, appealRate: 0.11 },
  { month: "Mar", winRate: 0.75, determinationRate: 0.88, appealRate: 0.07 },
  { month: "Apr", winRate: 0.71, determinationRate: 0.84, appealRate: 0.09 },
  { month: "May", winRate: 0.79, determinationRate: 0.91, appealRate: 0.06 },
  { month: "Jun", winRate: 0.77, determinationRate: 0.89, appealRate: 0.07 },
];

const MOCK_TIMELINE_DATA = [
  { step: "Open Neg.", statutory: 30, actual: 24, onTime: 0.88 },
  { step: "IDR Init.", statutory: 4, actual: 3.2, onTime: 0.94 },
  { step: "Entity Sel.", statutory: 4, actual: 3.8, onTime: 0.91 },
  { step: "Eligibility", statutory: 3, actual: 2.9, onTime: 0.97 },
  { step: "Offer Sub.", statutory: 10, actual: 8.4, onTime: 0.93 },
  { step: "Determination", statutory: 30, actual: 26, onTime: 0.89 },
];

const MOCK_SERVICE_PIE = [
  { name: "Emergency Medicine", value: 34 },
  { name: "Anesthesiology", value: 22 },
  { name: "Air Ambulance", value: 18 },
  { name: "Radiology", value: 12 },
  { name: "Pathology", value: 8 },
  { name: "Other", value: 6 },
];

export default function Reports() {
  const { isAuthenticated } = useAuth();
  const [activeReport, setActiveReport] = useState("volume");
  const [dateRange, setDateRange] = useState("6m");

  const { data: stats } = trpc.dashboard.stats.useQuery(undefined, { enabled: isAuthenticated });
  const { data: outcomeData } = trpc.dashboard.outcomeAnalytics.useQuery(undefined, { enabled: isAuthenticated });

  const handleExport = (format: "csv" | "pdf") => {
    toast.success(`Exporting ${activeReport} report as ${format.toUpperCase()}…`);
  };

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
            <Button size="sm" variant="outline" onClick={() => handleExport("csv")}>
              <Download size={13} className="mr-1.5" />CSV
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleExport("pdf")}>
              <FileText size={13} className="mr-1.5" />PDF
            </Button>
          </div>
        </div>

        {/* KPI Summary Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Disputes", value: stats?.total ?? "—", icon: BarChart2, color: "text-blue-600" },
            { label: "Active IDR", value: stats?.inIDR ?? "—", icon: Clock, color: "text-purple-600" },
            { label: "Closed This Month", value: stats?.closedThisMonth ?? "—", icon: CheckCircle2, color: "text-green-600" },
            { label: "Overall Win Rate", value: outcomeData?.overallWinRate != null ? `${Math.round(outcomeData.overallWinRate * 100)}%` : "—", icon: TrendingUp, color: "text-amber-600" },
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
                  <BarChart data={MOCK_VOLUME_DATA} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
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
              </CardContent>
            </Card>
            <Card className="border-slate-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold text-slate-800">Volume by Service Type</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={MOCK_SERVICE_PIE} cx="50%" cy="50%" innerRadius={55} outerRadius={90} dataKey="value" label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`} labelLine={false}>
                      {MOCK_SERVICE_PIE.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => `${v} disputes`} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1 mt-2">
                  {MOCK_SERVICE_PIE.map((item, i) => (
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
                <BarChart data={MOCK_FINANCIAL_DATA} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
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
                <LineChart data={MOCK_OUTCOME_DATA} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} domain={[0, 1]} />
                  <Tooltip formatter={(v: number) => `${Math.round(v * 100)}%`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="winRate" name="Win Rate" stroke="#22c55e" strokeWidth={2} dot={{ r: 4 }} />
                  <Line type="monotone" dataKey="determinationRate" name="Determination Rate" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
                  <Line type="monotone" dataKey="appealRate" name="Appeal Rate" stroke="#ef4444" strokeWidth={2} dot={{ r: 4 }} />
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
                <BarChart data={MOCK_TIMELINE_DATA} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
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
                {MOCK_TIMELINE_DATA.map(row => (
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
