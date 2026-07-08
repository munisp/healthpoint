import { useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Upload, FileText, Scan, CheckCircle2, AlertCircle, Loader2,
  Eye, Copy, ArrowRight, Brain, FileSearch, Zap, RotateCcw,
  ChevronRight, Info, Columns2, LayoutList, ZoomIn, ZoomOut,
} from "lucide-react";

type DocType = "eob" | "ra" | "cms1500" | "ub04" | "appeal" | "other";
type ViewMode = "side-by-side" | "fields-only";

interface ExtractedFields {
  patientName: string;
  patientDOB: string;
  patientId: string;
  providerName: string;
  providerNPI: string;
  payerName: string;
  payerId: string;
  claimNumber: string;
  dateOfService: string;
  billedAmount: string;
  allowedAmount: string;
  paidAmount: string;
  patientResponsibility: string;
  denialReason: string;
  denialCode: string;
  cptCodes: string[];
  icd10Codes: string[];
  serviceType: string;
  facilityState: string;
  isOutOfNetwork: boolean;
  nsaApplicable: boolean;
  rawText: string;
  confidence: number;
  notes: string;
}

const DOC_TYPE_LABELS: Record<DocType, string> = {
  eob: "Explanation of Benefits (EOB)",
  ra: "Remittance Advice (RA)",
  cms1500: "CMS-1500 Claim Form",
  ub04: "UB-04 Facility Claim",
  appeal: "Appeal Letter",
  other: "Other Medical Document",
};

const PIPELINE_STEPS = [
  { id: "upload", label: "Document Upload", icon: Upload, desc: "Secure S3 upload" },
  { id: "preprocess", label: "Pre-processing", icon: FileSearch, desc: "Image enhancement" },
  { id: "ocr", label: "VLM OCR Engine", icon: Scan, desc: "Vision language model" },
  { id: "extract", label: "Field Extraction", icon: Brain, desc: "Structured parsing" },
  { id: "validate", label: "Validation", icon: CheckCircle2, desc: "NSA compliance check" },
];

// Field groups with their labels for side-by-side comparison
const FIELD_GROUPS = [
  {
    title: "Patient Information",
    color: "blue",
    fields: [
      { key: "patientName", label: "Patient Name" },
      { key: "patientDOB", label: "Date of Birth" },
      { key: "patientId", label: "Member ID", mono: true },
    ],
  },
  {
    title: "Provider Information",
    color: "purple",
    fields: [
      { key: "providerName", label: "Provider Name" },
      { key: "providerNPI", label: "NPI", mono: true },
      { key: "isOutOfNetwork", label: "Out-of-Network" },
    ],
  },
  {
    title: "Payer / Claim Details",
    color: "orange",
    fields: [
      { key: "payerName", label: "Payer Name" },
      { key: "payerId", label: "Payer ID", mono: true },
      { key: "claimNumber", label: "Claim Number", mono: true },
      { key: "dateOfService", label: "Date of Service" },
    ],
  },
  {
    title: "Financial Summary",
    color: "green",
    fields: [
      { key: "billedAmount", label: "Billed Amount", mono: true },
      { key: "allowedAmount", label: "Allowed Amount", mono: true },
      { key: "paidAmount", label: "Paid Amount", mono: true },
      { key: "patientResponsibility", label: "Patient Resp.", mono: true },
    ],
  },
  {
    title: "Denial / Adjustment",
    color: "red",
    fields: [
      { key: "denialCode", label: "Denial Code", mono: true },
      { key: "denialReason", label: "Denial Reason" },
    ],
  },
  {
    title: "Procedure & Diagnosis Codes",
    color: "teal",
    fields: [
      { key: "cptCodes", label: "CPT Codes", mono: true },
      { key: "icd10Codes", label: "ICD-10 Codes", mono: true },
      { key: "serviceType", label: "Service Type" },
      { key: "facilityState", label: "Facility State" },
    ],
  },
];

