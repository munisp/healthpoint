import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_LOGO, APP_TITLE } from "@/const";
import {
  AlertTriangle, ArrowLeft, Building2, CheckCircle2, ChevronDown,
  ChevronRight, Clock, LogOut, RefreshCw, Shield, TrendingUp, Users,
} from "lucide-react";

// ─── Capacity status colour config ───────────────────────────────────────────
const CAPACITY_CONFIG = {
  available: {
    bg: "bg-green-50",
    border: "border-green-200",
    text: "text-green-700",
    badge: "bg-green-100 text-green-800",
    bar: "bg-green-500",
    label: "Available",
    icon: CheckCircle2,
  },
  near_capacity: {
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-700",
    badge: "bg-amber-100 text-amber-800",
    bar: "bg-amber-500",
    label: "Near Capacity",
    icon: AlertTriangle,
  },
  at_capacity: {
    bg: "bg-orange-50",
    border: "border-orange-200",
    text: "text-orange-700",
    badge: "bg-orange-100 text-orange-800",
    bar: "bg-orange-500",
    label: "At Capacity",
    icon: AlertTriangle,
  },
  over_capacity: {
    bg: "bg-red-50",
    border: "border-red-200",
    text: "text-red-700",
    badge: "bg-red-100 text-red-800",
    bar: "bg-red-500",
    label: "Over Capacity",
    icon: AlertTriangle,
  },
};

