import { useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Upload, FileText, Scan, CheckCircle2, AlertCircle, Loader2,
  Eye, Copy, ArrowRight, Brain, FileSearch, Zap, RotateCcw,
  ChevronRight, Info,
} from "lucide-react";

type DocType = "eob" | "ra" | "cms1500" | "ub04" | "appeal" | "other";

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

function FieldRow({ label, value, mono = false }: { label: string; value: string | boolean | string[]; mono?: boolean }) {
  const display = Array.isArray(value) ? value.join(", ") || "—" : typeof value === "boolean" ? (value ? "Yes" : "No") : value || "—";
  const copyValue = Array.isArray(value) ? value.join(", ") : String(value);

  return (
    <div className="flex items-start justify-between py-2 border-b border-border/40 last:border-0 gap-4">
      <span className="text-xs text-muted-foreground shrink-0 w-40">{label}</span>
      <span className={`text-sm font-medium text-right flex-1 ${mono ? "font-mono" : ""}`}>{display}</span>
      {copyValue && copyValue !== "—" && (
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
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [showRawText, setShowRawText] = useState(false);

  const analyzeMutation = trpc.docIntelligence.analyze.useMutation({
    onSuccess: (data) => {
      setCurrentStep(4);
      setStepProgress(100);
      if (data.extractedFields) {
        setExtractedFields(data.extractedFields as ExtractedFields);
      }
      setAnalysisId(data.id);
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

    // Simulate pipeline progress
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
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Brain className="h-6 w-6 text-primary" />
              Document Intelligence
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              VLM-powered OCR pipeline — extract structured fields from EOB, RA, CMS-1500, and UB-04 documents
            </p>
          </div>
          <Badge variant="secondary" className="gap-1">
            <Zap className="h-3 w-3" />
            Vision Language Model
          </Badge>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Left: Upload + Pipeline */}
          <div className="lg:col-span-2 space-y-4">
            {/* Document Type Selector */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Document Type</CardTitle>
              </CardHeader>
              <CardContent>
                <Select value={docType} onValueChange={(v) => setDocType(v as DocType)}>
                  <SelectTrigger>
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
              <CardContent className="py-8 text-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept="image/*,application/pdf"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                />
                {selectedFile ? (
                  <div className="space-y-2">
                    <FileText className="h-10 w-10 mx-auto text-primary" />
                    <p className="font-medium text-sm">{selectedFile.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(selectedFile.size / 1024).toFixed(1)} KB · {selectedFile.type}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); setSelectedFile(null); setPreviewUrl(null); setExtractedFields(null); setCurrentStep(-1); }}
                    >
                      <RotateCcw className="h-3 w-3 mr-1" />
                      Change file
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Upload className="h-10 w-10 mx-auto text-muted-foreground" />
                    <p className="font-medium text-sm">Drop document here</p>
                    <p className="text-xs text-muted-foreground">PNG, JPG, WEBP, PDF · Max 10 MB</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Preview */}
            {previewUrl && selectedFile?.type.startsWith("image/") && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
                    <Eye className="h-3 w-3" /> Preview
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <img src={previewUrl} alt="Document preview" className="w-full rounded border object-contain max-h-48" />
                </CardContent>
              </Card>
            )}

            {/* Analyze Button */}
            <Button
              className="w-full"
              size="lg"
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
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Analysis Pipeline</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Progress value={stepProgress} className="h-2" />
                  {PIPELINE_STEPS.map((step, i) => {
                    const Icon = step.icon;
                    const done = i < currentStep || (i === currentStep && !isAnalyzing);
                    const active = i === currentStep && isAnalyzing;
                    return (
                      <div key={step.id} className={`flex items-center gap-3 text-sm ${done ? "text-foreground" : active ? "text-primary" : "text-muted-foreground"}`}>
                        {done ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                        ) : active ? (
                          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                        ) : (
                          <Icon className="h-4 w-4 shrink-0 opacity-40" />
                        )}
                        <div>
                          <p className="font-medium leading-none">{step.label}</p>
                          <p className="text-xs text-muted-foreground">{step.desc}</p>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right: Extracted Fields */}
          <div className="lg:col-span-3 space-y-4">
            {extractedFields ? (
              <>
                {/* Confidence Banner */}
                <Card className={confidence >= 80 ? "border-green-500/30 bg-green-500/5" : confidence >= 60 ? "border-yellow-500/30 bg-yellow-500/5" : "border-red-500/30 bg-red-500/5"}>
                  <CardContent className="py-3 flex items-center justify-between">
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

                {/* Fields Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Patient Info */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Patient Information</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <FieldRow label="Patient Name" value={extractedFields.patientName} />
                      <FieldRow label="Date of Birth" value={extractedFields.patientDOB} />
                      <FieldRow label="Member ID" value={extractedFields.patientId} mono />
                    </CardContent>
                  </Card>

                  {/* Provider Info */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Provider Information</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <FieldRow label="Provider Name" value={extractedFields.providerName} />
                      <FieldRow label="NPI" value={extractedFields.providerNPI} mono />
                      <FieldRow label="Out-of-Network" value={extractedFields.isOutOfNetwork} />
                    </CardContent>
                  </Card>

                  {/* Payer Info */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Payer / Claim Details</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <FieldRow label="Payer Name" value={extractedFields.payerName} />
                      <FieldRow label="Payer ID" value={extractedFields.payerId} mono />
                      <FieldRow label="Claim Number" value={extractedFields.claimNumber} mono />
                      <FieldRow label="Date of Service" value={extractedFields.dateOfService} />
                    </CardContent>
                  </Card>

                  {/* Financial */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Financial Summary</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <FieldRow label="Billed Amount" value={extractedFields.billedAmount} mono />
                      <FieldRow label="Allowed Amount" value={extractedFields.allowedAmount} mono />
                      <FieldRow label="Paid Amount" value={extractedFields.paidAmount} mono />
                      <FieldRow label="Patient Resp." value={extractedFields.patientResponsibility} mono />
                    </CardContent>
                  </Card>

                  {/* Denial */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Denial / Adjustment</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <FieldRow label="Denial Code" value={extractedFields.denialCode} mono />
                      <FieldRow label="Denial Reason" value={extractedFields.denialReason} />
                    </CardContent>
                  </Card>

                  {/* Codes */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Procedure & Diagnosis Codes</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <FieldRow label="CPT Codes" value={extractedFields.cptCodes} mono />
                      <FieldRow label="ICD-10 Codes" value={extractedFields.icd10Codes} mono />
                      <FieldRow label="Service Type" value={extractedFields.serviceType} />
                      <FieldRow label="Facility State" value={extractedFields.facilityState} />
                    </CardContent>
                  </Card>
                </div>

                {/* NSA Applicability */}
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

                {/* Raw OCR Text Toggle */}
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
              </>
            ) : (
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
                    {["Patient & Provider", "Financial Data", "CPT / ICD Codes"].map(label => (
                      <div key={label} className="flex flex-col items-center gap-1 p-3 rounded-lg bg-muted/50">
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                        <span>{label}</span>
                      </div>
                    ))}
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
