import { useState, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Sparkles,
  Upload,
  FileText,
  Code2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Loader2,
  Info,
  Wand2,
  Pencil,
  X as XIcon,
  History,
  RotateCcw,
  Clock,
} from "lucide-react";
import { toast } from "sonner";

export type ExtractedField = {
  value: string | number | null;
  confidence: number;
  source: string;
};

export type SmartFormTarget =
  | "dispute"
  | "offer"
  | "cms_submission"
  | "emr_onboarding"
  | "mobile_dispute"
  | "generic";

export interface SmartFormPanelProps {
  /** Which form fields to extract for */
  targetForm: SmartFormTarget;
  /** Called when the user clicks "Apply to Form" — receives the selected field map */
  onApply: (fields: Record<string, ExtractedField>, extractionId: string) => void;
  /** Optional dispute ID to associate the extraction with */
  disputeId?: string;
  /** Custom label for the trigger button */
  triggerLabel?: string;
  /** Whether the panel is shown inline (no modal) */
  inline?: boolean;
  /** Field labels for display (key → human label) */
  fieldLabels?: Record<string, string>;
}

const FIELD_LABELS: Record<SmartFormTarget, Record<string, string>> = {
  dispute: {
    patientName: "Patient Name",
    patientDOB: "Date of Birth",
    patientMemberId: "Member ID",
    providerName: "Provider Name",
    providerNPI: "Provider NPI",
    payerName: "Payer Name",
    payerClaimNumber: "Claim Number",
    serviceDate: "Service Date",
    billedAmount: "Billed Amount",
    allowedAmount: "Allowed Amount",
    qpaAmount: "QPA Amount",
    cptCodes: "CPT Codes",
    diagnosisCodes: "Diagnosis Codes",
    placeOfService: "Place of Service",
    serviceType: "Service Type",
  },
  offer: {
    offerAmount: "Offer Amount",
    rationale: "Rationale",
    counterOfferDeadline: "Counter-Offer Deadline",
    supportingBenchmark: "Supporting Benchmark",
  },
  cms_submission: {
    submissionType: "Submission Type",
    referenceNumber: "Reference Number",
    submissionDate: "Submission Date",
    determinationDeadline: "Determination Deadline",
  },
  emr_onboarding: {
    ehrVendor: "EHR Vendor",
    fhirBaseUrl: "FHIR Base URL",
    clientId: "Client ID",
    organizationName: "Organization Name",
    organizationNPI: "Organization NPI",
  },
  mobile_dispute: {
    patientName: "Patient Name",
    serviceDate: "Service Date",
    billedAmount: "Billed Amount",
    providerName: "Provider Name",
    payerName: "Payer Name",
  },
  generic: {
    title: "Title",
    date: "Date",
    amount: "Amount",
    partyA: "Party A",
    partyB: "Party B",
    referenceNumber: "Reference Number",
    summary: "Summary",
  },
};

function ConfidenceBadge({ confidence, edited }: { confidence: number; edited?: boolean }) {
  if (edited) {
    return (
      <Badge className="text-xs bg-blue-100 text-blue-800 border-blue-200 gap-1">
        <Pencil className="h-3 w-3" />
        Edited
      </Badge>
    );
  }
  if (confidence >= 80) {
    return (
      <Badge className="text-xs bg-green-100 text-green-800 border-green-200 gap-1">
        <CheckCircle2 className="h-3 w-3" />
        {confidence}%
      </Badge>
    );
  }
  if (confidence >= 50) {
    return (
      <Badge className="text-xs bg-amber-100 text-amber-800 border-amber-200 gap-1">
        <AlertTriangle className="h-3 w-3" />
        {confidence}%
      </Badge>
    );
  }
  return (
    <Badge className="text-xs bg-red-100 text-red-800 border-red-200 gap-1">
      <XCircle className="h-3 w-3" />
      {confidence}%
    </Badge>
  );
}

// ─── Inline-editable field row ────────────────────────────────────────────────