const COLOR_CLASSES: Record<string, { border: string; bg: string; dot: string; header: string }> = {
  blue:   { border: "border-blue-500/30",   bg: "bg-blue-500/5",   dot: "bg-blue-500",   header: "text-blue-700 dark:text-blue-400" },
  purple: { border: "border-purple-500/30", bg: "bg-purple-500/5", dot: "bg-purple-500", header: "text-purple-700 dark:text-purple-400" },
  orange: { border: "border-orange-500/30", bg: "bg-orange-500/5", dot: "bg-orange-500", header: "text-orange-700 dark:text-orange-400" },
  green:  { border: "border-green-500/30",  bg: "bg-green-500/5",  dot: "bg-green-500",  header: "text-green-700 dark:text-green-400" },
  red:    { border: "border-red-500/30",    bg: "bg-red-500/5",    dot: "bg-red-500",    header: "text-red-700 dark:text-red-400" },
  teal:   { border: "border-teal-500/30",   bg: "bg-teal-500/5",   dot: "bg-teal-500",   header: "text-teal-700 dark:text-teal-400" },
};

function getFieldValue(fields: ExtractedFields, key: string): string | boolean | string[] {
  return (fields as unknown as Record<string, string | boolean | string[]>)[key] ?? "—";
}

function formatFieldValue(value: string | boolean | string[]): string {
  if (Array.isArray(value)) return value.join(", ") || "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return value || "—";
}

