/**
 * Stakeholder Upload Portal
 * ─────────────────────────
 * Drag-and-drop document submission portal for all IDR stakeholders
 * (providers, facilities, payors, aggregators).
 *
 * On upload, the DocumentAnalysisAgent (LangGraph) is automatically
 * triggered to classify, validate, and summarize the document.
 */

import { useState, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Upload, FileText, CheckCircle2, AlertTriangle, Brain,
  Loader2, X, Info, ChevronRight, Scale, Building2,
  Stethoscope, CreditCard, Zap, Shield
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UploadedDoc {
  id: string;
  filename: string;
  size: number;
  uploadedAt: Date;
  disputeId?: string;
  status: "analyzing" | "analyzed" | "error";
  analysis?: {
    documentType: string;
    confidenceScore: number;
    summary: string;
    suggestedAction: string;
    validationIssues: string[];
    eligibilityFlags: string[];
    extractedFields: Record<string, string | number | null>;
    agentTrace?: string[];
    processingTimeSeconds?: number;
  };
  error?: string;
}

const STAKEHOLDER_TYPES = [
  { id: "provider", label: "Provider", icon: Stethoscope, desc: "Physician, surgeon, specialist" },
  { id: "facility", label: "Facility", icon: Building2, desc: "Hospital, ASC, emergency dept" },
  { id: "payer", label: "Payer / Insurer", icon: CreditCard, desc: "Health plan, insurance issuer" },
  { id: "aggregator", label: "Aggregator", icon: Scale, desc: "Billing aggregator, TPA" },
];

const ACCEPTED_DOC_TYPES = [
  "Explanation of Benefits (EOB)",
  "QPA Documentation",
  "Open Negotiation Notice",
  "IDR Initiation Notice",
  "Provider Contract",
  "Medical Records",
  "Prior Authorization",
  "Cost Sharing Information",
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function StakeholderUpload() {
  const { isAuthenticated } = useAuth();
  const [stakeholderType, setStakeholderType] = useState<string>("");
  const [selectedDisputeId, setSelectedDisputeId] = useState<string>("");
  const [docs, setDocs] = useState<UploadedDoc[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: disputesData } = trpc.disputes.list.useQuery({ limit: 50, offset: 0 });
  const analyzeDocMutation = trpc.ai.analyzeDocument.useMutation();

  const processFile = useCallback(async (file: File) => {
    const docId = `doc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const newDoc: UploadedDoc = {
      id: docId,
      filename: file.name,
      size: file.size,
      uploadedAt: new Date(),
      disputeId: selectedDisputeId || undefined,
      status: "analyzing",
    };

    setDocs((prev) => [newDoc, ...prev]);

    // Read file text
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve((e.target?.result as string) || "");
      reader.readAsText(file);
    });

    if (!text.trim()) {
      setDocs((prev) => prev.map((d) => d.id === docId
        ? { ...d, status: "error", error: "Could not extract text from file" }
        : d
      ));
      return;
    }

    // Infer document type hint from filename
    const name = file.name.toLowerCase();
    let docTypeHint: string | undefined;
    if (name.includes("eob") || name.includes("explanation")) docTypeHint = "Explanation of Benefits";
    else if (name.includes("qpa")) docTypeHint = "QPA Documentation";
    else if (name.includes("contract")) docTypeHint = "Provider Contract";
    else if (name.includes("auth")) docTypeHint = "Prior Authorization";
    else if (name.includes("record") || name.includes("medical")) docTypeHint = "Medical Records";
    else if (name.includes("negotiation")) docTypeHint = "Open Negotiation Notice";
    else if (name.includes("idr") || name.includes("initiation")) docTypeHint = "IDR Initiation Notice";

    try {
      const result = await analyzeDocMutation.mutateAsync({
        documentText: text.slice(0, 50000),
        documentType: docTypeHint,
        disputeId: selectedDisputeId || undefined,
      }) as any;

      setDocs((prev) => prev.map((d) => d.id === docId
        ? {
            ...d,
            status: "analyzed",
            analysis: {
              documentType: result.documentType,
              confidenceScore: result.confidenceScore,
              summary: result.summary,
              suggestedAction: result.suggestedAction,
              validationIssues: result.validationIssues || [],
              eligibilityFlags: result.eligibilityFlags || [],
              extractedFields: result.extractedFields || {},
              agentTrace: result.agentTrace,
              processingTimeSeconds: result.processingTimeSeconds,
            },
          }
        : d
      ));
      toast.success(`${file.name} analyzed — ${result.documentType}`);
    } catch (err: any) {
      setDocs((prev) => prev.map((d) => d.id === docId
        ? { ...d, status: "error", error: err.message }
        : d
      ));
      toast.error(`Analysis failed for ${file.name}`);
    }
  }, [selectedDisputeId, analyzeDocMutation]);

  const handleFiles = useCallback((files: FileList) => {
    if (!stakeholderType) {
      toast.error("Please select your stakeholder type first");
      return;
    }
    Array.from(files).forEach((f) => processFile(f));
  }, [stakeholderType, processFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const removeDoc = (id: string) => {
    setDocs((prev) => prev.filter((d) => d.id !== id));
  };

  const confidenceBadge = (score: number) => {
    if (score >= 70) return "text-green-600 bg-green-50 border-green-200";
    if (score >= 40) return "text-yellow-600 bg-yellow-50 border-yellow-200";
    return "text-red-600 bg-red-50 border-red-200";
  };

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full text-center p-8">
          <Upload className="mx-auto mb-3 text-muted-foreground" size={40} />
          <h2 className="text-lg font-semibold">Stakeholder Upload Portal</h2>
          <p className="text-sm text-muted-foreground mt-1">Sign in to upload documents</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-5xl mx-auto flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-primary/10">
          <Upload className="text-primary" size={24} />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Stakeholder Upload Portal</h1>
          <p className="text-sm text-muted-foreground">
            Upload IDR documents — AI analysis runs automatically on every submission
          </p>
        </div>
      </div>

      {/* Step 1: Stakeholder type */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">1</span>
            Select Your Role
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {STAKEHOLDER_TYPES.map((s) => (
              <button
                key={s.id}
                onClick={() => setStakeholderType(s.id)}
                className={`flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all text-center ${
                  stakeholderType === s.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40 hover:bg-accent/30"
                }`}
              >
                <s.icon size={20} className={stakeholderType === s.id ? "text-primary" : "text-muted-foreground"} />
                <div>
                  <p className="text-sm font-medium">{s.label}</p>
                  <p className="text-xs text-muted-foreground">{s.desc}</p>
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Step 2: Dispute context */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">2</span>
            Link to Dispute (Optional)
          </CardTitle>
          <CardDescription>Linking a dispute improves AI analysis accuracy</CardDescription>
        </CardHeader>
        <CardContent>
          <select
            className="w-full text-sm border rounded p-2 bg-background"
            value={selectedDisputeId}
            onChange={(e) => setSelectedDisputeId(e.target.value)}
          >
            <option value="">No dispute linked</option>
            {(disputesData?.items || []).map((d: any) => (
              <option key={d.id} value={d.id}>
                {d.referenceNumber} · {d.serviceType?.replace(/_/g, " ")} · ${d.billedAmount ?? "N/A"}
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      {/* Step 3: Upload */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">3</span>
            Upload Documents
          </CardTitle>
          <CardDescription>
            Accepted: {ACCEPTED_DOC_TYPES.join(", ")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${
              isDragging
                ? "border-primary bg-primary/5 scale-[1.01]"
                : stakeholderType
                  ? "border-border hover:border-primary/50 hover:bg-accent/20"
                  : "border-border/40 opacity-50 cursor-not-allowed"
            }`}
            onDragOver={(e) => { e.preventDefault(); if (stakeholderType) setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => stakeholderType && fileInputRef.current?.click()}
          >
            <div className="flex flex-col items-center gap-3">
              <div className={`p-4 rounded-full ${isDragging ? "bg-primary/20" : "bg-muted"}`}>
                <Upload size={28} className={isDragging ? "text-primary" : "text-muted-foreground"} />
              </div>
              <div>
                <p className="font-semibold text-sm">
                  {isDragging ? "Drop files here" : "Drag & drop files or click to browse"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  TXT, PDF (text-based) · Multiple files supported · AI analysis runs automatically
                </p>
              </div>
              {!stakeholderType && (
                <Badge variant="outline" className="text-xs text-yellow-600 border-yellow-300">
                  <AlertTriangle size={10} className="mr-1" />Select your role above first
                </Badge>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".txt,.pdf,.csv,.json,.doc,.docx"
              className="hidden"
              onChange={(e) => { if (e.target.files) handleFiles(e.target.files); }}
            />
          </div>

          {/* AI badge */}
          <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
            <Brain size={12} className="text-primary" />
            <span>Each upload is automatically analyzed by the <strong>DocumentAnalysisAgent</strong> (LangGraph: classify → validate → summarize)</span>
          </div>
        </CardContent>
      </Card>

      {/* Uploaded documents */}
      {docs.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <FileText size={16} />Uploaded Documents ({docs.length})
          </h2>

          {docs.map((doc) => (
            <Card key={doc.id} className={`transition-all ${
              doc.status === "error" ? "border-red-200" :
              doc.status === "analyzed" ? "border-green-200" : ""
            }`}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={`p-2 rounded-lg shrink-0 ${
                      doc.status === "analyzing" ? "bg-blue-50" :
                      doc.status === "analyzed" ? "bg-green-50" : "bg-red-50"
                    }`}>
                      {doc.status === "analyzing" ? (
                        <Loader2 size={16} className="text-blue-600 animate-spin" />
                      ) : doc.status === "analyzed" ? (
                        <CheckCircle2 size={16} className="text-green-600" />
                      ) : (
                        <AlertTriangle size={16} className="text-red-600" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{doc.filename}</p>
                      <p className="text-xs text-muted-foreground">
                        {(doc.size / 1024).toFixed(1)} KB · {doc.uploadedAt.toLocaleTimeString()}
                        {doc.disputeId && " · Linked to dispute"}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => removeDoc(doc.id)}
                    className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* Analysis progress */}
                {doc.status === "analyzing" && (
                  <div className="mt-3 space-y-1">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Zap size={10} className="text-primary" />
                      Running DocumentAnalysisAgent: classify → validate → summarize
                    </div>
                    <Progress value={undefined} className="h-1 animate-pulse" />
                  </div>
                )}

                {/* Error */}
                {doc.status === "error" && (
                  <Alert variant="destructive" className="mt-3 py-2">
                    <AlertTriangle size={12} />
                    <AlertDescription className="text-xs">{doc.error}</AlertDescription>
                  </Alert>
                )}

                {/* Analysis results */}
                {doc.status === "analyzed" && doc.analysis && (
                  <div className="mt-3 space-y-3">
                    <Separator />
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs">{doc.analysis.documentType}</Badge>
                        <Badge variant="outline" className={`text-xs ${confidenceBadge(doc.analysis.confidenceScore)}`}>
                          <Shield size={10} className="mr-1" />
                          {doc.analysis.confidenceScore}% confidence
                        </Badge>
                        {doc.analysis.processingTimeSeconds && (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            {doc.analysis.processingTimeSeconds}s
                          </Badge>
                        )}
                      </div>
                      {doc.analysis.agentTrace && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          {doc.analysis.agentTrace.map((node, i) => (
                            <span key={node} className="flex items-center gap-1">
                              <span className="px-1.5 py-0.5 bg-muted rounded text-xs">{node}</span>
                              {i < doc.analysis!.agentTrace!.length - 1 && <ChevronRight size={8} />}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <p className="text-xs text-muted-foreground leading-relaxed">{doc.analysis.summary}</p>

                    {/* Extracted fields (compact) */}
                    {Object.keys(doc.analysis.extractedFields).length > 0 && (
                      <div className="grid grid-cols-3 gap-1">
                        {Object.entries(doc.analysis.extractedFields)
                          .filter(([, v]) => v != null)
                          .slice(0, 6)
                          .map(([k, v]) => (
                            <div key={k} className="bg-muted/50 rounded p-1.5">
                              <p className="text-xs text-muted-foreground capitalize leading-tight">
                                {k.replace(/([A-Z])/g, " $1").trim()}
                              </p>
                              <p className="text-xs font-medium truncate">{String(v)}</p>
                            </div>
                          ))}
                      </div>
                    )}

                    {/* Validation issues */}
                    {doc.analysis.validationIssues.length > 0 && (
                      <div className="bg-red-50 border border-red-200 rounded p-2">
                        <p className="text-xs font-semibold text-red-700 mb-1">Validation Issues</p>
                        <ul className="text-xs text-red-700 space-y-0.5">
                          {doc.analysis.validationIssues.map((issue, i) => (
                            <li key={i}>• {issue}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Eligibility flags */}
                    {doc.analysis.eligibilityFlags.length > 0 && (
                      <div className="bg-blue-50 border border-blue-200 rounded p-2">
                        <p className="text-xs font-semibold text-blue-700 mb-1 flex items-center gap-1">
                          <Info size={10} />IDR Eligibility Flags
                        </p>
                        <ul className="text-xs text-blue-700 space-y-0.5">
                          {doc.analysis.eligibilityFlags.map((flag, i) => (
                            <li key={i}>• {flag}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Suggested action */}
                    <div className="bg-green-50 border border-green-200 rounded p-2">
                      <p className="text-xs font-semibold text-green-700 mb-0.5">Suggested Action</p>
                      <p className="text-xs text-green-700">{doc.analysis.suggestedAction}</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Empty state */}
      {docs.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Brain size={40} className="text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No documents uploaded yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Upload your first document above to run the DocumentAnalysisAgent
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
