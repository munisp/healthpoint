import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Upload, FileText, CheckCircle2, AlertTriangle, Download, RefreshCw, X, Table } from "lucide-react";

const SAMPLE_CSV = `referenceNumber,respondingPartyName,initiatingPartyName,billedAmount,serviceType,patientState,facilityState
IDR-SAMPLE-001,Blue Cross Blue Shield,Memorial Hospital,12500.00,emergency_medicine,CA,CA
IDR-SAMPLE-002,Aetna Health,City Medical Center,8750.50,radiology,NY,NY
IDR-SAMPLE-003,United Healthcare,Regional Clinic,5200.00,anesthesiology,TX,TX`;

export default function CSVImport() {
  const [csvContent, setCsvContent] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<{ headers: string[]; preview: Record<string, string>[]; totalRows: number } | null>(null);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const previewMutation = trpc.csvImport.preview.useMutation({
    onSuccess: (data) => setPreview(data),
    onError: (e) => toast.error("Preview failed: " + e.message),
  });

  const importMutation = trpc.csvImport.import.useMutation({
    onSuccess: (data) => {
      setImportResult(data);
      toast.success(`Import complete: ${data.imported} disputes imported`);
    },
    onError: (e) => toast.error("Import failed: " + e.message),
  });

  const handleFile = (file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setCsvContent(content);
      setPreview(null);
      setImportResult(null);
      previewMutation.mutate({ csvContent: content });
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith(".csv")) handleFile(file);
    else toast.error("Please drop a .csv file");
  };

  const downloadSample = () => {
    const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "healthpoint-import-sample.csv"; a.click(); URL.revokeObjectURL(url);
  };

  const reset = () => {
    setCsvContent(""); setFileName(""); setPreview(null); setImportResult(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Upload className="h-6 w-6 text-cyan-600" />
            CSV Import
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Bulk import disputes from a CSV file</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={downloadSample}>
            <Download className="h-4 w-4 mr-2" />Download Sample CSV
          </Button>
          {(csvContent || importResult) && (
            <Button variant="outline" size="sm" onClick={reset}>
              <X className="h-4 w-4 mr-2" />Reset
            </Button>
          )}
        </div>
      </div>

      {/* Import result */}
      {importResult && (
        <Card className={importResult.errors.length > 0 ? "border-amber-300" : "border-green-300"}>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3 mb-3">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <h3 className="font-semibold">Import Complete</h3>
            </div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="p-3 bg-green-50 dark:bg-green-950/20 rounded-lg">
                <div className="text-2xl font-bold text-green-600">{importResult.imported}</div>
                <div className="text-xs text-muted-foreground">Imported</div>
              </div>
              <div className="p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg">
                <div className="text-2xl font-bold text-amber-600">{importResult.skipped}</div>
                <div className="text-xs text-muted-foreground">Skipped</div>
              </div>
              <div className="p-3 bg-red-50 dark:bg-red-950/20 rounded-lg">
                <div className="text-2xl font-bold text-red-600">{importResult.errors.length}</div>
                <div className="text-xs text-muted-foreground">Errors</div>
              </div>
            </div>
            {importResult.errors.length > 0 && (
              <div className="mt-3 space-y-1">
                <p className="text-xs font-medium text-red-600">Errors:</p>
                {importResult.errors.map((e, i) => (
                  <p key={i} className="text-xs text-red-500 bg-red-50 dark:bg-red-950/20 px-2 py-1 rounded">{e}</p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Upload area */}
      {!importResult && (
        <div
          className="border-2 border-dashed border-muted-foreground/30 rounded-xl p-10 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          onClick={() => fileRef.current?.click()}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
          <Upload className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
          {fileName ? (
            <div>
              <p className="font-medium flex items-center justify-center gap-2">
                <FileText className="h-4 w-4 text-cyan-600" />{fileName}
              </p>
              <p className="text-sm text-muted-foreground mt-1">Click to change file</p>
            </div>
          ) : (
            <div>
              <p className="font-medium">Drop a CSV file here or click to browse</p>
              <p className="text-sm text-muted-foreground mt-1">Supports .csv files up to 500KB</p>
            </div>
          )}
        </div>
      )}

      {/* Preview */}
      {preview && !importResult && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Table className="h-4 w-4" />
                Preview — {preview.totalRows} rows detected
                {preview.totalRows > 10 && <Badge variant="outline" className="text-xs">Showing first 10</Badge>}
              </CardTitle>
              <Button
                size="sm"
                onClick={() => importMutation.mutate({ csvContent })}
                disabled={importMutation.isPending}
              >
                {importMutation.isPending ? (
                  <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Importing...</>
                ) : (
                  <><Upload className="h-4 w-4 mr-2" />Import {preview.totalRows} disputes</>
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    {preview.headers.map(h => (
                      <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {preview.preview.map((row, i) => (
                    <tr key={i} className="hover:bg-muted/30">
                      {preview.headers.map(h => (
                        <td key={h} className="px-3 py-2 max-w-32 truncate">
                          {row[h] || <span className="text-muted-foreground/50">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Required columns info */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">CSV Format Guide</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="font-medium text-xs mb-2 text-green-600">Required Columns</p>
              <div className="space-y-1">
                {[["respondingPartyName", "Payer/insurer name"], ["initiatingPartyName", "Provider/facility name"]].map(([col, desc]) => (
                  <div key={col} className="flex items-start gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
                    <span><code className="text-xs bg-muted px-1 rounded">{col}</code> — {desc}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="font-medium text-xs mb-2 text-blue-600">Optional Columns</p>
              <div className="space-y-1">
                {[["referenceNumber", "Claim reference"], ["billedAmount", "Billed amount (USD)"], ["serviceType", "e.g. emergency_medicine"], ["patientState", "2-letter state code"], ["facilityState", "2-letter state code"], ["cptCodes", "Semicolon-separated codes"]].map(([col, desc]) => (
                  <div key={col} className="flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-blue-400 mt-0.5 shrink-0" />
                    <span><code className="text-xs bg-muted px-1 rounded">{col}</code> — {desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
