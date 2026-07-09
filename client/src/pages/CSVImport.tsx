import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Upload, FileText, CheckCircle2, AlertTriangle, Download, RefreshCw, X, Table, Wand2, Sparkles, Info } from "lucide-react";

const SAMPLE_CSV = `referenceNumber,respondingPartyName,initiatingPartyName,billedAmount,serviceType,patientState,facilityState
IDR-SAMPLE-001,Blue Cross Blue Shield,Memorial Hospital,12500.00,emergency_medicine,CA,CA
IDR-SAMPLE-002,Aetna Health,City Medical Center,8750.50,radiology,NY,NY
IDR-SAMPLE-003,United Healthcare,Regional Clinic,5200.00,anesthesiology,TX,TX`;

// Canonical target fields with aliases for auto-mapping
const TARGET_FIELDS: { key: string; label: string; required: boolean; aliases: string[] }[] = [
  { key: "respondingPartyName", label: "Responding Party (Payer)", required: true, aliases: ["payer", "insurer", "insurance", "responding_party", "respondingparty", "payer_name", "payername", "insurance_company", "carrier"] },
  { key: "initiatingPartyName", label: "Initiating Party (Provider)", required: true, aliases: ["provider", "facility", "hospital", "initiating_party", "initiatingparty", "provider_name", "providername", "physician", "clinic", "practice"] },
  { key: "referenceNumber", label: "Reference Number", required: false, aliases: ["ref", "reference", "claim_number", "claimnumber", "claim_id", "claimid", "dispute_id", "disputeid", "id", "case_number"] },
  { key: "billedAmount", label: "Billed Amount ($)", required: false, aliases: ["billed", "amount", "charge", "charges", "total", "bill", "billed_amount", "billedamount", "claim_amount", "claimamount", "total_charge"] },
  { key: "serviceType", label: "Service Type", required: false, aliases: ["service", "specialty", "type", "service_type", "servicetype", "department", "specialty_type", "procedure_type"] },
  { key: "patientState", label: "Patient State", required: false, aliases: ["patient_state", "patientstate", "state", "member_state", "memberstate", "patient_location", "residence_state"] },
  { key: "facilityState", label: "Facility State", required: false, aliases: ["facility_state", "facilitystate", "provider_state", "providerstate", "hospital_state", "location_state", "service_state"] },
  { key: "cptCodes", label: "CPT Codes", required: false, aliases: ["cpt", "cpt_codes", "cptcodes", "procedure_codes", "procedurecodes", "codes", "procedure", "hcpcs"] },
];

const SKIP_VALUE = "__skip__";

function autoMapColumns(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const usedTargets = new Set<string>();

  headers.forEach(header => {
    const normalized = header.toLowerCase().replace(/[\s\-]/g, "_").replace(/[^a-z0-9_]/g, "");
    
    for (const field of TARGET_FIELDS) {
      if (usedTargets.has(field.key)) continue;
      // Exact match on key
      if (normalized === field.key.toLowerCase()) {
        mapping[header] = field.key;
        usedTargets.add(field.key);
        return;
      }
      // Match on aliases
      if (field.aliases.some(alias => normalized === alias || normalized.includes(alias) || alias.includes(normalized))) {
        mapping[header] = field.key;
        usedTargets.add(field.key);
        return;
      }
    }
    // No match — skip
    mapping[header] = SKIP_VALUE;
  });

  return mapping;
}

function getMappingConfidence(header: string, targetKey: string): "exact" | "fuzzy" | "manual" {
  const normalized = header.toLowerCase().replace(/[\s\-]/g, "_").replace(/[^a-z0-9_]/g, "");
  if (normalized === targetKey.toLowerCase()) return "exact";
  const field = TARGET_FIELDS.find(f => f.key === targetKey);
  if (field?.aliases.some(a => normalized === a)) return "exact";
  return "fuzzy";
}

