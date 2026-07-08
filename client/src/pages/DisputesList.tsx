import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { APP_LOGO, APP_TITLE, getLoginUrl } from "@/const";
import {
  AlertTriangle, Bell, ChevronLeft, ChevronRight,
  FileText, Gavel, LogOut, Plus, Scale, Search
} from "lucide-react";

const DISPUTE_STATUSES = [
  { value: "all", label: "All Disputes" },
  { value: "open_negotiation", label: "Open Negotiation" },
  { value: "idr_initiated", label: "IDR Initiated" },
  { value: "idr_entity_selection", label: "Entity Selection" },
  { value: "eligibility_review", label: "Eligibility Review" },
  { value: "offer_submission", label: "Offer Submission" },
  { value: "under_arbitration", label: "Under Arbitration" },
  { value: "determination_issued", label: "Determination Issued" },
  { value: "payment_pending", label: "Payment Pending" },
  { value: "closed", label: "Closed" },
  { value: "ineligible", label: "Ineligible" },
];

const STATUS_COLORS: Record<string, string> = {
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

const PAGE_SIZE = 20;

export default function DisputesList() {
  const [, navigate] = useLocation();
  const { user, isAuthenticated, logout, loading: authLoading } = useAuth();
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);

  const { data, isLoading } = trpc.disputes.list.useQuery(
    {
      status: statusFilter !== "all" ? (statusFilter as any) : undefined,
      search: search || undefined,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    },
    { enabled: isAuthenticated }
  );

  if (authLoading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
    </div>
  );

  if (!isAuthenticated) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 gap-4">
      <Scale size={48} className="text-blue-600" />
      <Button size="lg" onClick={() => (window.location.href = getLoginUrl())}>Sign In</Button>
    </div>
  );

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 h-14 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <img src={APP_LOGO} className="h-8 w-8 rounded-lg object-cover" alt="logo" />
          <span className="text-lg font-bold text-slate-800">{APP_TITLE}</span>
        </div>
        <nav className="flex items-center gap-4">
          <button onClick={() => navigate("/dashboard")} className="text-sm text-slate-600 hover:text-blue-600">Dashboard</button>
          <button onClick={() => navigate("/disputes/new")} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
            <Plus size={14} />New Dispute
          </button>
          <span className="text-sm text-slate-600">{user?.name}</span>
          <Button variant="outline" size="sm" onClick={logout}><LogOut size={14} /></Button>
        </nav>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">IDR Disputes</h1>
            <p className="text-sm text-slate-500 mt-0.5">{total.toLocaleString()} total disputes</p>
          </div>
          <Button onClick={() => navigate("/disputes/new")} className="flex items-center gap-2">
            <Plus size={16} />Initiate Dispute
          </Button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search reference, party name..."
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { setSearch(searchInput); setPage(1); } }}
              className="pl-8 w-64 text-sm"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => { setSearch(searchInput); setPage(1); }}>Search</Button>
          {search && <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setSearchInput(""); setPage(1); }}>Clear</Button>}
        </div>

        {/* Status tabs */}
        <div className="flex items-center gap-2 flex-wrap">
          {DISPUTE_STATUSES.map(s => (
            <button key={s.value} onClick={() => { setStatusFilter(s.value); setPage(1); }}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${statusFilter === s.value ? "bg-blue-600 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
              {s.label}
            </button>
          ))}
        </div>

        {/* Table */}
        <Card className="border-slate-200">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                <Gavel size={40} className="mb-3 opacity-30" />
                <p className="font-medium text-slate-600">No disputes found</p>
                <p className="text-sm mt-1">{search ? "Try a different search term" : "No disputes match the selected filter"}</p>
                <Button variant="outline" className="mt-4" onClick={() => navigate("/disputes/new")}>
                  <Plus size={14} className="mr-2" />Initiate First Dispute
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {["Reference #", "Initiating Party", "Responding Party", "Service Type", "Billed Amount", "QPA", "Status", "Step", "Created", ""].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((d: any) => (
                      <tr key={d.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer" onClick={() => navigate(`/disputes/${d.id}`)}>
                        <td className="px-4 py-3 text-sm font-mono font-semibold text-blue-600">{d.referenceNumber}</td>
                        <td className="px-4 py-3 text-sm text-slate-700 max-w-[140px] truncate">{d.initiatingPartyName}</td>
                        <td className="px-4 py-3 text-sm text-slate-600 max-w-[140px] truncate">{d.respondingPartyName ?? <span className="text-slate-400">TBD</span>}</td>
                        <td className="px-4 py-3 text-sm text-slate-600 capitalize">{d.serviceType?.replace(/_/g, " ")}</td>
                        <td className="px-4 py-3 text-sm font-semibold text-slate-800">${Number(d.billedAmount).toLocaleString()}</td>
                        <td className="px-4 py-3 text-sm text-slate-600">{d.qpaAmount ? `$${Number(d.qpaAmount).toLocaleString()}` : <span className="text-slate-400">—</span>}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[d.status] ?? "bg-slate-100 text-slate-600"}`}>
                            {d.status?.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500 max-w-[120px] truncate">
                          {d.currentStep?.replace(/^STEP_\d+_/, "").replace(/_/g, " ").toLowerCase()}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-500">{new Date(d.createdAt).toLocaleDateString()}</td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-blue-600 font-medium hover:text-blue-700">View →</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString()}</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                <ChevronLeft size={16} />
              </Button>
              <span>Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                <ChevronRight size={16} />
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