// ─── Step label formatter ─────────────────────────────────────────────────────
function formatStep(step: string): string {
  return step
    .replace(/^STEP_\d+_/, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Utilisation gauge ────────────────────────────────────────────────────────
function UtilisationGauge({ pct, status }: { pct: number; status: string }) {
  const cfg = CAPACITY_CONFIG[status as keyof typeof CAPACITY_CONFIG] ?? CAPACITY_CONFIG.available;
  const clamped = Math.min(pct, 100);
  // SVG arc parameters
  const r = 40;
  const cx = 56;
  const cy = 56;
  const circumference = Math.PI * r; // half-circle
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <svg width="112" height="64" viewBox="0 0 112 64">
        {/* Track */}
        <path
          d={`M 16 56 A ${r} ${r} 0 0 1 96 56`}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth="10"
          strokeLinecap="round"
        />
        {/* Fill */}
        <path
          d={`M 16 56 A ${r} ${r} 0 0 1 96 56`}
          fill="none"
          stroke={pct >= 100 ? "#ef4444" : pct >= 90 ? "#f97316" : pct >= 75 ? "#f59e0b" : "#22c55e"}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
        <text x={cx} y={52} textAnchor="middle" className="text-sm font-bold" fontSize="14" fontWeight="700" fill="#1e293b">
          {pct}%
        </text>
      </svg>
      <span className={`text-xs font-medium mt-1 ${cfg.text}`}>{cfg.label}</span>
    </div>
  );
}

// ─── Entity card ──────────────────────────────────────────────────────────────
function EntityCard({ caseload }: { caseload: any }) {
  const [expanded, setExpanded] = useState(false);
  const { entity, activeCases, stepBreakdown, overdueCount, utilizationPct, capacityStatus } = caseload;
  const cfg = CAPACITY_CONFIG[capacityStatus as keyof typeof CAPACITY_CONFIG] ?? CAPACITY_CONFIG.available;
  const StatusIcon = cfg.icon;

  return (
    <Card className={`border ${cfg.border} transition-shadow hover:shadow-md`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className={`p-2 rounded-lg ${cfg.bg}`}>
              <Building2 size={18} className={cfg.text} />
            </div>
            <div>
              <CardTitle className="text-base font-semibold text-slate-800">{entity.name}</CardTitle>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-slate-500 font-mono">{entity.certificationNumber ?? "—"}</span>
                {entity.certificationExpiry && (
                  <span className="text-xs text-slate-400">
                    Expires {new Date(entity.certificationExpiry).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
          </div>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex items-center gap-1 ${cfg.badge}`}>
            <StatusIcon size={10} />
            {cfg.label}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* KPI row */}
        <div className="grid grid-cols-4 gap-3">
          <div className="text-center">
            <div className="text-xl font-bold text-slate-800">{entity.currentActiveCases}</div>
            <div className="text-xs text-slate-500">Active Cases</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold text-slate-800">{entity.maxConcurrentCases}</div>
            <div className="text-xs text-slate-500">Capacity</div>
          </div>
          <div className="text-center">
            <div className={`text-xl font-bold ${overdueCount > 0 ? "text-red-600" : "text-slate-800"}`}>
              {overdueCount}
            </div>
            <div className="text-xs text-slate-500">Overdue</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold text-slate-800">{entity.avgResolutionDays ?? "—"}</div>
            <div className="text-xs text-slate-500">Avg Days</div>
          </div>
        </div>

        {/* Utilisation gauge + bar */}
        <div className="flex items-center gap-4">
          <UtilisationGauge pct={utilizationPct} status={capacityStatus} />
          <div className="flex-1 space-y-1.5">
            <div className="flex justify-between text-xs text-slate-500 mb-0.5">
              <span>Capacity utilisation</span>
              <span>{entity.currentActiveCases} / {entity.maxConcurrentCases}</span>
            </div>
            <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${cfg.bar}`}
                style={{ width: `${Math.min(utilizationPct, 100)}%` }}
              />
            </div>
            {utilizationPct > 100 && (
              <div className="text-xs text-red-600 font-medium">
                ⚠ {entity.currentActiveCases - entity.maxConcurrentCases} cases over configured limit
              </div>
            )}
          </div>
        </div>

        {/* Step breakdown */}
        {Object.keys(stepBreakdown).length > 0 && (
          <div>
            <div className="text-xs font-medium text-slate-600 mb-2">Cases by Step</div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(stepBreakdown).map(([step, count]) => (
                <span key={step} className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">
                  {formatStep(step)}: <strong>{count as number}</strong>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Specialties + states */}
        <div className="flex flex-wrap gap-1">
          {entity.specialties?.slice(0, 4).map((s: string) => (
            <Badge key={s} variant="outline" className="text-xs capitalize">
              {s.replace(/_/g, " ")}
            </Badge>
          ))}
          {(entity.specialties?.length ?? 0) > 4 && (
            <Badge variant="outline" className="text-xs">+{entity.specialties.length - 4} more</Badge>
          )}
        </div>

        {/* Expand / collapse active cases */}
        {activeCases.length > 0 && (
          <div>
            <button
              onClick={() => setExpanded(e => !e)}
              className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              {expanded ? "Hide" : "Show"} {activeCases.length} active case{activeCases.length !== 1 ? "s" : ""}
            </button>

            {expanded && (
              <div className="mt-2 space-y-1.5 max-h-64 overflow-y-auto">
                {activeCases.map((c: any) => {
                  const isOverdue = (c.determinationDeadline && new Date(c.determinationDeadline) < new Date()) ||
                    (c.offerSubmissionDeadline && new Date(c.offerSubmissionDeadline) < new Date());
                  return (
                    <div
                      key={c.id}
                      className={`flex items-center justify-between text-xs rounded-lg px-3 py-2 ${
                        isOverdue ? "bg-red-50 border border-red-200" : "bg-slate-50 border border-slate-200"
                      }`}
                    >
                      <div>
                        <span className="font-mono font-medium text-slate-700">{c.referenceNumber}</span>
                        <span className="text-slate-400 mx-1.5">·</span>
                        <span className="text-slate-500">{c.initiatingPartyName}</span>
                        {c.respondingPartyName && (
                          <span className="text-slate-400"> vs {c.respondingPartyName}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-slate-500">{formatStep(c.currentStep)}</span>
                        {isOverdue && (
                          <span className="text-red-600 flex items-center gap-0.5">
                            <Clock size={10} /> Overdue
                          </span>
                        )}
                        <span className="font-medium text-slate-700">
                          ${parseFloat(c.billedAmount).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeCases.length === 0 && (
          <div className="text-xs text-slate-400 text-center py-2">No active cases assigned</div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function IDREntityDashboard() {
  const [, navigate] = useLocation();
  const { user, logout } = useAuth();

  const { data: caseloads, isLoading, refetch, isFetching } = trpc.arbitrators.allCaseloads.useQuery(undefined, {
    refetchInterval: 30_000, // auto-refresh every 30 s
  });

  // ─── Summary KPIs ─────────────────────────────────────────────────────────
  const totalEntities = caseloads?.length ?? 0;
  const totalActive = caseloads?.reduce((s, c) => s + c.entity.currentActiveCases, 0) ?? 0;
  const totalCapacity = caseloads?.reduce((s, c) => s + c.entity.maxConcurrentCases, 0) ?? 0;
  const totalOverdue = caseloads?.reduce((s, c) => s + c.overdueCount, 0) ?? 0;
  const atOrOverCapacity = caseloads?.filter(c => c.capacityStatus === "at_capacity" || c.capacityStatus === "over_capacity").length ?? 0;
  const overallUtilisation = totalCapacity > 0 ? Math.round((totalActive / totalCapacity) * 100) : 0;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 h-14 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <img src={APP_LOGO} className="h-8 w-8 rounded-lg object-cover" alt="logo" />
          <span className="text-lg font-bold text-slate-800">{APP_TITLE}</span>
        </div>
        <nav className="flex items-center gap-4">
          <button onClick={() => navigate("/dashboard")} className="text-sm text-slate-600 hover:text-blue-600">
            ← Dashboard
          </button>
          <button onClick={() => navigate("/disputes")} className="text-sm text-slate-600 hover:text-blue-600">
            Disputes
          </button>
          <span className="text-sm text-slate-600">{user?.name}</span>
          <Button variant="outline" size="sm" onClick={logout}><LogOut size={14} /></Button>
        </nav>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Page title */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/dashboard")} className="text-slate-400 hover:text-slate-600">
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Certified IDR Entity Dashboard</h1>
              <p className="text-sm text-slate-500">
                Active caseload vs. configured capacity limits — auto-refreshes every 30 seconds
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-2"
          >
            <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
            Refresh
          </Button>
        </div>

        {/* Summary KPI bar */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          {[
            { label: "Certified Entities", value: totalEntities, icon: Shield, color: "text-blue-600" },
            { label: "Total Active Cases", value: totalActive, icon: TrendingUp, color: "text-slate-700" },
            { label: "Total Capacity", value: totalCapacity, icon: Users, color: "text-slate-700" },
            { label: "Overall Utilisation", value: `${overallUtilisation}%`, icon: TrendingUp, color: overallUtilisation >= 90 ? "text-red-600" : overallUtilisation >= 75 ? "text-amber-600" : "text-green-600" },
            { label: "Overdue Cases", value: totalOverdue, icon: Clock, color: totalOverdue > 0 ? "text-red-600" : "text-slate-700" },
            { label: "At/Over Capacity", value: atOrOverCapacity, icon: AlertTriangle, color: atOrOverCapacity > 0 ? "text-orange-600" : "text-slate-700" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label} className="border-slate-200">
              <CardContent className="p-4 text-center">
                <Icon size={16} className={`mx-auto mb-1.5 ${color}`} />
                <div className={`text-2xl font-bold ${color}`}>{value}</div>
                <div className="text-xs text-slate-500 mt-0.5">{label}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Capacity alerts */}
        {atOrOverCapacity > 0 && (
          <div className="mb-6 bg-orange-50 border border-orange-200 rounded-lg p-4 flex items-start gap-3">
            <AlertTriangle size={16} className="text-orange-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-orange-800">
                {atOrOverCapacity} IDR {atOrOverCapacity === 1 ? "entity is" : "entities are"} at or over capacity
              </p>
              <p className="text-xs text-orange-700 mt-0.5">
                New disputes should not be assigned to entities at or over capacity. Consider redistributing
                cases or requesting CMS to expand the certified entity pool.
              </p>
            </div>
          </div>
        )}

        {/* Entity cards */}
        {isLoading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {[1, 2, 3, 4].map(i => (
              <Card key={i} className="border-slate-200 animate-pulse">
                <CardContent className="p-6">
                  <div className="h-4 bg-slate-200 rounded w-3/4 mb-3" />
                  <div className="h-3 bg-slate-100 rounded w-1/2 mb-6" />
                  <div className="grid grid-cols-4 gap-3 mb-4">
                    {[1,2,3,4].map(j => <div key={j} className="h-10 bg-slate-100 rounded" />)}
                  </div>
                  <div className="h-3 bg-slate-100 rounded w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : caseloads && caseloads.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Sort: over_capacity first, then at_capacity, then near_capacity, then available */}
            {[...caseloads]
              .sort((a, b) => {
                const order = { over_capacity: 0, at_capacity: 1, near_capacity: 2, available: 3 };
                return (order[a.capacityStatus as keyof typeof order] ?? 3) -
                       (order[b.capacityStatus as keyof typeof order] ?? 3);
              })
              .map(caseload => (
                <EntityCard key={caseload.entity.id} caseload={caseload} />
              ))
            }
          </div>
        ) : (
          <div className="text-center py-16 text-slate-400">
            <Shield size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">No certified IDR entities found. Entities are seeded on first arbitrator selection.</p>
          </div>
        )}

        {/* Regulatory footnote */}
        <div className="mt-8 text-xs text-slate-400 text-center">
          Capacity limits are configured per entity in the IDR entity registry. Per 45 CFR §149.510(c)(1),
          parties must jointly select a certified IDR entity within 4 business days of IDR initiation.
          Entities at capacity may decline new assignments.
        </div>
      </main>
    </div>
  );
}
