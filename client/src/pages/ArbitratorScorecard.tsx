import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Star, Search, TrendingUp, TrendingDown, Minus, Award, BarChart3 } from "lucide-react";

interface EntityCaseload {
  entityId: string;
  entityName: string;
  totalCases: number;
  resolvedCases: number;
  avgDaysToResolution: number;
  providerFavorableRate: number;
  payerFavorableRate: number;
  splitRate: number;
  avgDeterminationAmount: number;
}

function StarRating({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star
          key={i}
          size={12}
          className={i <= Math.round(value) ? "text-amber-400 fill-amber-400" : "text-slate-200 fill-slate-200"}
        />
      ))}
      <span className="text-xs text-slate-500 ml-1">{value.toFixed(1)}</span>
    </div>
  );
}

function TrendIcon({ value }: { value: number }) {
  if (value > 55) return <TrendingUp size={14} className="text-green-500" />;
  if (value < 45) return <TrendingDown size={14} className="text-red-500" />;
  return <Minus size={14} className="text-slate-400" />;
}

function computeScore(entity: EntityCaseload): number {
  // Composite score: speed (lower days = better), resolution rate, balanced outcomes
  const speedScore = Math.max(0, 5 - (entity.avgDaysToResolution / 10));
  const resolutionScore = (entity.resolvedCases / Math.max(entity.totalCases, 1)) * 5;
  const balanceScore = 5 - Math.abs(entity.providerFavorableRate - 50) / 10;
  return Math.min(5, (speedScore + resolutionScore + balanceScore) / 3);
}

export default function ArbitratorScorecard() {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"score" | "cases" | "speed">("score");

  const { data: caseloads, isLoading } = trpc.arbitrators.allCaseloads.useQuery();

  const entities: EntityCaseload[] = (caseloads ?? []).map((e: any) => ({
    entityId: e.entityId ?? e.id,
    entityName: e.entityName ?? e.name,
    totalCases: e.totalCases ?? 0,
    resolvedCases: e.resolvedCases ?? 0,
    avgDaysToResolution: e.avgDaysToResolution ?? 0,
    providerFavorableRate: e.providerFavorableRate ?? 50,
    payerFavorableRate: e.payerFavorableRate ?? 50,
    splitRate: e.splitRate ?? 0,
    avgDeterminationAmount: e.avgDeterminationAmount ?? 0,
  }));

  const filtered = entities
    .filter(e => search === "" || e.entityName.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === "score") return computeScore(b) - computeScore(a);
      if (sortBy === "cases") return b.totalCases - a.totalCases;
      return a.avgDaysToResolution - b.avgDaysToResolution;
    });

  return (
    <DashboardLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-100">
              <Award size={20} className="text-amber-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800">Arbitrator Scorecard</h1>
              <p className="text-sm text-slate-500">Track and compare IDR entity performance across disputes</p>
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
            <Input
              placeholder="Search IDR entities..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 text-sm"
            />
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <span>Sort by:</span>
            {(["score", "cases", "speed"] as const).map(s => (
              <button
                key={s}
                onClick={() => setSortBy(s)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${sortBy === s ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              >
                {s === "score" ? "Score" : s === "cases" ? "Volume" : "Speed"}
              </button>
            ))}
          </div>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total IDR Entities", value: entities.length, icon: Award, color: "text-blue-600 bg-blue-50" },
            { label: "Total Cases", value: entities.reduce((s, e) => s + e.totalCases, 0), icon: BarChart3, color: "text-purple-600 bg-purple-50" },
            { label: "Avg Resolution Days", value: entities.length > 0 ? Math.round(entities.reduce((s, e) => s + e.avgDaysToResolution, 0) / entities.length) : 0, icon: TrendingUp, color: "text-green-600 bg-green-50" },
            { label: "Avg Score", value: entities.length > 0 ? (entities.reduce((s, e) => s + computeScore(e), 0) / entities.length).toFixed(1) : "—", icon: Star, color: "text-amber-600 bg-amber-50" },
          ].map(stat => (
            <Card key={stat.label} className="border-slate-200">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <div className={`p-1.5 rounded-lg ${stat.color.split(" ")[1]}`}>
                    <stat.icon size={14} className={stat.color.split(" ")[0]} />
                  </div>
                  <span className="text-xs text-slate-500">{stat.label}</span>
                </div>
                <div className="text-2xl font-bold text-slate-800">{stat.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Scorecard Table */}
        {isLoading ? (
          <Card className="border-slate-200">
            <CardContent className="py-12 text-center text-sm text-slate-400">Loading IDR entity data...</CardContent>
          </Card>
        ) : filtered.length === 0 ? (
          <Card className="border-slate-200">
            <CardContent className="py-12 text-center text-sm text-slate-400">No IDR entities found</CardContent>
          </Card>
        ) : (
          <Card className="border-slate-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-700">IDR Entity Performance</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">Entity</th>
                      <th className="text-center px-3 py-2 text-xs font-semibold text-slate-500">Score</th>
                      <th className="text-center px-3 py-2 text-xs font-semibold text-slate-500">Cases</th>
                      <th className="text-center px-3 py-2 text-xs font-semibold text-slate-500">Resolved</th>
                      <th className="text-center px-3 py-2 text-xs font-semibold text-slate-500">Avg Days</th>
                      <th className="text-center px-3 py-2 text-xs font-semibold text-slate-500">Provider Win%</th>
                      <th className="text-center px-3 py-2 text-xs font-semibold text-slate-500">Payer Win%</th>
                      <th className="text-right px-4 py-2 text-xs font-semibold text-slate-500">Avg Award</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((entity, idx) => {
                      const score = computeScore(entity);
                      const resolutionRate = entity.totalCases > 0 ? Math.round((entity.resolvedCases / entity.totalCases) * 100) : 0;
                      return (
                        <tr key={entity.entityId} className={`border-b border-slate-50 hover:bg-slate-50 transition-colors ${idx === 0 ? "bg-amber-50/30" : ""}`}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {idx === 0 && <Award size={12} className="text-amber-500 shrink-0" />}
                              <span className="font-medium text-slate-800 text-xs">{entity.entityName}</span>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-center">
                            <StarRating value={score} />
                          </td>
                          <td className="px-3 py-3 text-center">
                            <span className="text-slate-700 font-medium">{entity.totalCases}</span>
                          </td>
                          <td className="px-3 py-3 text-center">
                            <Badge className={`text-xs ${resolutionRate >= 80 ? "bg-green-100 text-green-700" : resolutionRate >= 50 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"}`}>
                              {resolutionRate}%
                            </Badge>
                          </td>
                          <td className="px-3 py-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <span className={`text-xs font-medium ${entity.avgDaysToResolution <= 30 ? "text-green-600" : entity.avgDaysToResolution <= 60 ? "text-yellow-600" : "text-red-600"}`}>
                                {entity.avgDaysToResolution}d
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <TrendIcon value={entity.providerFavorableRate} />
                              <span className="text-xs text-slate-700">{entity.providerFavorableRate.toFixed(0)}%</span>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <TrendIcon value={entity.payerFavorableRate} />
                              <span className="text-xs text-slate-700">{entity.payerFavorableRate.toFixed(0)}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="text-xs font-medium text-slate-700">
                              {entity.avgDeterminationAmount > 0 ? `$${entity.avgDeterminationAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
