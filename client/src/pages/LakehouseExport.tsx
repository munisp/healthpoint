import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Database, Download, FileJson, FileSpreadsheet,
  Scale, FileText, Activity, BookOpen, Zap, Loader2,
  AlertCircle, CheckCircle2, Info
} from "lucide-react";

type TableName = "disputes" | "documents" | "audit" | "ledger" | "events";
type ExportFormat = "ndjson" | "csv";

const TABLE_OPTIONS: { id: TableName; label: string; description: string; icon: React.ReactNode }[] = [
  {
    id: "disputes",
    label: "Disputes",
    description: "All IDR dispute records with full metadata",
    icon: <Scale className="h-4 w-4 text-blue-500" />,
  },
  {
    id: "documents",
    label: "Documents",
    description: "Uploaded documents and OCR analysis results",
    icon: <FileText className="h-4 w-4 text-purple-500" />,
  },
  {
    id: "audit",
    label: "Audit Log",
    description: "Complete immutable audit trail of all actions",
    icon: <Activity className="h-4 w-4 text-amber-500" />,
  },
  {
    id: "ledger",
    label: "Financial Ledger",
    description: "Double-entry journal entries and account balances",
    icon: <BookOpen className="h-4 w-4 text-green-500" />,
  },
  {
    id: "events",
    label: "Event Log",
    description: "Kafka-style event bus log for all domain events",
    icon: <Zap className="h-4 w-4 text-red-500" />,
  },
];

export default function LakehouseExport() {
  const [selectedTables, setSelectedTables] = useState<TableName[]>(["disputes"]);
  const [format, setFormat] = useState<ExportFormat>("ndjson");
  const [lastExport, setLastExport] = useState<{
    downloadUrl: string;
    rowCount: number;
    tables: string[];
    format: string;
    exportedAt: string;
  } | null>(null);

  const exportMutation = trpc.lakehouse.export.useMutation({
    onSuccess: (data) => {
      setLastExport(data);
      toast.success(`Export complete — ${data.rowCount.toLocaleString()} rows across ${data.tables.length} table(s)`);
    },
    onError: (err) => {
      if (err.message.includes("FORBIDDEN")) {
        toast.error("Admin access required to export data");
      } else {
        toast.error(err.message);
      }
    },
  });

  function toggleTable(table: TableName) {
    setSelectedTables(prev =>
      prev.includes(table) ? prev.filter(t => t !== table) : [...prev, table]
    );
  }

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-3xl mx-auto">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Database className="h-6 w-6 text-primary" />
            Lakehouse Export
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Export platform data in Apache Iceberg / Delta Lake compatible formats (NDJSON or CSV)
          </p>
        </div>

        {/* Info banner */}
        <div className="flex gap-3 p-4 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg text-sm text-blue-700 dark:text-blue-300">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Admin-only feature</p>
            <p className="mt-0.5 opacity-80">
              Exports are stored in S3 and a presigned download URL is returned. Files are compatible with
              Apache Spark, Trino, Hudi, Iceberg, and Delta Lake ingestion pipelines.
            </p>
          </div>
        </div>

        {/* Table selection */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Select Tables</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {TABLE_OPTIONS.map(opt => (
              <div
                key={opt.id}
                className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/30 cursor-pointer"
                onClick={() => toggleTable(opt.id)}
              >
                <Checkbox
                  id={opt.id}
                  checked={selectedTables.includes(opt.id)}
                  onCheckedChange={() => toggleTable(opt.id)}
                  className="mt-0.5"
                />
                <div className="flex items-start gap-2">
                  {opt.icon}
                  <div>
                    <Label htmlFor={opt.id} className="font-medium cursor-pointer">{opt.label}</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Format selection */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Export Format</CardTitle>
          </CardHeader>
          <CardContent>
            <RadioGroup value={format} onValueChange={(v) => setFormat(v as ExportFormat)} className="space-y-3">
              <div
                className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/30 cursor-pointer"
                onClick={() => setFormat("ndjson")}
              >
                <RadioGroupItem value="ndjson" id="ndjson" className="mt-0.5" />
                <div className="flex items-start gap-2">
                  <FileJson className="h-4 w-4 text-green-500 mt-0.5" />
                  <div>
                    <Label htmlFor="ndjson" className="font-medium cursor-pointer">NDJSON (Newline-delimited JSON)</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      One JSON object per line. Ideal for Spark, Flink, and streaming ingestion.
                      Each record includes <code className="bg-muted px-1 rounded">_table</code> and <code className="bg-muted px-1 rounded">_exported_at</code> metadata fields.
                    </p>
                  </div>
                </div>
              </div>
              <div
                className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/30 cursor-pointer"
                onClick={() => setFormat("csv")}
              >
                <RadioGroupItem value="csv" id="csv" className="mt-0.5" />
                <div className="flex items-start gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-blue-500 mt-0.5" />
                  <div>
                    <Label htmlFor="csv" className="font-medium cursor-pointer">CSV (Comma-separated values)</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Standard CSV with header row. Compatible with Excel, Tableau, and most BI tools.
                      JSON columns are serialized as escaped strings.
                    </p>
                  </div>
                </div>
              </div>
            </RadioGroup>
          </CardContent>
        </Card>

        {/* Export button */}
        <div className="flex items-center gap-4">
          <Button
            size="lg"
            disabled={selectedTables.length === 0 || exportMutation.isPending}
            onClick={() => exportMutation.mutate({ tables: selectedTables, format })}
            className="gap-2"
          >
            {exportMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {exportMutation.isPending ? "Exporting..." : "Export to Lakehouse"}
          </Button>
          {selectedTables.length === 0 && (
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              <AlertCircle className="h-3 w-3" /> Select at least one table
            </span>
          )}
        </div>

        {/* Last export result */}
        {lastExport && (
          <Card className="border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/20">
            <CardContent className="pt-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-green-700 dark:text-green-300">Export successful</p>
                  <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                    <div className="flex gap-4">
                      <span><strong>Rows:</strong> {lastExport.rowCount.toLocaleString()}</span>
                      <span><strong>Format:</strong> {lastExport.format.toUpperCase()}</span>
                      <span><strong>Tables:</strong> {lastExport.tables.join(", ")}</span>
                    </div>
                    <div>
                      <strong>Exported at:</strong> {new Date(lastExport.exportedAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="mt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2 border-green-300 text-green-700 hover:bg-green-100 dark:border-green-700 dark:text-green-300"
                      onClick={() => window.open(lastExport.downloadUrl, "_blank")}
                    >
                      <Download className="h-3 w-3" />
                      Download Export File
                    </Button>
                    <p className="text-xs text-muted-foreground mt-1">
                      Presigned URL valid for 60 minutes
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Architecture note */}
        <Separator />
        <div className="text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-sm">Production Architecture</p>
          <p>In production, this pipeline would write to an Apache Iceberg table in S3 via a Spark or Flink job, with schema evolution managed by the Iceberg catalog. The Trino query engine provides ad-hoc SQL access. Hudi or Delta Lake can be substituted depending on the streaming requirements.</p>
          <p className="mt-1">The current implementation writes NDJSON/CSV directly to S3 and returns a presigned URL, providing the same data contract as the production pipeline.</p>
        </div>
      </div>
    </DashboardLayout>
  );
}
