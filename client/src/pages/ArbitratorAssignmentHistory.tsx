import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, History, ArrowRight, Building2, Calendar, Scale, Award } from "lucide-react";

export default function ArbitratorAssignmentHistory() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [filterEntity, setFilterEntity] = useState<string | null>(null);

  const { data: allDisputes, isLoading } = trpc.disputes.list.useQuery({ limit: 500 });
  const disputes = (allDisputes?.items ?? []) as any[];

  // Only show disputes that have been assigned to an IDR entity
  const assigned = disputes.filter(d => d.idrEntityId || d.idrEntityName);

  const filtered = assigned.filter(d =>
    (search === "" ||
      d.referenceNumber.toLowerCase().includes(search.toLowerCase()) ||
      d.initiatingPartyName.toLowerCase().includes(search.toLowerCase()) ||
      (d.idrEntityName ?? "").toLowerCase().includes(search.toLowerCase())) &&
    (filterEntity === null || d.idrEntityName === filterEntity)
  );

  const entityNames = Array.from(new Set(assigned.map((d) => d.idrEntityName).filter(Boolean)));

  // Entity assignment counts
  const entityCounts = entityNames.map(name => ({
    name,
    count: assigned.filter(d => d.idrEntityName === name).length,
  })).sort((a, b) => b.count - a.count);

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-indigo-100">
            <History size={20} className="text-indigo-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Arbitrator Assignment History</h1>
            <p className="text-sm text-slate-500">Track which IDR entity was assigned to each dispute</p>
          </div>
        </div>

        {/* Entity Summary Cards */}
        {entityCounts.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {entityCounts.slice(0, 4).map(ec => (
              <button
                key={ec.name}
                onClick={() => setFilterEntity(filterEntity === ec.name ? null : ec.name)}
                className={`p-3 rounded-xl border text-left transition-colors ${filterEntity === ec.name ? "border-indigo-400 bg-indigo-50" : "border-slate-200 bg-white hover:border-slate-300"}`}
              >
                <div className="flex items-center gap-1 mb-1">
                  <Award size={12} className="text-indigo-400" />
                  <span className="text-xs text-slate-500 truncate">{ec.name}</span>
                </div>
                <div className="text-xl font-bold text-slate-800">{ec.count}</div>
                <div className="text-xs text-slate-400">assignments</div>
              </button>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
            <Input
              placeholder="Search by reference, party, or entity..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 text-sm"
            />
          </div>
          {filterEntity && (
            <button
              onClick={() => setFilterEntity(null)}
              className="px-3 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
            >
              {filterEntity} ×
            </button>
          )}
        </div>

        {/* Table */}
        {isLoading ? (
          <Card className="border-slate-200">
            <CardContent className="py-12 text-center text-sm text-slate-400">Loading assignment history...</CardContent>
          </Card>
        ) : filtered.length === 0 ? (
          <Card className="border-slate-200">
            <CardContent className="py-12 text-center">
              <History size={24} className="text-slate-200 mx-auto mb-2" />
              <p className="text-sm text-slate-400">
                {assigned.length === 0 ? "No disputes have been assigned to an IDR entity yet." : "No assignments match your filters."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-slate-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-700">
                Assignment Records ({filtered.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">Dispute</th>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500">Initiating Party</th>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500">IDR Entity</th>
                      <th className="text-center px-3 py-2 text-xs font-semibold text-slate-500">Status</th>
                      <th className="text-center px-3 py-2 text-xs font-semibold text-slate-500">Service Date</th>
                      <th className="text-right px-4 py-2 text-xs font-semibold text-slate-500">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((d) => (
                      <tr key={d.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-xs text-slate-800">{d.referenceNumber}</div>
                          <div className="text-xs text-slate-400">{d.serviceType?.replace(/_/g, " ")}</div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1">
                            <Building2 size={10} className="text-slate-400 shrink-0" />
                            <span className="text-xs text-slate-700 truncate max-w-[140px]">{d.initiatingPartyName}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1">
                            <Award size={10} className="text-indigo-400 shrink-0" />
                            <span className="text-xs font-medium text-indigo-700 truncate max-w-[160px]">{d.idrEntityName ?? "—"}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <Badge className={`text-xs ${
                            d.status === "closed" ? "bg-slate-100 text-slate-600" :
                            d.status === "determination_issued" ? "bg-green-100 text-green-700" :
                            d.status === "idr_initiated" ? "bg-purple-100 text-purple-700" :
                            "bg-blue-100 text-blue-700"
                          }`}>
                            {d.status?.replace(/_/g, " ")}
                          </Badge>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <div className="flex items-center justify-center gap-1 text-xs text-slate-500">
                            <Calendar size={10} />
                            {d.serviceDate ? new Date(d.serviceDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => navigate(`/disputes/${d.id}`)}
                            className="text-slate-300 hover:text-blue-500 transition-colors"
                            title="View dispute"
                          >
                            <ArrowRight size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
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