function FieldRow({
  fieldKey,
  field,
  label,
  selected,
  onToggle,
  onEdit,
}: {
  fieldKey: string;
  field: ExtractedField;
  label: string;
  selected: boolean;
  onToggle: () => void;
  onEdit: (key: string, newValue: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isEdited = field.source === "user_edit";
  const displayValue =
    field.value === null || field.value === undefined ? "—" : String(field.value);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(displayValue);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(field.value === null ? "" : String(field.value));
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const commitEdit = () => {
    onEdit(fieldKey, draft);
    setEditing(false);
  };

  const cancelEdit = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") commitEdit();
    if (e.key === "Escape") cancelEdit();
  };

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
        field.value === null && !editing
          ? "opacity-50 cursor-not-allowed border-muted"
          : selected
          ? "bg-primary/5 border-primary/30"
          : "hover:bg-muted/50 border-border cursor-pointer"
      }`}
      onClick={() => !editing && field.value !== null && onToggle()}
    >
      {/* Checkbox */}
      <input
        type="checkbox"
        checked={selected}
        disabled={field.value === null && !editing}
        onChange={onToggle}
        className="mt-0.5 h-4 w-4 accent-primary shrink-0"
        onClick={(e) => e.stopPropagation()}
      />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {label}
          </span>
          <ConfidenceBadge confidence={field.confidence} edited={isEdited} />
          {!isEdited && field.confidence < 80 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3 w-3 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                <p className="font-medium mb-1">Source:</p>
                <p>{field.source}</p>
                {field.confidence < 50 && (
                  <p className="mt-1 text-amber-600 font-medium">
                    ⚠ Low confidence — please verify before applying
                  </p>
                )}
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Editable value */}
        {editing ? (
          <div className="flex items-center gap-1 mt-1" onClick={(e) => e.stopPropagation()}>
            <Input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-7 text-sm py-0 px-2"
              autoComplete="off"
            />
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50"
              onClick={(e) => { e.stopPropagation(); commitEdit(); }}
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground"
              onClick={cancelEdit}
            >
              <XIcon className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <p className="text-sm font-medium truncate">{displayValue}</p>
        )}
      </div>

      {/* Action buttons (copy + edit) */}
      {!editing && (
        <div className="flex items-center gap-0.5 shrink-0">
          {field.value !== null && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleCopy}
              title="Copy value"
            >
              {copied ? (
                <Check className="h-3 w-3 text-green-600" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-primary"
            onClick={startEdit}
            title="Edit value"
          >
            <Pencil className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── History modal ─────────────────────────────────────────────────────────────

function HistoryModal({
  open,
  onClose,
  targetForm,
  labels,
  onReuse,
}: {
  open: boolean;
  onClose: () => void;
  targetForm: SmartFormTarget;
  labels: Record<string, string>;
  onReuse: (fields: Record<string, ExtractedField>, extractionId: string) => void;
}) {
  const historyQuery = trpc.smartForm.history.useQuery(
    { limit: 20 },
    { enabled: open, staleTime: 0 }
  );

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const history = historyQuery.data ?? [];

  const formatDate = (d: Date | string | null) => {
    if (!d) return "Unknown date";
    const date = typeof d === "string" ? new Date(d) : d;
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-violet-600" />
            Extraction History
          </DialogTitle>
          <DialogDescription>
            Past SmartForm extractions for this form type. Click "Reuse" to apply a previous
            result without re-uploading.
          </DialogDescription>
        </DialogHeader>

        {historyQuery.isLoading && (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!historyQuery.isLoading && history.length === 0 && (
          <div className="text-center py-10 text-muted-foreground">
            <History className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No past extractions found for this form type.</p>
          </div>
        )}

        <div className="space-y-3">
          {history.map((item) => {
            const fields = (() => {
              try {
                return (typeof item.extractedFields === "string"
                  ? JSON.parse(item.extractedFields)
                  : item.extractedFields) as Record<string, ExtractedField>;
              } catch {
                return {} as Record<string, ExtractedField>;
              }
            })();

            const fieldEntries = Object.entries(fields).filter(([, f]) => f.value !== null);
            const isExpanded = expandedId === item.id;

            return (
              <div
                key={item.id}
                className="border rounded-lg overflow-hidden"
              >
                {/* Header row */}
                <div className="flex items-center justify-between p-3 bg-muted/30">
                  <div className="flex items-center gap-2 min-w-0">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {item.documentName ?? "Unnamed document"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(item.createdAt)} · {fieldEntries.length} fields extracted
                        {item.overallConfidence != null && (
                          <> · {item.overallConfidence}% avg confidence</>
                        )}
                        {item.status === "applied" && (
                          <> · <span className="text-green-700 font-medium">Applied</span></>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                    >
                      {isExpanded ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                      {isExpanded ? "Hide" : "Preview"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1 border-violet-200 text-violet-700 hover:bg-violet-50"
                      onClick={() => {
                        onReuse(fields, item.id);
                        onClose();
                      }}
                    >
                      <RotateCcw className="h-3 w-3" />
                      Reuse
                    </Button>
                  </div>
                </div>

                {/* Expanded field preview */}
                {isExpanded && (
                  <div className="p-3 border-t bg-background space-y-1.5 max-h-52 overflow-y-auto">
                    {fieldEntries.length === 0 && (
                      <p className="text-xs text-muted-foreground">No extracted fields available.</p>
                    )}
                    {fieldEntries.map(([key, field]) => (
                      <div key={key} className="flex items-center justify-between text-xs gap-2">
                        <span className="text-muted-foreground uppercase tracking-wide font-medium w-28 shrink-0">
                          {labels[key] ?? key}
                        </span>
                        <span className="flex-1 truncate font-medium">
                          {String(field.value)}
                        </span>
                        <ConfidenceBadge confidence={field.confidence} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function SmartFormPanel({
  targetForm,
  onApply,
  disputeId,
  triggerLabel = "Auto-Fill with AI",
  inline = false,
  fieldLabels,
}: SmartFormPanelProps) {
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [inputType, setInputType] = useState<"text" | "pdf_base64" | "fhir_json">("text");
  const [content, setContent] = useState("");
  const [documentName, setDocumentName] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [extractionResult, setExtractionResult] = useState<{
    extractionId: string;
    extractedFields: Record<string, ExtractedField>;
    overallConfidence: number;
    fieldCount: number;
    highConfidenceCount: number;
    lowConfidenceCount: number;
    processingMs: number;
    modelUsed: string;
  } | null>(null);
  // Local edits overlay — key → overridden value
  const [editedFields, setEditedFields] = useState<Record<string, string>>({});
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
  const [showSource, setShowSource] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const labels = fieldLabels ?? FIELD_LABELS[targetForm] ?? {};

  const extractMutation = trpc.smartForm.extract.useMutation({
    onSuccess: (data) => {
      setExtractionResult(data);
      setEditedFields({});
      // Auto-select all fields with confidence >= 50
      const autoSelected = new Set(
        Object.entries(data.extractedFields)
          .filter(([, f]) => f.value !== null && f.confidence >= 50)
          .map(([k]) => k)
      );
      setSelectedFields(autoSelected);
    },
    onError: (err) => {
      toast.error(`Extraction failed: ${err.message}`);
    },
  });

  const markAppliedMutation = trpc.smartForm.markApplied.useMutation();

  // Merge extracted fields with user edits for display + apply
  const mergedFields = (() => {
    if (!extractionResult) return {};
    const merged: Record<string, ExtractedField> = {};
    for (const [key, field] of Object.entries(extractionResult.extractedFields)) {
      if (key in editedFields) {
        merged[key] = {
          value: editedFields[key],
          confidence: 100,
          source: "user_edit",
        };
      } else {
        merged[key] = field;
      }
    }
    // Also surface any newly added keys from edits (shouldn't happen but guard)
    for (const [key, val] of Object.entries(editedFields)) {
      if (!(key in merged)) {
        merged[key] = { value: val, confidence: 100, source: "user_edit" };
      }
    }
    return merged;
  })();

  const handleEdit = (key: string, newValue: string) => {
    setEditedFields((prev) => ({ ...prev, [key]: newValue }));
    // Auto-select the field when user edits it
    setSelectedFields((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  };

  const handleFileUpload = useCallback((file: File) => {
    setDocumentName(file.name);
    if (file.type === "application/json" || file.name.endsWith(".json")) {
      setInputType("fhir_json");
      const reader = new FileReader();
      reader.onload = (e) => setContent(e.target?.result as string ?? "");
      reader.readAsText(file);
    } else if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
      setInputType("pdf_base64");
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64 = (e.target?.result as string).split(",")[1] ?? "";
        setContent(base64);
      };
      reader.readAsDataURL(file);
    } else {
      setInputType("text");
      const reader = new FileReader();
      reader.onload = (e) => setContent(e.target?.result as string ?? "");
      reader.readAsText(file);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileUpload(file);
    },
    [handleFileUpload]
  );

  const handleExtract = () => {
    if (!content.trim()) {
      toast.error("Please provide document content to extract from.");
      return;
    }
    setExtractionResult(null);
    setEditedFields({});
    extractMutation.mutate({
      inputType,
      content,
      documentName: documentName || undefined,
      targetForm,
      disputeId,
    });
  };

  const handleApply = () => {
    if (!extractionResult) return;
    const fieldsToApply: Record<string, ExtractedField> = {};
    for (const key of Array.from(selectedFields)) {
      if (mergedFields[key]) {
        fieldsToApply[key] = mergedFields[key];
      }
    }
    onApply(fieldsToApply, extractionResult.extractionId);
    markAppliedMutation.mutate({
      extractionId: extractionResult.extractionId,
      appliedFields: Array.from(selectedFields),
    });
    const editCount = Object.keys(editedFields).filter((k) => selectedFields.has(k)).length;
    const msg =
      editCount > 0
        ? `Applied ${selectedFields.size} field${selectedFields.size !== 1 ? "s" : ""} (${editCount} manually edited)`
        : `Applied ${selectedFields.size} field${selectedFields.size !== 1 ? "s" : ""} to the form`;
    toast.success(msg);
    setOpen(false);
    resetState();
  };

  const handleReuseFromHistory = (
    fields: Record<string, ExtractedField>,
    extractionId: string
  ) => {
    // Build a synthetic extraction result from history
    const fieldCount = Object.values(fields).filter((f) => f.value !== null).length;
    const confidences = Object.values(fields)
      .filter((f) => f.value !== null)
      .map((f) => f.confidence);
    const overallConfidence =
      confidences.length > 0
        ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length)
        : 0;
    const highCount = confidences.filter((c) => c >= 80).length;
    const lowCount = confidences.filter((c) => c < 50).length;

    setExtractionResult({
      extractionId,
      extractedFields: fields,
      overallConfidence,
      fieldCount,
      highConfidenceCount: highCount,
      lowConfidenceCount: lowCount,
      processingMs: 0,
      modelUsed: "history",
    });
    setEditedFields({});
    const autoSelected = new Set(
      Object.entries(fields)
        .filter(([, f]) => f.value !== null && f.confidence >= 50)
        .map(([k]) => k)
    );
    setSelectedFields(autoSelected);
    setOpen(true);
    toast.info("Loaded extraction from history — review and apply.");
  };

  const resetState = () => {
    setContent("");
    setDocumentName("");
    setExtractionResult(null);
    setEditedFields({});
    setSelectedFields(new Set());
  };

  const toggleField = (key: string) => {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAll = () => {
    if (!extractionResult) return;
    setSelectedFields(
      new Set(
        Object.entries(mergedFields)
          .filter(([, f]) => f.value !== null)
          .map(([k]) => k)
      )
    );
  };

  const selectNone = () => setSelectedFields(new Set());

  const editedCount = Object.keys(editedFields).length;

  const panelContent = (
    <div className="space-y-4">
      {/* Input area */}
      {!extractionResult && (
        <>
          <div className="flex items-center gap-2">
            <Select
              value={inputType}
              onValueChange={(v) => setInputType(v as typeof inputType)}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">
                  <span className="flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5" /> Plain Text
                  </span>
                </SelectItem>
                <SelectItem value="pdf_base64">
                  <span className="flex items-center gap-2">
                    <Upload className="h-3.5 w-3.5" /> PDF Upload
                  </span>
                </SelectItem>
                <SelectItem value="fhir_json">
                  <span className="flex items-center gap-2">
                    <Code2 className="h-3.5 w-3.5" /> FHIR JSON
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
            {documentName && (
              <Badge variant="outline" className="text-xs truncate max-w-48">
                {documentName}
              </Badge>
            )}
          </div>

          {/* Drag-drop zone */}
          <div
            className={`border-2 border-dashed rounded-lg transition-colors ${
              isDragging
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/30 hover:border-primary/50"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            {inputType === "text" || inputType === "fhir_json" ? (
              <Textarea
                placeholder={
                  inputType === "fhir_json"
                    ? "Paste FHIR JSON bundle here..."
                    : "Paste document text, EOB, claim summary, medical record, or any unstructured text here...\n\nOr drag and drop a file above."
                }
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="min-h-[140px] border-0 resize-none focus-visible:ring-0 bg-transparent"
              />
            ) : (
              <div
                className="flex flex-col items-center justify-center py-8 cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  {content
                    ? `✓ ${documentName || "File loaded"}`
                    : "Click or drag a PDF file here"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  The LLM will extract text and identify fields
                </p>
              </div>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,.json,.csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileUpload(file);
            }}
          />

          <Button
            onClick={handleExtract}
            disabled={extractMutation.isPending || !content.trim()}
            className="w-full gap-2"
          >
            {extractMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Extracting with AI...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" /> Extract Fields
              </>
            )}
          </Button>

          {extractMutation.isPending && (
            <div className="space-y-1">
              <Progress value={undefined} className="h-1.5 animate-pulse" />
              <p className="text-xs text-center text-muted-foreground">
                Sending to LLM for structured extraction…
              </p>
            </div>
          )}
        </>
      )}

      {/* Extraction results */}
      {extractionResult && (
        <>
          {/* Summary bar */}
          <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="text-center">
                <p className="text-lg font-bold">{extractionResult.overallConfidence}%</p>
                <p className="text-xs text-muted-foreground">Avg Confidence</p>
              </div>
              <Separator orientation="vertical" className="h-8" />
              <div className="flex gap-3 text-xs">
                <span className="text-green-700">
                  <CheckCircle2 className="h-3 w-3 inline mr-0.5" />
                  {extractionResult.highConfidenceCount} high
                </span>
                <span className="text-amber-700">
                  <AlertTriangle className="h-3 w-3 inline mr-0.5" />
                  {extractionResult.fieldCount -
                    extractionResult.highConfidenceCount -
                    extractionResult.lowConfidenceCount}{" "}
                  medium
                </span>
                <span className="text-red-700">
                  <XCircle className="h-3 w-3 inline mr-0.5" />
                  {extractionResult.lowConfidenceCount} low
                </span>
                {editedCount > 0 && (
                  <span className="text-blue-700">
                    <Pencil className="h-3 w-3 inline mr-0.5" />
                    {editedCount} edited
                  </span>
                )}
              </div>
            </div>
            <div className="text-right">
              {extractionResult.processingMs > 0 && (
                <p className="text-xs text-muted-foreground">{extractionResult.processingMs}ms</p>
              )}
              <p className="text-xs text-muted-foreground truncate max-w-32">
                {extractionResult.modelUsed === "history" ? "from history" : extractionResult.modelUsed}
              </p>
            </div>
          </div>

          {/* Field selection controls */}
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              {selectedFields.size} of {extractionResult.fieldCount} fields selected
              {editedCount > 0 && (
                <span className="ml-2 text-xs text-blue-600">
                  ({editedCount} manually edited)
                </span>
              )}
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={selectAll} className="h-7 text-xs">
                Select All
              </Button>
              <Button variant="ghost" size="sm" onClick={selectNone} className="h-7 text-xs">
                None
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSource(!showSource)}
                className="h-7 text-xs gap-1"
              >
                {showSource ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
                Sources
              </Button>
            </div>
          </div>

          {/* Field rows — now with inline editing */}
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {Object.entries(mergedFields).map(([key, field]) => (
              <FieldRow
                key={key}
                fieldKey={key}
                field={field}
                label={labels[key] ?? key}
                selected={selectedFields.has(key)}
                onToggle={() => toggleField(key)}
                onEdit={handleEdit}
              />
            ))}
          </div>

          {/* Inline edit hint */}
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Pencil className="h-3 w-3" />
            Click the pencil icon on any field to manually correct the extracted value before applying.
          </p>

          {/* Action buttons */}
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setExtractionResult(null);
                setEditedFields({});
                setContent("");
                setDocumentName("");
              }}
              className="flex-1"
            >
              Try Another Document
            </Button>
            <Button
              size="sm"
              onClick={handleApply}
              disabled={selectedFields.size === 0}
              className="flex-1 gap-2"
            >
              <Wand2 className="h-4 w-4" />
              Apply {selectedFields.size} Field{selectedFields.size !== 1 ? "s" : ""}
            </Button>
          </div>
        </>
      )}
    </div>
  );

  // ── Inline mode ──────────────────────────────────────────────────────────────
  if (inline) {
    return (
      <>
        <div className="border rounded-lg p-4 bg-gradient-to-br from-violet-50/50 to-blue-50/50 dark:from-violet-950/20 dark:to-blue-950/20">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-600" />
              <h3 className="text-sm font-semibold text-violet-900 dark:text-violet-200">
                SmartForm — AI Auto-Fill
              </h3>
              <Badge variant="outline" className="text-xs border-violet-200 text-violet-700">
                Powered by Ollama
              </Badge>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1 text-muted-foreground"
              onClick={() => setHistoryOpen(true)}
            >
              <History className="h-3.5 w-3.5" />
              View History
            </Button>
          </div>
          {panelContent}
        </div>

        <HistoryModal
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          targetForm={targetForm}
          labels={labels}
          onReuse={handleReuseFromHistory}
        />
      </>
    );
  }

  // ── Modal trigger mode ───────────────────────────────────────────────────────
  return (
    <>
      {/* Trigger buttons row */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          className="gap-2 border-violet-200 text-violet-700 hover:bg-violet-50 hover:text-violet-800"
        >
          <Sparkles className="h-4 w-4" />
          {triggerLabel}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setHistoryOpen(true)}
          className="gap-1.5 text-muted-foreground hover:text-foreground h-8 text-xs"
        >
          <History className="h-3.5 w-3.5" />
          View History
        </Button>
      </div>

      {/* Main extraction dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-violet-600" />
              SmartForm — AI Auto-Fill
            </DialogTitle>
            <DialogDescription>
              Upload or paste any document — EOB, claim summary, medical record, FHIR bundle —
              and the AI will extract and map the relevant fields automatically. You can manually
              correct any field before applying.
            </DialogDescription>
          </DialogHeader>

          {panelContent}

          <DialogFooter className="mt-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* History dialog */}
      <HistoryModal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        targetForm={targetForm}
        labels={labels}
        onReuse={handleReuseFromHistory}
      />
    </>
  );
}

export default SmartFormPanel;
