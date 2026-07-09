import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { BarChart3, Download, Play, Plus, X, RefreshCw, Filter, Columns } from "lucide-react";

const AVAILABLE_COLUMNS = [
  { id: "id", label: "Dispute ID", type: "string" },
  { id: "status", label: "Status", type: "string" },
  { id: "currentStep", label: "Current Step", type: "string" },
  { id: "respondingPartyName", label: "Payer Name", type: "string" },
  { id: "initiatingPartyName", label: "Provider Name", type: "string" },
  { id: "billedAmount", label: "Billed Amount", type: "number" },
  { id: "determinedAmount", label: "Determined Amount", type: "number" },
  { id: "paidAmount", label: "Paid Amount", type: "number" },
  { id: "serviceType", label: "Service Type", type: "string" },
  { id: "createdAt", label: "Created Date", type: "date" },
  { id: "closedAt", label: "Closed Date", type: "date" },
  { id: "deadlineDays", label: "Deadline Days", type: "number" },
];

const FILTER_OPS: Record<string, { label: string; ops: string[] }> = {
  string: { label: "Text", ops: ["contains", "equals", "starts_with", "not_contains"] },
  number: { label: "Number", ops: ["equals", "greater_than", "less_than", "between"] },
  date: { label: "Date", ops: ["before", "after", "between"] },
};

interface ReportFilter {
  id: string;
  column: string;
  op: string;
  value: string;
  value2?: string;
}

