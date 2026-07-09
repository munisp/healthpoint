import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Download, FileText, FileSpreadsheet, FileJson, Filter, CheckSquare } from "lucide-react";
import { toast } from "sonner";

const EXPORT_FIELDS = [
  { key: "referenceNumber", label: "Reference Number", default: true },
  { key: "status", label: "Status", default: true },
  { key: "initiatingPartyName", label: "Provider Name", default: true },
  { key: "respondingPartyName", label: "Payer Name", default: true },
  { key: "serviceType", label: "Service Type", default: true },
  { key: "billedAmount", label: "Billed Amount", default: true },
  { key: "serviceDate", label: "Service Date", default: true },
  { key: "createdAt", label: "Created Date", default: true },
  { key: "closedAt", label: "Closed Date", default: false },
  { key: "notes", label: "Notes", default: false },
  { key: "initiatingPartyNpi", label: "Provider NPI", default: false },
  { key: "cptCodes", label: "CPT Codes", default: false },
  { key: "idrEntityId", label: "IDR Entity ID", default: false },
  { key: "dueDate", label: "Due Date", default: false },
];

export default function DisputeExportCenter() {
  const [format, setFormat] = useState<"csv" | "json" | "tsv">("csv");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedFields, setSelectedFields] = useState<Set<string>>(
    new Set(EXPORT_FIELDS.filter(f => f.default).map(f => f.key))
  );

  const { data, isLoading } = trpc.disputes.list.useQuery({ limit: 500, offset: 0 });
  const disputes = data?.items ?? [];

  const filtered = disputes.filter(d => {
    if (statusFilter !== "all" && d.status !== statusFilter) return false;
    if (dateFrom && d.createdAt && new Date(d.createdAt) < new Date(dateFrom)) return false;
    if (dateTo && d.createdAt && new Date(d.createdAt) > new Date(dateTo + "T23:59:59")) return false;
    return true;
  });

  const toggleField = (key: string) => {
    setSelectedFields(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const selectAll = () => setSelectedFields(new Set(EXPORT_FIELDS.map(f => f.key)));
  const selectDefault = () => setSelectedFields(new Set(EXPORT_FIELDS.filter(f => f.default).map(f => f.key)));

  const exportData = () => {
    const fields = EXPORT_FIELDS.filter(f => selectedFields.has(f.key));
    const rows = filtered.map(d => {
      const row: Record<string, string> = {};
      fields.forEach(f => {
        const val = (d as Record<string, unknown>)[f.key];
        if (val instanceof Date) row[f.label] = val.toISOString().split("T")[0];
        else if (val === null || val === undefined) row[f.label] = "";
        else row[f.label] = String(val);
      });
      return row;
    });

    let content = "";
    let mimeType = "text/plain";
    let ext = format;

    if (format === "csv" || format === "tsv") {
      const sep = format === "csv" ? "," : "\t";
      const header = fields.map(f => `"${f.label}"`).join(sep);
      const body = rows.map(r => fields.map(f => `"${(r[f.label] ?? "").replace(/"/g, '""')}"`).join(sep)).join("\n");
      content = header + "\n" + body;
      mimeType = format === "csv" ? "text/csv" : "text/tab-separated-values";
    } else if (format === "json") {
      content = JSON.stringify(rows, null, 2);
      mimeType = "application/json";
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `disputes-export-${new Date().toISOString().split("T")[0]}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} disputes as ${format.toUpperCase()}`);
  };

  const formatIcons = { csv: <FileSpreadsheet className="h-4 w-4" />, json: <FileJson className="h-4 w-4" />, tsv: <FileText className="h-4 w-4" /> };

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Download className="h-6 w-6 text-green-600" />
          Export Center
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Export dispute data in CSV, TSV, or JSON format with custom field selection</p>
      </div>

      {/* Format selection */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Export Format</CardTitle></CardHeader>
        <CardContent className="flex gap-3">
          {(["csv", "tsv", "json"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFormat(f)}
              className={`flex items-center gap-2 px-4 py-3 rounded-lg border-2 text-sm font-medium transition-colors ${format === f ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-muted-foreground"}`}
            >
              {formatIcons[f]}
              {f.toUpperCase()}
            </button>
          ))}
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Filter className="h-4 w-4" />Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-medium mb-1 block">Status</label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {["open_negotiation","idr_initiated","determination_issued","closed","appealed","ineligible"].map(s => (
                  <SelectItem key={s} value={s} className="text-xs capitalize">{s.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">Created From</label>
            <Input type="date" className="text-xs" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">Created To</label>
            <Input type="date" className="text-xs" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {/* Field selection */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2"><CheckSquare className="h-4 w-4" />Fields to Export</CardTitle>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="text-xs" onClick={selectDefault}>Default</Button>
              <Button variant="ghost" size="sm" className="text-xs" onClick={selectAll}>All</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {EXPORT_FIELDS.map(f => (
              <div key={f.key} className="flex items-center gap-2">
                <Checkbox
                  id={f.key}
                  checked={selectedFields.has(f.key)}
                  onCheckedChange={() => toggleField(f.key)}
                />
                <label htmlFor={f.key} className="text-xs cursor-pointer">{f.label}</label>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Export button */}
      <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
        <div>
          <p className="font-medium text-sm">{filtered.length} disputes ready to export</p>
          <p className="text-xs text-muted-foreground">{selectedFields.size} fields selected · {format.toUpperCase()} format</p>
        </div>
        <Button onClick={exportData} disabled={isLoading || filtered.length === 0 || selectedFields.size === 0} className="gap-2">
          <Download className="h-4 w-4" />
          Export {filtered.length} Disputes
        </Button>
      </div>
    </div>
  );
}