export default function CSVImport() {
  const [csvContent, setCsvContent] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<{ headers: string[]; preview: Record<string, string>[]; totalRows: number } | null>(null);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [autoMapped, setAutoMapped] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const previewMutation = trpc.csvImport.preview.useMutation({
    onSuccess: (data) => {
      setPreview(data);
      // Auto-map columns on preview
      const suggested = autoMapColumns(data.headers);
      setColumnMapping(suggested);
      setAutoMapped(true);
    },
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
    setAutoMapped(false);
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
    setCsvContent(""); setFileName(""); setPreview(null); setImportResult(null); setColumnMapping({}); setAutoMapped(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const reAutoMap = () => {
    if (!preview) return;
    const suggested = autoMapColumns(preview.headers);
    setColumnMapping(suggested);
    toast.success("Columns re-mapped automatically");
  };

  const mappedCount = Object.values(columnMapping).filter(v => v !== SKIP_VALUE).length;
  const requiredMapped = TARGET_FIELDS.filter(f => f.required).every(f =>
    Object.values(columnMapping).includes(f.key)
  );

  // Build remapped CSV content for import
  const buildRemappedCSV = () => {
    if (!preview || !csvContent) return csvContent;
    const lines = csvContent.split("\n").filter(l => l.trim());
    const originalHeaders = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
    const newHeaders = originalHeaders.map(h => columnMapping[h] === SKIP_VALUE ? null : columnMapping[h] || h);
    const filteredIndices = newHeaders.map((h, i) => h ? i : -1).filter(i => i >= 0);
    const filteredNewHeaders = filteredIndices.map(i => newHeaders[i]!);
    const newLines = [filteredNewHeaders.join(",")];
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(",");
      newLines.push(filteredIndices.map(i => cells[i] || "").join(","));
    }
    return newLines.join("\n");
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Upload className="h-6 w-6 text-cyan-600" />
            CSV Import
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Bulk import disputes from a CSV file with intelligent column mapping</p>
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
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
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
              <p className="text-sm text-muted-foreground mt-1">Supports .csv files up to 500KB · Any column names accepted</p>
            </div>
          )}
        </div>
      )}

      {/* Auto-mapping panel */}
      {preview && !importResult && (
        <Card className="border-cyan-200 bg-cyan-50/50 dark:bg-cyan-950/10">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Wand2 className="h-4 w-4 text-cyan-600" />
                Column Mapping
                {autoMapped && (
                  <Badge className="bg-cyan-100 text-cyan-700 border-cyan-300 text-xs gap-1">
                    <Sparkles className="h-3 w-3" />Auto-mapped
                  </Badge>
                )}
              </CardTitle>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{mappedCount}/{preview.headers.length} columns mapped</span>
                <Button variant="outline" size="sm" onClick={reAutoMap} className="h-7 text-xs">
                  <Wand2 className="h-3 w-3 mr-1" />Re-map
                </Button>
              </div>
            </div>
            {!requiredMapped && (
              <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Required fields not yet mapped: {TARGET_FIELDS.filter(f => f.required && !Object.values(columnMapping).includes(f.key)).map(f => f.label).join(", ")}
              </div>
            )}
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {preview.headers.map(header => {
                const mapped = columnMapping[header];
                const confidence = mapped && mapped !== SKIP_VALUE ? getMappingConfidence(header, mapped) : null;
                return (
                  <div key={header} className="flex items-center gap-3 bg-background rounded-lg border p-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded truncate max-w-[120px]">{header}</code>
                        {confidence === "exact" && <Badge variant="outline" className="text-xs text-green-600 border-green-300 bg-green-50 shrink-0">exact</Badge>}
                        {confidence === "fuzzy" && <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 bg-amber-50 shrink-0">fuzzy</Badge>}
                      </div>
                    </div>
                    <span className="text-muted-foreground text-xs">→</span>
                    <Select
                      value={mapped || SKIP_VALUE}
                      onValueChange={val => setColumnMapping(prev => ({ ...prev, [header]: val }))}
                    >
                      <SelectTrigger className="h-8 text-xs w-44 shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SKIP_VALUE} className="text-xs text-muted-foreground">— Skip this column —</SelectItem>
                        {TARGET_FIELDS.map(f => (
                          <SelectItem key={f.key} value={f.key} className="text-xs">
                            {f.label}{f.required ? " *" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
              <Info className="h-3 w-3" />
              Auto-mapping uses header name similarity. Review and adjust any incorrect mappings before importing.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Preview table */}
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
                onClick={() => importMutation.mutate({ csvContent: buildRemappedCSV() })}
                disabled={importMutation.isPending || !requiredMapped}
                title={!requiredMapped ? "Map all required columns first" : undefined}
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
                    {preview.headers.map(h => {
                      const mapped = columnMapping[h];
                      const targetField = TARGET_FIELDS.find(f => f.key === mapped);
                      return (
                        <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                          <div>{h}</div>
                          {mapped && mapped !== SKIP_VALUE && (
                            <div className="text-cyan-600 font-normal">→ {targetField?.label ?? mapped}</div>
                          )}
                          {mapped === SKIP_VALUE && <div className="text-muted-foreground/50 font-normal italic">skipped</div>}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {preview.preview.map((row, i) => (
                    <tr key={i} className="hover:bg-muted/30">
                      {preview.headers.map(h => (
                        <td key={h} className={`px-3 py-2 max-w-32 truncate ${columnMapping[h] === SKIP_VALUE ? "opacity-40" : ""}`}>
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

      {/* Format guide */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Wand2 className="h-4 w-4 text-cyan-600" />Auto-Mapping Intelligence</CardTitle></CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">The auto-mapper recognizes common variations of column names. You can use any of these header names and they will be mapped automatically:</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            {TARGET_FIELDS.map(f => (
              <div key={f.key} className="space-y-1">
                <div className="flex items-center gap-1.5">
                  {f.required ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> : <AlertTriangle className="h-3.5 w-3.5 text-blue-400" />}
                  <span className="font-medium">{f.label}</span>
                  {f.required && <Badge variant="outline" className="text-xs text-green-600 border-green-300">required</Badge>}
                </div>
                <div className="flex flex-wrap gap-1 pl-5">
                  {[f.key, ...f.aliases.slice(0, 4)].map(a => (
                    <code key={a} className="bg-muted px-1 rounded text-xs">{a}</code>
                  ))}
                  {f.aliases.length > 4 && <span className="text-muted-foreground">+{f.aliases.length - 4} more</span>}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
