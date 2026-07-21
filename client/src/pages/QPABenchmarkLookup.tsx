import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, TrendingUp, Info, BookOpen, ExternalLink, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";

const SPECIALTY_LABELS: Record<string, string> = {
  emergency_medicine: "Emergency Medicine",
  anesthesiology: "Anesthesiology",
  radiology: "Radiology",
  pathology: "Pathology",
  hospitalist: "Hospitalist",
  intensivist: "Intensivist",
  neonatology: "Neonatology",
  ground_ambulance: "Ground Ambulance",
  air_ambulance: "Air Ambulance",
};

export default function QPABenchmarkLookup() {
  const { user } = useAuth();
  const [cptSearch, setCptSearch] = useState("");
  const [specialtyFilter, setSpecialtyFilter] = useState("all");
  const [selectedState, setSelectedState] = useState("national");
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);

  const { data: benchmarks, isLoading, refetch } = trpc.qpaBenchmarks.list.useQuery({
    search: cptSearch || undefined,
    specialty: specialtyFilter !== "all" ? specialtyFilter : undefined,
    limit: 200,
  });

  const { data: stateModifiers } = trpc.qpaBenchmarks.stateModifiers.useQuery();

  const seedMutation = trpc.qpaBenchmarks.seed.useMutation({
    onSuccess: (data) => {
      toast.success(`Seeded ${data.seeded} benchmarks and ${data.stateModifiers} state modifiers`);
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const modifier = selectedState !== "national" && stateModifiers
    ? (stateModifiers[selectedState] ?? 1.0)
    : 1.0;

  const formatCurrency = (v: number | string) => {
    const num = typeof v === "string" ? parseFloat(v) : v;
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(num * modifier);
  };

  const selectedRow = benchmarks?.find(r => r.id === selectedRowId);
  const stateKeys = stateModifiers ? Object.keys(stateModifiers).sort() : [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-emerald-600" />
            QPA Benchmark Lookup
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Reference qualifying payment amount benchmarks by CPT code and state</p>
        </div>
        <div className="flex items-center gap-2">
          {user?.role === "admin" && (
            <Button variant="outline" size="sm" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
              <RefreshCw className="h-3 w-3 mr-1" />Seed Benchmarks
            </Button>
          )}
          <a
            href="https://www.cms.gov/nosurprises/policies-and-resources/overview-of-the-qualifying-payment-amount"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline flex items-center gap-1"
          >
            <ExternalLink className="h-3 w-3" />CMS QPA Guidance
          </a>
        </div>
      </div>

      <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
        <Info className="h-4 w-4 shrink-0" />
        <span>These benchmarks are illustrative reference ranges based on publicly available data. Actual QPAs are calculated by payers using their contracted rates. Always verify with the payer's QPA disclosure.</span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search CPT code or description..." value={cptSearch} onChange={e => setCptSearch(e.target.value)} />
        </div>
        <Select value={specialtyFilter} onValueChange={setSpecialtyFilter}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All Specialties" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Specialties</SelectItem>
            {Object.entries(SPECIALTY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={selectedState} onValueChange={setSelectedState}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="national">National Avg</SelectItem>
            {stateKeys.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        {selectedState !== "national" && stateModifiers && (
          <Badge className="bg-blue-100 text-blue-700 text-xs">
            {selectedState} modifier: {modifier > 1 ? "+" : ""}{((modifier - 1) * 100).toFixed(0)}%
          </Badge>
        )}
      </div>

      {/* Results table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">CPT Code</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Description</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Specialty</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">P50 (Median)</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">P75</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">P90</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                      ))}
                    </tr>
                  ))
                ) : !benchmarks?.length ? (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-muted-foreground">
                      {cptSearch || specialtyFilter !== "all"
                        ? "No CPT codes match your search"
                        : "No benchmarks in database — click \"Seed Benchmarks\" (admin) to populate"}
                    </td>
                  </tr>
                ) : (
                  benchmarks.map(row => (
                    <tr
                      key={row.id}
                      className={`hover:bg-muted/30 cursor-pointer ${selectedRowId === row.id ? "bg-emerald-50/50" : ""}`}
                      onClick={() => setSelectedRowId(selectedRowId === row.id ? null : row.id)}
                    >
                      <td className="px-4 py-3 font-mono font-semibold text-primary">{row.cptCode}</td>
                      <td className="px-4 py-3 text-sm">{row.description}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="text-xs">{SPECIALTY_LABELS[row.specialty] ?? row.specialty}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-medium">{formatCurrency(row.p50National)}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{formatCurrency(row.p75National)}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{formatCurrency(row.p90National)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Selected row detail */}
      {selectedRow && (
        <Card className="border-emerald-200 bg-emerald-50/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-600" />
              CPT {selectedRow.cptCode} — {selectedRow.description}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="p-3 bg-white dark:bg-background rounded-lg border">
                <div className="text-2xl font-bold text-emerald-600">{formatCurrency(selectedRow.p50National)}</div>
                <div className="text-xs text-muted-foreground mt-1">50th Percentile (Median QPA)</div>
                <div className="text-xs text-muted-foreground">Most common IDR anchor</div>
              </div>
              <div className="p-3 bg-white dark:bg-background rounded-lg border">
                <div className="text-2xl font-bold text-blue-600">{formatCurrency(selectedRow.p75National)}</div>
                <div className="text-xs text-muted-foreground mt-1">75th Percentile</div>
                <div className="text-xs text-muted-foreground">Strong provider position</div>
              </div>
              <div className="p-3 bg-white dark:bg-background rounded-lg border">
                <div className="text-2xl font-bold text-purple-600">{formatCurrency(selectedRow.p90National)}</div>
                <div className="text-xs text-muted-foreground mt-1">90th Percentile</div>
                <div className="text-xs text-muted-foreground">High-cost market rate</div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              {selectedState !== "national" ? `Adjusted for ${selectedState} market (${modifier > 1 ? "+" : ""}${((modifier - 1) * 100).toFixed(0)}% modifier). ` : ""}
              Source: CMS NSA QPA reference data. For informational purposes only.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
