import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { APP_LOGO, APP_TITLE } from "@/const";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowLeft, Bell, CheckCircle2, Clock, FileText,
  Gavel, Loader2, LogOut, RefreshCw, Scale, Search, Shield, TrendingUp,
} from "lucide-react";

const STATUS_TABS = [
  { value: "", label: "All" },
  { value: "open_negotiation", label: "Open Negotiation" },
  { value: "idr_initiated", label: "IDR Initiated" },
  { value: "idr_entity_selection", label: "Entity Selection" },
  { value: "eligibility_review", label: "Eligibility Review" },
  { value: "offer_submission", label: "Offer Submission" },
  { value: "under_arbitration", label: "Under Arbitration" },
  { value: "determination_issued", label: "Determination" },
  { value: "payment_pending", label: "Payment Pending" },
  { value: "closed", label: "Closed" },
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

export default function Admin() {
  const [, navigate] = useLocation();
  const { user, logout } = useAuth();

  // Redirect non-admin users
  if (user && user.role !== "admin") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <Shield size={48} className="mx-auto text-slate-300 mb-4" />
          <h2 className="text-xl font-bold text-slate-700">Access Denied</h2>
          <p className="text-slate-500 mt-2">Admin privileges required to view this page.</p>
          <Button className="mt-4" onClick={() => navigate("/dashboard")}>Return to Dashboard</Button>
        </div>
      </div>
    );
  }

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;
  const [showNotifComposer, setShowNotifComposer] = useState(false);
  const [notifUserId, setNotifUserId] = useState("");
  const [notifType, setNotifType] = useState("system");
  const [notifMessage, setNotifMessage] = useState("");
  const utils = trpc.useUtils();
  const [showReseedConfirm, setShowReseedConfirm] = useState(false);
  const reseedMutation = trpc.admin.reseedDemoData.useMutation({
    onSuccess: (res) => {
      toast.success(`Demo data reseeded — ${res.disputes} disputes, ${res.entities} entities, ${res.events} events`);
      utils.admin.allDisputes.invalidate();
      utils.admin.stats.invalidate();
      utils.arbitrators.list.invalidate();
      setShowReseedConfirm(false);
    },
    onError: (err: { message: string }) => toast.error(`Reseed failed: ${err.message}`),
  });
  const sendNotifMutation = trpc.notifications.sendNotification.useMutation({
    onSuccess: () => {
      toast.success("Notification sent");
      setShowNotifComposer(false);
      setNotifMessage("");
      setNotifUserId("");
      utils.notifications.list.invalidate();
    },
    onError: (err: { message: string }) => toast.error(err.message),
  });

  const { data: stats, isLoading: statsLoading } = trpc.admin.stats.useQuery();
  const { data, isLoading, refetch, isFetching } = trpc.admin.allDisputes.useQuery({
    page,
    pageSize: PAGE_SIZE,
    status: statusFilter || undefined,
    search: search.trim() || undefined,
  }, { keepPreviousData: true } as any);

  const handleSearch = (v: string) => { setSearch(v); setPage(1); };
  const handleStatus = (v: string) => { setStatusFilter(v); setPage(1); };

  const kpis = [
    { label: "Total Disputes", value: stats?.total ?? 0, icon: FileText, color: "bg-blue-500" },
    { label: "Open Negotiation", value: stats?.openNegotiation ?? 0, icon: Clock, color: "bg-amber-500" },
    { label: "In IDR Process", value: stats?.inIDR ?? 0, icon: Gavel, color: "bg-purple-500" },
    { label: "Closed This Month", value: stats?.closedThisMonth ?? 0, icon: CheckCircle2, color: "bg-green-500" },
    { label: "Overdue", value: stats?.overdue ?? 0, icon: AlertTriangle, color: "bg-red-500" },
    { label: "Unread Alerts", value: stats?.unreadNotifications ?? 0, icon: TrendingUp, color: "bg-indigo-500" },
  ];

  return (
    <div>
        {/* Title */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/dashboard")} className="text-slate-400 hover:text-slate-600">
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                <Shield size={22} className="text-purple-600" />
                Platform Admin — All Disputes
              </h1>
              <p className="text-sm text-slate-500">Platform-wide view across all parties and disputes</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowNotifComposer(true)}>
              <Bell size={13} className="mr-1.5" />Send Notification
            </Button>
            <Button variant="outline" size="sm" className="text-amber-700 border-amber-300 hover:bg-amber-50" onClick={() => setShowReseedConfirm(true)}>
              <RefreshCw size={13} className="mr-1.5" />Reseed Demo Data
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
            </Button>
          </div>
        </div>

        {/* KPI bar */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          {statsLoading
            ? Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse h-24" />
              ))
            : kpis.map(kpi => (
                <Card key={kpi.label} className="border-slate-200">
                  <CardContent className="p-5">
                    <div className={`p-2.5 rounded-lg ${kpi.color} w-fit mb-2`}>
                      <kpi.icon size={16} className="text-white" />
                    </div>
                    <div className="text-2xl font-bold text-slate-800">{kpi.value.toLocaleString()}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{kpi.label}</div>
                  </CardContent>
                </Card>
              ))
          }
        </div>

        {/* Filters */}
        <Card className="border-slate-200 mb-6">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search by reference, party name, CPT code…"
                  value={search}
                  onChange={e => handleSearch(e.target.value)}
                  className="pl-9 text-sm"
                />
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {STATUS_TABS.map(tab => (
                  <button
                    key={tab.value}
                    onClick={() => handleStatus(tab.value)}
                    className={`px-3 py-1.5 text-xs rounded-full font-medium transition-colors ${
                      statusFilter === tab.value
                        ? "bg-blue-600 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Disputes table */}
        <Card className="border-slate-200">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-semibold text-slate-700">
              Disputes
              {data && <span className="text-slate-400 font-normal ml-2 text-sm">({data.total} total)</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-14 bg-slate-100 rounded animate-pulse" />
                ))}
              </div>
            ) : !data?.items?.length ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                <Scale size={40} className="mb-3 opacity-30" />
                <p className="text-sm">No disputes found</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50">
                        <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Reference</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Initiating Party</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Responding Party</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Service</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Billed</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Created</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.items.map((d: any) => (
                        <tr key={d.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => navigate(`/disputes/${d.id}`)}>
                          <td className="px-5 py-3 font-mono text-xs font-semibold text-slate-700">{d.referenceNumber}</td>
                          <td className="px-4 py-3 text-slate-700 max-w-[160px] truncate">{d.initiatingPartyName}</td>
                          <td className="px-4 py-3 text-slate-500 max-w-[160px] truncate">{d.respondingPartyName ?? "—"}</td>
                          <td className="px-4 py-3 text-slate-500 text-xs capitalize">{d.serviceType?.replace(/_/g, " ")}</td>
                          <td className="px-4 py-3 text-right font-semibold text-slate-700">${Number(d.billedAmount).toLocaleString()}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[d.status] ?? "bg-slate-100 text-slate-600"}`}>
                              {d.status?.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-400">{new Date(d.createdAt).toLocaleDateString()}</td>
                          <td className="px-4 py-3 text-right">
                            <button className="text-xs text-blue-600 hover:text-blue-700 font-medium">View →</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {Math.ceil((data.total ?? 0) / PAGE_SIZE) > 1 && (
                  <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100">
                    <span className="text-xs text-slate-500">
                      Page {page} of {Math.ceil((data.total ?? 0) / PAGE_SIZE)} · {data.total} disputes
                    </span>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => setPage(p => p - 1)} disabled={page === 1}>
                        ← Prev
                      </Button>
                       <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= Math.ceil((data.total ?? 0) / PAGE_SIZE)}>
                        Next →
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

      {/* Notification Composer Dialog */}
      <Dialog open={showNotifComposer} onOpenChange={setShowNotifComposer}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Bell size={18} className="text-blue-600" />Send Notification</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Recipient User ID <span className="text-slate-400">(leave blank to broadcast to all users)</span></label>
              <Input placeholder="User ID" value={notifUserId} onChange={e => setNotifUserId(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Notification Type</label>
              <Select value={notifType} onValueChange={setNotifType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="deadline_warning">Deadline Warning</SelectItem>
                  <SelectItem value="step_completed">Step Completed</SelectItem>
                  <SelectItem value="offer_received">Offer Received</SelectItem>
                  <SelectItem value="determination_issued">Determination Issued</SelectItem>
                  <SelectItem value="document_uploaded">Document Uploaded</SelectItem>
                  <SelectItem value="system">System Message</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Message</label>
              <textarea
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                rows={3}
                placeholder="Notification message content..."
                value={notifMessage}
                onChange={e => setNotifMessage(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNotifComposer(false)}>Cancel</Button>
            <Button
              onClick={() => sendNotifMutation.mutate({ userId: notifUserId.trim() || undefined, type: notifType as "deadline_warning" | "step_completed" | "offer_received" | "determination_issued" | "document_uploaded" | "system", message: notifMessage.trim() })}
              disabled={!notifMessage.trim() || sendNotifMutation.isPending}
            >
              {sendNotifMutation.isPending ? <Loader2 size={14} className="animate-spin mr-1" /> : <Bell size={14} className="mr-1" />}
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reseed Demo Data Confirmation */}
      <Dialog open={showReseedConfirm} onOpenChange={setShowReseedConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              <AlertTriangle size={18} />
              Reseed Demo Data?
            </DialogTitle>
          </DialogHeader>
          <div className="text-sm text-slate-600 space-y-2">
            <p>This will <strong>delete all existing disputes, entities, offers, and notifications</strong> and replace them with fresh demo data.</p>
            <p>The action includes:</p>
            <ul className="list-disc list-inside space-y-1 text-slate-500">
              <li>40 disputes across all 19 IDR workflow steps</li>
              <li>12 fully-closed disputes (populates analytics charts)</li>
              <li>QPA values for Step 10+ disputes</li>
              <li>5 IDR entities with updated caseloads</li>
            </ul>
            <p className="text-red-600 font-medium">This cannot be undone.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReseedConfirm(false)}>Cancel</Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={() => reseedMutation.mutate()}
              disabled={reseedMutation.isPending}
            >
              {reseedMutation.isPending ? <Loader2 size={14} className="animate-spin mr-1" /> : <RefreshCw size={14} className="mr-1" />}
              {reseedMutation.isPending ? "Seeding..." : "Yes, Reseed"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
