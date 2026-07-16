import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { APP_LOGO, APP_TITLE, getLoginUrl } from "@/const";
import {
  AlertTriangle, Bell, ChevronLeft, ChevronRight,
  FileText, Gavel, LogOut, Plus, Scale, Search, X, SlidersHorizontal, Download,
  ArrowRight, UserCheck, CheckSquare, Square, Trash2
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import EmptyState from "@/components/EmptyState";

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

// ─── Hermes Risk Badge (client-side heuristic model) ─────────────────────────
function computeRisk(d: {
  status?: string | null;
  billedAmount?: string | number | null;
  createdAt?: Date | string | null;
  serviceType?: string | null;
}): { score: number; level: "low" | "medium" | "high" | "critical"; factors: string[] } {
  let score = 0;
  const factors: string[] = [];
  const age = d.createdAt ? Math.floor((Date.now() - new Date(d.createdAt).getTime()) / 86400000) : 0;
  if (age > 60) { score += 30; factors.push("Overdue (60+ days)"); }
  else if (age > 30) { score += 15; factors.push("Aging (30+ days)"); }
  const amount = Number(d.billedAmount) || 0;
  if (amount > 50000) { score += 25; factors.push("High value claim"); }
  else if (amount > 20000) { score += 12; factors.push("Significant claim value"); }
  const statusRisk: Record<string, number> = {
    offer_submission: 20, under_arbitration: 25, appealed: 30, eligibility_review: 15, idr_entity_selection: 10,
  };
  const statusScore = statusRisk[d.status ?? ""] ?? 0;
  if (statusScore > 0) { score += statusScore; factors.push(`Status: ${(d.status ?? "").replace(/_/g, " ")}`); }
  const serviceRisk: Record<string, number> = {
    air_ambulance: 20, neonatology: 15, anesthesiology: 10, emergency_medicine: 8,
  };
  const svcScore = serviceRisk[d.serviceType ?? ""] ?? 0;
  if (svcScore > 0) { score += svcScore; factors.push(`High-risk service: ${(d.serviceType ?? "").replace(/_/g, " ")}`); }
  const level = score >= 70 ? "critical" : score >= 45 ? "high" : score >= 20 ? "medium" : "low";
  return { score: Math.min(score, 100), level, factors };
}

const RISK_CONFIG = {
  critical: { badge: "bg-red-100 text-red-700 border-red-300", dot: "bg-red-500 animate-pulse", label: "Critical" },
  high:     { badge: "bg-orange-100 text-orange-700 border-orange-300", dot: "bg-orange-500", label: "High" },
  medium:   { badge: "bg-yellow-100 text-yellow-700 border-yellow-300", dot: "bg-yellow-400", label: "Medium" },
  low:      { badge: "bg-green-100 text-green-700 border-green-300", dot: "bg-green-400", label: "Low" },
};

function RiskBadge({ dispute }: { dispute: any }) {
  const { score, level, factors } = computeRisk(dispute);
  const cfg = RISK_CONFIG[level];
  return (
    <span
      title={`Risk score: ${score}\n${factors.join("\n") || "No risk factors"}`}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border cursor-help ${cfg.badge}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

const SERVICE_TYPES = [
  { value: "all", label: "All Service Types" },
  { value: "emergency_medicine", label: "Emergency Medicine" },
  { value: "anesthesiology", label: "Anesthesiology" },
  { value: "pathology", label: "Pathology" },
  { value: "radiology", label: "Radiology" },
  { value: "neonatology", label: "Neonatology" },
  { value: "assistant_surgeon", label: "Assistant Surgeon" },
  { value: "hospitalist", label: "Hospitalist" },
  { value: "intensivist", label: "Intensivist" },
  { value: "air_ambulance", label: "Air Ambulance" },
  { value: "ground_ambulance", label: "Ground Ambulance" },
  { value: "other", label: "Other" },
];

export default function DisputesList() {
  const [, navigate] = useLocation();
  const { user, isAuthenticated, logout, loading: authLoading } = useAuth();
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [serviceTypeFilter, setServiceTypeFilter] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAdvancing, setBulkAdvancing] = useState(false);
  const [bulkExporting, setBulkExporting] = useState(false);

  // Debounced live search — fires 350ms after the user stops typing
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchInput]);

  // Clear selection when page/filters change
  useEffect(() => {
    setSelectedIds(new Set());
  }, [page, statusFilter, serviceTypeFilter, search]);

  const [csvExporting, setCsvExporting] = useState<boolean>(false);
  const hasActiveFilters = statusFilter !== "all" || serviceTypeFilter !== "all" || search;

  const exportCSVQuery = trpc.disputes.exportCSV.useQuery(
    {
      status: statusFilter !== "all" ? (statusFilter as any) : undefined,
      serviceType: serviceTypeFilter !== "all" ? (serviceTypeFilter as any) : undefined,
      search: search || undefined,
    },
    { enabled: false } // only fetch on demand
  );

  const advanceStepMutation = trpc.disputes.advance.useMutation();
  const utils = trpc.useUtils();

  const handleExportCSV = async () => {
    setCsvExporting(true);
    try {
      const result = await exportCSVQuery.refetch();
      if (result.data) {
        const blob = new Blob([result.data.csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = result.data.filename;
        a.click();
        URL.revokeObjectURL(url);
      }
    } finally {
      setCsvExporting(false);
    }
  };

  const clearAllFilters = () => {
    setSearch("");
    setSearchInput("");
    setStatusFilter("all");
    setServiceTypeFilter("all");
    setPage(1);
  };

  const { data, isLoading } = trpc.disputes.list.useQuery(
    {
      status: statusFilter !== "all" ? (statusFilter as any) : undefined,
      serviceType: serviceTypeFilter !== "all" ? (serviceTypeFilter as any) : undefined,
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

  // Selection helpers
  const allPageIds = items.map((d: any) => d.id as string);
  const allSelected = allPageIds.length > 0 && allPageIds.every(id => selectedIds.has(id));
  const someSelected = allPageIds.some(id => selectedIds.has(id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        allPageIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        allPageIds.forEach(id => next.add(id));
        return next;
      });
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Step progression map: given current step, what's the next step and status
  const STEP_PROGRESSION: Record<string, { newStep: string; newStatus: string; description: string }> = {
    "STEP_01_OPEN_NEGOTIATION_INITIATED": { newStep: "STEP_02_OPEN_NEGOTIATION_PERIOD", newStatus: "open_negotiation", description: "Open negotiation period started" },
    "STEP_02_OPEN_NEGOTIATION_PERIOD": { newStep: "STEP_03_OPEN_NEGOTIATION_FAILED", newStatus: "open_negotiation", description: "Open negotiation period ended" },
    "STEP_03_OPEN_NEGOTIATION_FAILED": { newStep: "STEP_04_IDR_INITIATED", newStatus: "idr_initiated", description: "IDR process initiated" },
    "STEP_04_IDR_INITIATED": { newStep: "STEP_05_IDR_NOTICE_SENT", newStatus: "idr_initiated", description: "IDR notice sent to parties" },
    "STEP_05_IDR_NOTICE_SENT": { newStep: "STEP_06_IDR_ENTITY_SELECTION", newStatus: "idr_entity_selection", description: "IDR entity selection started" },
    "STEP_06_IDR_ENTITY_SELECTION": { newStep: "STEP_07_IDR_ENTITY_SELECTED", newStatus: "idr_entity_selection", description: "IDR entity selected" },
    "STEP_07_IDR_ENTITY_SELECTED": { newStep: "STEP_08_ELIGIBILITY_REVIEW", newStatus: "eligibility_review", description: "Eligibility review started" },
    "STEP_08_ELIGIBILITY_REVIEW": { newStep: "STEP_09_OFFER_SUBMISSION", newStatus: "offer_submission", description: "Offer submission period started" },
    "STEP_09_OFFER_SUBMISSION": { newStep: "STEP_10_QPA_DISCLOSURE", newStatus: "offer_submission", description: "QPA disclosed" },
    "STEP_10_QPA_DISCLOSURE": { newStep: "STEP_11_ADDITIONAL_INFORMATION", newStatus: "offer_submission", description: "Additional information submitted" },
    "STEP_11_ADDITIONAL_INFORMATION": { newStep: "STEP_12_ARBITRATION_REVIEW", newStatus: "under_arbitration", description: "Arbitration review started" },
    "STEP_12_ARBITRATION_REVIEW": { newStep: "STEP_13_DETERMINATION_ISSUED", newStatus: "determination_issued", description: "Determination issued" },
    "STEP_13_DETERMINATION_ISSUED": { newStep: "STEP_14_PAYMENT_DETERMINATION", newStatus: "payment_pending", description: "Payment determination made" },
    "STEP_14_PAYMENT_DETERMINATION": { newStep: "STEP_15_PAYMENT_MADE", newStatus: "payment_pending", description: "Payment made" },
    "STEP_15_PAYMENT_MADE": { newStep: "STEP_16_ADMINISTRATIVE_FEE_PAID", newStatus: "payment_pending", description: "Administrative fee paid" },
    "STEP_16_ADMINISTRATIVE_FEE_PAID": { newStep: "STEP_17_DISPUTE_CLOSED", newStatus: "closed", description: "Dispute closed" },
  };

  const handleBulkAdvance = async () => {
    if (selectedIds.size === 0) return;
    setBulkAdvancing(true);
    let successCount = 0;
    let failCount = 0;
    for (const id of Array.from(selectedIds)) {
      const dispute = items.find((d: any) => d.id === id);
      if (!dispute) { failCount++; continue; }
      const progression = STEP_PROGRESSION[dispute.currentStep as string];
      if (!progression) { failCount++; continue; }
      try {
        await advanceStepMutation.mutateAsync({
          disputeId: id,
          newStep: progression.newStep as any,
          newStatus: progression.newStatus as any,
          description: progression.description,
        });
        successCount++;
      } catch {
        failCount++;
      }
    }
    await utils.disputes.list.invalidate();
    setBulkAdvancing(false);
    setSelectedIds(new Set());
    if (failCount === 0) {
      toast.success(`Advanced ${successCount} dispute${successCount !== 1 ? "s" : ""} to next step`);
    } else {
      toast.warning(`Advanced ${successCount}, failed ${failCount} (already at final step)`);
    }
  };

  const handleBulkExportSelected = () => {
    if (selectedIds.size === 0) return;
    setBulkExporting(true);
    const selectedItems = items.filter((d: any) => selectedIds.has(d.id));
    const headers = ["Reference #", "Initiating Party", "Responding Party", "Service Type", "Billed Amount", "QPA", "Status", "Step", "Created"];
    const rows = selectedItems.map((d: any) => [
      d.referenceNumber,
      d.initiatingPartyName,
      d.respondingPartyName ?? "",
      d.serviceType?.replace(/_/g, " ") ?? "",
      d.billedAmount,
      d.qpaAmount ?? "",
      d.status?.replace(/_/g, " ") ?? "",
      d.currentStep?.replace(/^STEP_\d+_/, "").replace(/_/g, " ") ?? "",
      new Date(d.createdAt).toLocaleDateString(),
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `selected-disputes-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setBulkExporting(false);
    toast.success(`Exported ${selectedIds.size} dispute${selectedIds.size !== 1 ? "s" : ""}`);
  };

  const handleDeselectAll = () => setSelectedIds(new Set());

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

      {/* Bulk-action sticky toolbar — appears when items are selected */}
      {selectedIds.size > 0 && (
        <div className="sticky top-14 z-20 bg-blue-600 text-white px-6 py-2.5 flex items-center gap-3 shadow-md border-b border-blue-700">
          <div className="flex items-center gap-2 flex-1">
            <CheckSquare size={16} className="text-blue-200" />
            <span className="text-sm font-semibold">
              {selectedIds.size} dispute{selectedIds.size !== 1 ? "s" : ""} selected
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              className="bg-white/15 hover:bg-white/25 text-white border-white/30 border text-xs h-7"
              onClick={handleBulkAdvance}
              disabled={bulkAdvancing}
            >
              <ArrowRight size={13} className="mr-1.5" />
              {bulkAdvancing ? "Advancing..." : "Advance Step"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="bg-white/15 hover:bg-white/25 text-white border-white/30 border text-xs h-7"
              onClick={handleBulkExportSelected}
              disabled={bulkExporting}
            >
              <Download size={13} className="mr-1.5" />
              Export Selected
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="bg-white/15 hover:bg-white/25 text-white border-white/30 border text-xs h-7"
              onClick={() => navigate("/idr-entities")}
            >
              <UserCheck size={13} className="mr-1.5" />
              Assign to Entity
            </Button>
            <button
              onClick={handleDeselectAll}
              className="ml-2 text-blue-200 hover:text-white text-xs flex items-center gap-1"
            >
              <X size={13} />Deselect All
            </button>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">IDR Disputes</h1>
            <p className="text-sm text-slate-500 mt-0.5">{total.toLocaleString()} total disputes</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleExportCSV} disabled={csvExporting}
              className="flex items-center gap-2 text-slate-600">
              <Download size={15} />
              {csvExporting ? "Exporting..." : `Export CSV${total > 0 ? ` (${total.toLocaleString()})` : ""}`}
            </Button>
            <Button onClick={() => navigate("/disputes/new")} className="flex items-center gap-2">
              <Plus size={16} />Initiate Dispute
            </Button>
          </div>
        </div>

        {/* Search + Filter bar */}
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Live search */}
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search reference #, party name..."
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                className="pl-8 text-sm"
              />
              {searchInput && (
                <button onClick={() => { setSearchInput(""); setSearch(""); setPage(1); }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <X size={13} />
                </button>
              )}
            </div>

            {/* Service type select */}
            <Select value={serviceTypeFilter} onValueChange={v => { setServiceTypeFilter(v); setPage(1); }}>
              <SelectTrigger className="w-44 text-sm">
                <SelectValue placeholder="Service type" />
              </SelectTrigger>
              <SelectContent>
                {SERVICE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>

            {/* Expand/collapse status filter chips */}
            <Button variant="outline" size="sm" onClick={() => setShowFilters(v => !v)}
              className={showFilters ? "border-blue-400 text-blue-600" : ""}>
              <SlidersHorizontal size={14} className="mr-1.5" />
              Status Filter {showFilters ? "▲" : "▼"}
            </Button>

            {/* Clear all */}
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearAllFilters}
                className="text-slate-500 hover:text-red-600">
                <X size={13} className="mr-1" />Clear all
              </Button>
            )}
          </div>

          {/* Active filter chips */}
          {hasActiveFilters && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-slate-400 font-medium">Active filters:</span>
              {search && (
                <span className="flex items-center gap-1 px-2 py-0.5 bg-blue-50 border border-blue-200 rounded-full text-xs text-blue-700">
                  Search: "{search}"
                  <button onClick={() => { setSearch(""); setSearchInput(""); }}><X size={10} /></button>
                </span>
              )}
              {statusFilter !== "all" && (
                <span className="flex items-center gap-1 px-2 py-0.5 bg-purple-50 border border-purple-200 rounded-full text-xs text-purple-700">
                  Status: {DISPUTE_STATUSES.find(s => s.value === statusFilter)?.label}
                  <button onClick={() => setStatusFilter("all")}><X size={10} /></button>
                </span>
              )}
              {serviceTypeFilter !== "all" && (
                <span className="flex items-center gap-1 px-2 py-0.5 bg-amber-50 border border-amber-200 rounded-full text-xs text-amber-700">
                  Type: {SERVICE_TYPES.find(t => t.value === serviceTypeFilter)?.label}
                  <button onClick={() => setServiceTypeFilter("all")}><X size={10} /></button>
                </span>
              )}
            </div>
          )}

          {/* Status tabs (collapsible) */}
          {showFilters && (
            <div className="flex items-center gap-2 flex-wrap p-3 bg-slate-50 rounded-lg border border-slate-200">
              {DISPUTE_STATUSES.map(s => (
                <button key={s.value} onClick={() => { setStatusFilter(s.value); setPage(1); }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    statusFilter === s.value ? "bg-blue-600 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}>
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Table */}
        <Card className="border-slate-200">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
              </div>
            ) : items.length === 0 ? (
              <EmptyState
                variant="disputes"
                title={search ? "No matching disputes" : "No disputes yet"}
                description={search ? `No disputes match "${search}". Try a different search term or clear your filters.` : undefined}
                actionLabel="Create First Dispute"
                onAction={() => navigate("/disputes/new")}
                secondaryActionLabel={search ? "Clear search" : undefined}
                onSecondaryAction={search ? () => window.location.reload() : undefined}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 w-10">
                        <Checkbox
                          checked={allSelected}
                          onCheckedChange={toggleSelectAll}
                          aria-label="Select all on this page"
                          className="border-slate-300"
                        />
                      </th>
                      {["Reference #", "Initiating Party", "Responding Party", "Service Type", "Billed Amount", "QPA", "Risk", "Status", "Step", "Created", ""].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((d: any) => {
                      const isSelected = selectedIds.has(d.id);
                      return (
                        <tr
                          key={d.id}
                          className={`border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer transition-colors ${isSelected ? "bg-blue-50 hover:bg-blue-50" : ""}`}
                          onClick={(e) => {
                            // Don't navigate if clicking checkbox
                            const target = e.target as HTMLElement;
                            if (target.closest('[role="checkbox"]') || target.tagName === 'INPUT') return;
                            navigate(`/disputes/${d.id}`);
                          }}
                        >
                          <td className="px-4 py-3 w-10" onClick={e => e.stopPropagation()}>
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleSelectOne(d.id)}
                              aria-label={`Select dispute ${d.referenceNumber}`}
                              className="border-slate-300"
                            />
                          </td>
                          <td className="px-4 py-3 text-sm font-mono font-semibold text-blue-600">{d.referenceNumber}</td>
                          <td className="px-4 py-3 text-sm text-slate-700 max-w-[140px] truncate">{d.initiatingPartyName}</td>
                          <td className="px-4 py-3 text-sm text-slate-600 max-w-[140px] truncate">{d.respondingPartyName ?? <span className="text-slate-400">TBD</span>}</td>
                          <td className="px-4 py-3 text-sm text-slate-600 capitalize">{d.serviceType?.replace(/_/g, " ")}</td>
                          <td className="px-4 py-3 text-sm font-semibold text-slate-800">${Number(d.billedAmount).toLocaleString()}</td>
                          <td className="px-4 py-3 text-sm text-slate-600">{d.qpaAmount ? `$${Number(d.qpaAmount).toLocaleString()}` : <span className="text-slate-400">—</span>}</td>
                          <td className="px-4 py-3">
                            <RiskBadge dispute={d} />
                          </td>
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
                      );
                    })}
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