function FieldRow({
  label, value, mono = false, highlighted = false,
}: {
  label: string;
  value: string | boolean | string[];
  mono?: boolean;
  highlighted?: boolean;
}) {
  const display = formatFieldValue(value);
  const copyValue = Array.isArray(value) ? value.join(", ") : String(value);

  return (
    <div className={`flex items-start justify-between py-2 border-b border-border/40 last:border-0 gap-4 rounded px-1 transition-colors ${highlighted ? "bg-primary/10" : ""}`}>
      <span className="text-xs text-muted-foreground shrink-0 w-36">{label}</span>
      <span className={`text-sm font-medium text-right flex-1 ${mono ? "font-mono" : ""} ${display === "—" ? "text-muted-foreground" : ""}`}>
        {display}
      </span>
      {copyValue && copyValue !== "—" && copyValue !== "false" && (
        <button
          onClick={() => { navigator.clipboard.writeText(copyValue); toast.success("Copied!"); }}
          className="text-muted-foreground hover:text-foreground shrink-0"
        >
          <Copy className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

export default function DocumentAnalyzer() {
  const [, navigate] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [docType, setDocType] = useState<DocType>("eob");
  const [currentStep, setCurrentStep] = useState<number>(-1);
  const [stepProgress, setStepProgress] = useState(0);
  const [extractedFields, setExtractedFields] = useState<ExtractedFields | null>(null);
  const [showRawText, setShowRawText] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("side-by-side");
  const [imageZoom, setImageZoom] = useState(100);
  const [highlightedGroup, setHighlightedGroup] = useState<string | null>(null);

  const analyzeMutation = trpc.docIntelligence.analyze.useMutation({
    onSuccess: (data) => {
      setCurrentStep(4);
      setStepProgress(100);
      if (data.extractedFields) {
        setExtractedFields(data.extractedFields as ExtractedFields);
      }
      toast.success("Document analysis complete!", { description: `${data.confidence ?? 0}% confidence` });
    },
    onError: (err) => {
      setCurrentStep(-1);
      setStepProgress(0);
      toast.error("Analysis failed", { description: err.message });
    },
  });

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
      toast.error("Unsupported file type", { description: "Please upload an image (PNG, JPG, WEBP) or PDF" });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File too large", { description: "Maximum file size is 10 MB" });
      return;
    }
    setSelectedFile(file);
    setExtractedFields(null);
    setCurrentStep(-1);
    setStepProgress(0);
    setHighlightedGroup(null);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const runAnalysis = useCallback(async () => {
    if (!selectedFile) return;
    setCurrentStep(0);
    setStepProgress(20);

    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = (e.target?.result as string).split(",")[1];
      setCurrentStep(1);
      setStepProgress(40);
      await new Promise(r => setTimeout(r, 400));
      setCurrentStep(2);
      setStepProgress(60);
      try {
        await analyzeMutation.mutateAsync({
          fileName: selectedFile.name,
          fileType: selectedFile.type,
          base64Data: base64,
          documentType: docType,
        });
      } catch {
        // handled by onError
      }
    };
    reader.readAsDataURL(selectedFile);
  }, [selectedFile, docType, analyzeMutation]);

  const handleAutoFill = () => {
    if (!extractedFields) return;
    const params = new URLSearchParams();
    if (extractedFields.billedAmount) params.set("billedAmount", extractedFields.billedAmount.replace(/[^0-9.]/g, ""));
    if (extractedFields.serviceType) params.set("serviceType", extractedFields.serviceType);
    if (extractedFields.facilityState) params.set("facilityState", extractedFields.facilityState);
    if (extractedFields.cptCodes?.length) params.set("cptCodes", extractedFields.cptCodes.join(","));
    if (extractedFields.dateOfService) params.set("serviceDate", extractedFields.dateOfService);
    navigate(`/disputes/new?${params.toString()}`);
    toast.success("Fields pre-filled in New Dispute form");
  };

  const isAnalyzing = analyzeMutation.isPending;
  const confidence = extractedFields?.confidence ?? 0;

  return (
    <DashboardLayout>
      <div className="p-6 max-w-screen-2xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Brain className="h-6 w-6 text-primary" />
              Document Intelligence
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              VLM-powered OCR pipeline — extract structured fields from EOB, RA, CMS-1500, and UB-04 documents
            </p>
          </div>
          <div className="flex items-center gap-2">
            {extractedFields && (
              <div className="flex items-center border rounded-lg p-0.5 gap-0.5">
                <Button
                  variant={viewMode === "side-by-side" ? "default" : "ghost"}
                  size="sm"
                  className="h-7 px-2 gap-1"
                  onClick={() => setViewMode("side-by-side")}
                >
                  <Columns2 className="h-3.5 w-3.5" />
                  <span className="text-xs">Side by Side</span>
                </Button>
                <Button
                  variant={viewMode === "fields-only" ? "default" : "ghost"}
                  size="sm"
                  className="h-7 px-2 gap-1"
                  onClick={() => setViewMode("fields-only")}
                >
                  <LayoutList className="h-3.5 w-3.5" />
                  <span className="text-xs">Fields Only</span>
                </Button>
              </div>
            )}
            <Badge variant="secondary" className="gap-1">
              <Zap className="h-3 w-3" />
              Vision Language Model
            </Badge>
          </div>
        </div>

        {/* Main layout: upload controls + content area */}
        <div className={`grid gap-4 ${extractedFields && viewMode === "side-by-side" ? "grid-cols-1 xl:grid-cols-[320px_1fr]" : "grid-cols-1 lg:grid-cols-[320px_1fr]"}`}>
          {/* Left column: controls */}
          <div className="space-y-3">
            {/* Document Type */}
            <Card>
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">Document Type</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <Select value={docType} onValueChange={(v) => setDocType(v as DocType)}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>

            {/* Drop Zone */}
            <Card
              className={`border-2 border-dashed transition-colors cursor-pointer ${
                dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <CardContent className="py-6 text-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept="image/*,application/pdf"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                />
                {selectedFile ? (
                  <div className="space-y-2">
                    <FileText className="h-8 w-8 mx-auto text-primary" />
                    <p className="font-medium text-sm truncate px-2">{selectedFile.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(selectedFile.size / 1024).toFixed(1)} KB
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedFile(null);
                        setPreviewUrl(null);
                        setExtractedFields(null);
                        setCurrentStep(-1);
                        setHighlightedGroup(null);
                      }}
                    >
                      <RotateCcw className="h-3 w-3 mr-1" />
                      Change file
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                    <p className="font-medium text-sm">Drop document here</p>
                    <p className="text-xs text-muted-foreground">PNG, JPG, WEBP, PDF · Max 10 MB</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Analyze Button */}
            <Button
              className="w-full"
              size="default"
              disabled={!selectedFile || isAnalyzing}
              onClick={runAnalysis}
            >
              {isAnalyzing ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Analyzing…</>
              ) : (
                <><Scan className="h-4 w-4 mr-2" />Run Document Analysis</>
              )}
            </Button>

            {/* Pipeline Steps */}
            {currentStep >= 0 && (
              <Card>
                <CardHeader className="pb-2 pt-3 px-4">
                  <CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">Analysis Pipeline</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3 space-y-2">
                  <Progress value={stepProgress} className="h-1.5" />
                  {PIPELINE_STEPS.map((step, i) => {
                    const Icon = step.icon;
                    const done = i < currentStep || (i === currentStep && !isAnalyzing);
                    const active = i === currentStep && isAnalyzing;
                    return (
                      <div key={step.id} className={`flex items-center gap-2 text-xs ${done ? "text-foreground" : active ? "text-primary" : "text-muted-foreground"}`}>
                        {done ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                        ) : active ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                        ) : (
                          <Icon className="h-3.5 w-3.5 shrink-0 opacity-40" />
                        )}
                        <span className="font-medium">{step.label}</span>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

            {/* Field group legend (side-by-side mode) */}
            {extractedFields && viewMode === "side-by-side" && (
              <Card>
                <CardHeader className="pb-2 pt-3 px-4">
                  <CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">Field Groups</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3 space-y-1.5">
                  <p className="text-xs text-muted-foreground mb-2">Click a group to highlight it in both panels</p>
                  {FIELD_GROUPS.map(group => {
                    const colors = COLOR_CLASSES[group.color];
                    const isActive = highlightedGroup === group.title;
                    return (
                      <button
                        key={group.title}
                        className={`w-full flex items-center gap-2 text-xs px-2 py-1.5 rounded transition-colors text-left ${isActive ? `${colors.bg} ${colors.border} border` : "hover:bg-muted/50"}`}
                        onClick={() => setHighlightedGroup(isActive ? null : group.title)}
                      >
                        <span className={`h-2 w-2 rounded-full shrink-0 ${colors.dot}`} />
                        <span className={isActive ? colors.header : ""}>{group.title}</span>
                        <span className="ml-auto text-muted-foreground">{group.fields.length} fields</span>
                      </button>
                    );
                  })}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right column: content */}
          <div className="min-w-0">
            {extractedFields ? (
              <>
                {/* Confidence Banner */}
                <Card className={`mb-4 ${confidence >= 80 ? "border-green-500/30 bg-green-500/5" : confidence >= 60 ? "border-yellow-500/30 bg-yellow-500/5" : "border-red-500/30 bg-red-500/5"}`}>
                  <CardContent className="py-3 flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      {confidence >= 80 ? (
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                      ) : (
                        <AlertCircle className="h-5 w-5 text-yellow-500" />
                      )}
                      <div>
                        <p className="font-semibold text-sm">Extraction Complete</p>
                        <p className="text-xs text-muted-foreground">
                          {confidence}% confidence · {extractedFields.nsaApplicable ? "NSA Applicable" : "NSA may not apply"}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={handleAutoFill}>
                        <ArrowRight className="h-3 w-3 mr-1" />
                        Auto-fill Dispute
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {viewMode === "side-by-side" ? (
                  /* ── SIDE-BY-SIDE VIEW ── */
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                    {/* Left panel: Original document */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold flex items-center gap-1.5">
                          <Eye className="h-4 w-4 text-muted-foreground" />
                          Original Document
                        </h3>
                        {previewUrl && selectedFile?.type.startsWith("image/") && (
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setImageZoom(z => Math.max(50, z - 25))}>
                              <ZoomOut className="h-3.5 w-3.5" />
                            </Button>
                            <span className="text-xs text-muted-foreground w-10 text-center">{imageZoom}%</span>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setImageZoom(z => Math.min(200, z + 25))}>
                              <ZoomIn className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                      <Card className="overflow-hidden">
                        <CardContent className="p-0">
                          {previewUrl && selectedFile?.type.startsWith("image/") ? (
                            <ScrollArea className="h-[600px]">
                              <div className="flex items-start justify-center p-2 bg-muted/30 min-h-full">
                                <img
                                  src={previewUrl}
                                  alt="Original document"
                                  className="rounded border shadow-sm object-contain transition-all"
                                  style={{ width: `${imageZoom}%`, maxWidth: "none" }}
                                />
                              </div>
                            </ScrollArea>
                          ) : selectedFile?.type === "application/pdf" ? (
                            <div className="h-[600px] flex flex-col items-center justify-center text-muted-foreground bg-muted/20 gap-3">
                              <FileText className="h-16 w-16 opacity-30" />
                              <div className="text-center">
                                <p className="font-medium text-sm">{selectedFile.name}</p>
                                <p className="text-xs mt-1">PDF preview not available in browser</p>
                                <p className="text-xs text-muted-foreground/70 mt-0.5">Fields extracted via VLM OCR pipeline</p>
                              </div>
                              <Badge variant="outline" className="gap-1 text-xs">
                                <CheckCircle2 className="h-3 w-3 text-green-500" />
                                Successfully analyzed
                              </Badge>
                            </div>
                          ) : (
                            <div className="h-[600px] flex items-center justify-center text-muted-foreground bg-muted/20">
                              <div className="text-center">
                                <Upload className="h-12 w-12 mx-auto mb-2 opacity-30" />
                                <p className="text-sm">No document preview</p>
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>

                      {/* Raw OCR text in side-by-side */}
                      <Card>
                        <CardHeader
                          className="pb-2 pt-3 px-4 cursor-pointer"
                          onClick={() => setShowRawText(v => !v)}
                        >
                          <CardTitle className="text-xs flex items-center justify-between">
                            <span className="flex items-center gap-1.5 text-muted-foreground uppercase tracking-wide">
                              <FileText className="h-3.5 w-3.5" />Raw OCR Text
                            </span>
                            <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${showRawText ? "rotate-90" : ""}`} />
                          </CardTitle>
                        </CardHeader>
                        {showRawText && (
                          <CardContent className="px-4 pb-3">
                            <ScrollArea className="h-40">
                              <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed">
                                {extractedFields.rawText || "No raw text extracted"}
                              </pre>
                            </ScrollArea>
                          </CardContent>
                        )}
                      </Card>
                    </div>

                    {/* Right panel: Extracted fields */}
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold flex items-center gap-1.5">
                        <Brain className="h-4 w-4 text-muted-foreground" />
                        Extracted Fields
                        <Badge variant="secondary" className="text-xs ml-1">{confidence}% confidence</Badge>
                      </h3>
                      <ScrollArea className="h-[600px] pr-1">
                        <div className="space-y-3 pr-1">
                          {FIELD_GROUPS.map(group => {
                            const colors = COLOR_CLASSES[group.color];
                            const isHighlighted = highlightedGroup === group.title;
                            return (
                              <Card
                                key={group.title}
                                className={`transition-all cursor-pointer ${isHighlighted ? `${colors.border} ${colors.bg} shadow-sm` : "hover:border-border/80"}`}
                                onClick={() => setHighlightedGroup(isHighlighted ? null : group.title)}
                              >
                                <CardHeader className="pb-1 pt-3 px-4">
                                  <CardTitle className={`text-xs font-semibold flex items-center gap-1.5 ${isHighlighted ? colors.header : ""}`}>
                                    <span className={`h-2 w-2 rounded-full ${colors.dot}`} />
                                    {group.title}
                                  </CardTitle>
                                </CardHeader>
                                <CardContent className="px-4 pb-3">
                                  {group.fields.map(f => (
                                    <FieldRow
                                      key={f.key}
                                      label={f.label}
                                      value={getFieldValue(extractedFields, f.key)}
                                      mono={f.mono}
                                      highlighted={isHighlighted}
                                    />
                                  ))}
                                </CardContent>
                              </Card>
                            );
                          })}

                          {/* NSA Card */}
                          <Card className={extractedFields.nsaApplicable ? "border-primary/30 bg-primary/5" : ""}>
                            <CardContent className="py-3 px-4 flex items-center gap-3">
                              <Info className="h-4 w-4 text-primary shrink-0" />
                              <div>
                                <p className="text-sm font-medium">
                                  NSA / No Surprises Act: {extractedFields.nsaApplicable ? "Likely Applicable" : "May Not Apply"}
                                </p>
                                {extractedFields.notes && (
                                  <p className="text-xs text-muted-foreground mt-0.5">{extractedFields.notes}</p>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        </div>
                      </ScrollArea>
                    </div>
                  </div>
                ) : (
                  /* ── FIELDS ONLY VIEW ── */
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {FIELD_GROUPS.map(group => {
                        const colors = COLOR_CLASSES[group.color];
                        return (
                          <Card key={group.title}>
                            <CardHeader className="pb-2">
                              <CardTitle className={`text-sm flex items-center gap-1.5 ${colors.header}`}>
                                <span className={`h-2 w-2 rounded-full ${colors.dot}`} />
                                {group.title}
                              </CardTitle>
                            </CardHeader>
                            <CardContent>
                              {group.fields.map(f => (
                                <FieldRow
                                  key={f.key}
                                  label={f.label}
                                  value={getFieldValue(extractedFields, f.key)}
                                  mono={f.mono}
                                />
                              ))}
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>

                    <Card className={extractedFields.nsaApplicable ? "border-primary/30" : ""}>
                      <CardContent className="py-3 flex items-center gap-3">
                        <Info className="h-4 w-4 text-primary shrink-0" />
                        <div>
                          <p className="text-sm font-medium">
                            NSA / No Surprises Act: {extractedFields.nsaApplicable ? "Likely Applicable" : "May Not Apply"}
                          </p>
                          {extractedFields.notes && (
                            <p className="text-xs text-muted-foreground mt-0.5">{extractedFields.notes}</p>
                          )}
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2 cursor-pointer" onClick={() => setShowRawText(v => !v)}>
                        <CardTitle className="text-sm flex items-center justify-between">
                          <span className="flex items-center gap-2"><FileText className="h-4 w-4" />Raw OCR Text</span>
                          <ChevronRight className={`h-4 w-4 transition-transform ${showRawText ? "rotate-90" : ""}`} />
                        </CardTitle>
                      </CardHeader>
                      {showRawText && (
                        <CardContent>
                          <ScrollArea className="h-48">
                            <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed">
                              {extractedFields.rawText || "No raw text extracted"}
                            </pre>
                          </ScrollArea>
                        </CardContent>
                      )}
                    </Card>
                  </div>
                )}
              </>
            ) : (
              /* Empty state */
              <Card className="h-full min-h-96">
                <CardContent className="h-full flex flex-col items-center justify-center text-center py-16 space-y-4">
                  <div className="rounded-full bg-muted p-6">
                    <Brain className="h-12 w-12 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">VLM Document Intelligence</h3>
                    <p className="text-muted-foreground text-sm mt-2 max-w-sm">
                      Upload an EOB, RA, CMS-1500, or UB-04 document. The Vision Language Model will extract all structured fields for your IDR dispute.
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-3 mt-4 text-xs text-muted-foreground">
                    {[
                      { label: "Side-by-Side View", icon: Columns2 },
                      { label: "25 Structured Fields", icon: CheckCircle2 },
                      { label: "Auto-fill Dispute", icon: ArrowRight },
                    ].map(item => {
                      const Icon = item.icon;
                      return (
                        <div key={item.label} className="flex flex-col items-center gap-1 p-3 rounded-lg bg-muted/50">
                          <Icon className="h-4 w-4 text-primary" />
                          <span>{item.label}</span>
                        </div>
                      );
                    })}
                  </div>
                  <Separator className="w-32" />
                  <p className="text-xs text-muted-foreground">
                    Powered by built-in Vision Language Model · HIPAA-compliant processing
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
