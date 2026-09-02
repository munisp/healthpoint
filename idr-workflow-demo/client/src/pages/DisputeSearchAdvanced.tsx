import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocation } from "wouter";
import { Search, Filter, X, ExternalLink, SlidersHorizontal } from "lucide-react";

const DISPUTE_STATUSES = [
  "open_negotiation", "idr_initiated", "idr_entity_selection", "eligibility_review",
  "offer_submission", "under_arbitration", "determination_issued", "payment_pending",
  "closed", "appealed", "ineligible",
];

const SERVICE_TYPES = [
  "emergency_medicine", "anesthesiology", "radiology", "pathology", "neonatology",
  "air_ambulance", "ground_ambulance", "hospitalist", "intensivist", "other",
];

interface Filters {
  query: string;
  status: string;
  serviceType: string;
  minAmount: string;
  maxAmount: string;
  dateFrom: string;
  dateTo: string;
  payer: string;
}

const DEFAULT_FILTERS: Filters = {
  query: "", status: "all", serviceType: "all", minAmount: "", maxAmount: "",
  dateFrom: "", dateTo: "", payer: "",
};

export default function DisputeSearchAdvanced() {
  const [, navigate] = useLocation();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [showFilters, setShowFilters] = useState(false);

  const { data, isLoading } = trpc.disputes.list.useQuery({ limit: 200, offset: 0 });
  const disputes = data?.items ?? [];

  const activeFilterCount = Object.entries(filters).filter(([k, v]) =>
    k !== "query" && v !== "" && v !== "all"
  ).length;

  const results = useMemo(() => {
    return disputes.filter(d => {
      const q = filters.query.toLowerCase();
      if (q && !(
        d.referenceNumber?.toLowerCase().includes(q) ||
        d.respondingPartyName?.toLowerCase().includes(q) ||
        d.initiatingPartyName?.toLowerCase().includes(q) ||
        d.serviceType?.toLowerCase().includes(q) ||
        d.notes?.toLowerCase().includes(q)
      )) return false;

      if (filters.status !== "all" && d.status !== filters.status) return false;
      if (filters.serviceType !== "all" && d.serviceType !== filters.serviceType) return false;
      if (filters.payer && !d.respondingPartyName?.toLowerCase().includes(filters.payer.toLowerCase())) return false;

      const amount = Number(d.billedAmount) || 0;
      if (filters.minAmount && amount < Number(filters.minAmount)) return false;
      if (filters.maxAmount && amount > Number(filters.maxAmount)) return false;

      if (filters.dateFrom && d.createdAt && new Date(d.createdAt) < new Date(filters.dateFrom)) return false;
      if (filters.dateTo && d.createdAt && new Date(d.createdAt) > new Date(filters.dateTo + "T23:59:59")) return false;

      return true;
    });
  }, [disputes, filters]);

  const setFilter = (key: keyof Filters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => setFilters(DEFAULT_FILTERS);

  const formatCurrency = (v: number | string | null | undefined) => {
    if (!v) return "—";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(v));
  };

  const highlightMatch = (text: string | null | undefined, query: string) => {
    if (!text || !query) return text ?? "—";
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="bg-yellow-200 rounded">{text.slice(idx, idx + query.length)}</mark>
        {text.slice(idx + query.length)}
      </>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <SlidersHorizontal className="h-6 w-6 text-blue-600" />
          Advanced Search
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Full-text search across all dispute fields with multi-dimensional filters</p>
      </div>

      {/* Search bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            className="pl-10 h-11 text-base"
            placeholder="Search by reference, payer, provider, service type, or notes..."
            value={filters.query}
            onChange={e => setFilter("query", e.target.value)}
          />
          {filters.query && (
            <button className="absolute right-3 top-1/2 -translate-y-1/2" onClick={() => setFilter("query", "")}>
              <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
            </button>
          )}
        </div>
        <Button
          variant={showFilters ? "default" : "outline"}
          onClick={() => setShowFilters(s => !s)}
          className="relative"
        >
          <Filter className="h-4 w-4 mr-1.5" />Filters
          {activeFilterCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center">{activeFilterCount}</span>
          )}
        </Button>
        {(filters.query || activeFilterCount > 0) && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="h-4 w-4 mr-1" />Clear
          </Button>
        )}
      </div>

      {/* Advanced filters */}
      {showFilters && (
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-xs font-medium mb-1 block text-muted-foreground">Status</label>
                <Select value={filters.status} onValueChange={v => setFilter("status", v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    {DISPUTE_STATUSES.map(s => <SelectItem key={s} value={s} className="text-xs capitalize">{s.replace(/_/g, " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block text-muted-foreground">Service Type</label>
                <Select value={filters.serviceType} onValueChange={v => setFilter("serviceType", v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Services</SelectItem>
                    {SERVICE_TYPES.map(s => <SelectItem key={s} value={s} className="text-xs capitalize">{s.replace(/_/g, " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block text-muted-foreground">Min Amount ($)</label>
                <Input className="h-8 text-xs" type="number" placeholder="0" value={filters.minAmount} onChange={e => setFilter("minAmount", e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block text-muted-foreground">Max Amount ($)</label>
                <Input className="h-8 text-xs" type="number" placeholder="No limit" value={filters.maxAmount} onChange={e => setFilter("maxAmount", e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block text-muted-foreground">Payer Name</label>
                <Input className="h-8 text-xs" placeholder="Filter by payer..." value={filters.payer} onChange={e => setFilter("payer", e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block text-muted-foreground">Date From</label>
                <Input className="h-8 text-xs" type="date" value={filters.dateFrom} onChange={e => setFilter("dateFrom", e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block text-muted-foreground">Date To</label>
                <Input className="h-8 text-xs" type="date" value={filters.dateTo} onChange={e => setFilter("dateTo", e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {isLoading ? "Searching..." : `${results.length} result${results.length !== 1 ? "s" : ""}`}
        </span>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Reference</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Payer</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Service</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Billed</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoading ? (
                  <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">Searching...</td></tr>
                ) : results.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">No disputes match your search</td></tr>
                ) : (
                  results.map(d => (
                    <tr key={d.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => navigate(`/disputes/${d.id}`)}>
                      <td className="px-4 py-3 font-mono text-xs text-primary font-semibold">
                        {highlightMatch(d.referenceNumber, filters.query)}
                      </td>
                      <td className="px-4 py-3 text-sm max-w-[160px] truncate">
                        {highlightMatch(d.respondingPartyName, filters.query)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="text-xs capitalize">{(d.serviceType ?? "—").replace(/_/g, " ")}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="text-xs capitalize">{(d.status ?? "—").replace(/_/g, " ")}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right text-sm">{formatCurrency(d.billedAmount)}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {d.createdAt ? new Date(d.createdAt).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