export default function CustomReportBuilder() {
  const [reportName, setReportName] = useState("My Custom Report");
  const [selectedColumns, setSelectedColumns] = useState<string[]>(["id", "status", "respondingPartyName", "billedAmount", "createdAt"]);
  const [filters, setFilters] = useState<ReportFilter[]>([]);
  const [groupBy, setGroupBy] = useState<string>("none");
  const [sortBy, setSortBy] = useState<string>("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [limit, setLimit] = useState(100);
  const [results, setResults] = useState<any[] | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const { data: disputes } = trpc.disputes.list.useQuery({ limit: 500 });

  const toggleColumn = (col: string) => {
    setSelectedColumns(prev => prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]);
  };

  const addFilter = () => {
    setFilters(prev => [...prev, { id: Date.now().toString(), column: "status", op: "equals", value: "" }]);
  };

  const removeFilter = (id: string) => setFilters(prev => prev.filter(f => f.id !== id));

  const updateFilter = (id: string, key: string, value: string) => {
    setFilters(prev => prev.map(f => f.id === id ? { ...f, [key]: value } : f));
  };

  const runReport = () => {
    if (!disputes?.items) { toast.error("No data available"); return; }
    setIsRunning(true);
    try {
      let data: Record<string, any>[] = disputes.items.map((d: any) => d as Record<string, any>);

      // Apply filters
      filters.forEach(f => {
        const col = AVAILABLE_COLUMNS.find(c => c.id === f.column);
        if (!col || !f.value) return;
        data = data.filter(row => {
          const val = row[f.column];
          const strVal = String(val ?? "").toLowerCase();
          const filterVal = f.value.toLowerCase();
          if (f.op === "contains") return strVal.includes(filterVal);
          if (f.op === "equals") return strVal === filterVal;
          if (f.op === "starts_with") return strVal.startsWith(filterVal);
          if (f.op === "not_contains") return !strVal.includes(filterVal);
          if (f.op === "greater_than") return parseFloat(strVal) > parseFloat(filterVal);
          if (f.op === "less_than") return parseFloat(strVal) < parseFloat(filterVal);
          if (f.op === "after") return new Date(strVal) > new Date(filterVal);
          if (f.op === "before") return new Date(strVal) < new Date(filterVal);
          return true;
        });
      });

      // Sort
      data.sort((a, b) => {
        const av = a[sortBy], bv = b[sortBy];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
        return sortDir === "asc" ? cmp : -cmp;
      });

      // Limit
      data = data.slice(0, limit);

      // Project columns
        const projected: Record<string, any>[] = data.map(row => {
        const out: Record<string, any> = {};
        selectedColumns.forEach(col => { out[col] = row[col]; });
        return out;
      });

      setResults(projected);
      toast.success(`Report generated: ${projected.length} rows`);
    } catch (e: any) {
      toast.error("Report generation failed: " + e.message);
    } finally {
      setIsRunning(false);
    }
  };

  const exportCSV = () => {
    if (!results) return;
    const colLabels = selectedColumns.map(c => AVAILABLE_COLUMNS.find(a => a.id === c)?.label ?? c);
      const rows: any[][] = [colLabels, ...results.map((r: Record<string, any>) => selectedColumns.map(c => r[c] ?? ""))];
    const csv = rows.map(r => r.map((c: any) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${reportName.replace(/\s+/g, "-").toLowerCase()}-${new Date().toISOString().split("T")[0]}.csv`; a.click(); URL.revokeObjectURL(url);
    toast.success("Report exported");
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-purple-600" />
            Custom Report Builder
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Build and export custom dispute reports with filters and column selection</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left panel — configuration */}
        <div className="lg:col-span-1 space-y-4">
          {/* Report name */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Report Name</CardTitle></CardHeader>
            <CardContent>
              <Input value={reportName} onChange={e => setReportName(e.target.value)} />
            </CardContent>
          </Card>

          {/* Column selector */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Columns className="h-4 w-4" />Columns ({selectedColumns.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {AVAILABLE_COLUMNS.map(col => (
                <div key={col.id} className="flex items-center gap-2">
                  <Checkbox id={`col-${col.id}`} checked={selectedColumns.includes(col.id)} onCheckedChange={() => toggleColumn(col.id)} />
                  <label htmlFor={`col-${col.id}`} className="text-sm cursor-pointer flex-1">{col.label}</label>
                  <Badge variant="outline" className="text-xs">{col.type}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Filters */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2"><Filter className="h-4 w-4" />Filters</CardTitle>
                <Button variant="outline" size="sm" className="h-6 text-xs" onClick={addFilter}><Plus className="h-3 w-3 mr-1" />Add</Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {filters.length === 0 && <p className="text-xs text-muted-foreground">No filters — showing all records</p>}
              {filters.map(f => {
                const col = AVAILABLE_COLUMNS.find(c => c.id === f.column);
                const ops = col ? FILTER_OPS[col.type]?.ops ?? [] : [];
                return (
                  <div key={f.id} className="space-y-1 p-2 border rounded-lg">
                    <div className="flex items-center justify-between">
                      <Select value={f.column} onValueChange={v => updateFilter(f.id, "column", v)}>
                        <SelectTrigger className="h-7 text-xs flex-1 mr-2"><SelectValue /></SelectTrigger>
                        <SelectContent>{AVAILABLE_COLUMNS.map(c => <SelectItem key={c.id} value={c.id} className="text-xs">{c.label}</SelectItem>)}</SelectContent>
                      </Select>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeFilter(f.id)}><X className="h-3 w-3" /></Button>
                    </div>
                    <Select value={f.op} onValueChange={v => updateFilter(f.id, "op", v)}>
                      <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{ops.map(op => <SelectItem key={op} value={op} className="text-xs">{op.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input className="h-7 text-xs" placeholder="Value..." value={f.value} onChange={e => updateFilter(f.id, "value", e.target.value)} />
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Sort & Limit */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Sort & Limit</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="flex-1 text-xs h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>{AVAILABLE_COLUMNS.map(c => <SelectItem key={c.id} value={c.id} className="text-xs">{c.label}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={sortDir} onValueChange={(v: any) => setSortDir(v)}>
                  <SelectTrigger className="w-20 text-xs h-8"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="asc">ASC</SelectItem><SelectItem value="desc">DESC</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs">Max rows</Label>
                <Input type="number" value={limit} onChange={e => setLimit(Number(e.target.value))} className="h-8 text-xs w-24" min={1} max={1000} />
              </div>
            </CardContent>
          </Card>

          <Button className="w-full" onClick={runReport} disabled={isRunning || selectedColumns.length === 0}>
            <Play className="h-4 w-4 mr-2" />{isRunning ? "Running..." : "Run Report"}
          </Button>
        </div>

        {/* Right panel — results */}
        <div className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">
                  {results ? `Results — ${results.length} rows` : "Results will appear here"}
                </CardTitle>
                {results && results.length > 0 && (
                  <Button variant="outline" size="sm" onClick={exportCSV}>
                    <Download className="h-4 w-4 mr-2" />Export CSV
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {!results ? (
                <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
                  <BarChart3 className="h-12 w-12 mb-3 opacity-30" />
                  <p className="text-sm">Configure your report and click Run Report</p>
                </div>
              ) : results.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
                  <p className="text-sm">No results match the current filters</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        {selectedColumns.map(col => (
                          <th key={col} className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                            {AVAILABLE_COLUMNS.find(c => c.id === col)?.label ?? col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {results.map((row, i) => (
                        <tr key={i} className="hover:bg-muted/30">
                          {selectedColumns.map(col => (
                            <td key={col} className="px-3 py-2 max-w-32 truncate">
                              {row[col] == null ? <span className="text-muted-foreground">—</span> :
                                typeof row[col] === "number" && (col.includes("Amount") || col.includes("amount")) ?
                                  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(row[col]) :
                                  col.includes("At") || col.includes("Date") ? new Date(row[col]).toLocaleDateString() :
                                    String(row[col])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
