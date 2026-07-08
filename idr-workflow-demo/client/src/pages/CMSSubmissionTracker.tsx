/**
 * CMS Submission Tracker
 * ──────────────────────
 * Status board showing all CMS IDR portal submission drafts.
 * Users can generate new drafts, view eligibility status, and
 * track the state of each submission.
 */

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  ClipboardList, CheckCircle2, AlertTriangle, Loader2,
  Sparkles, ExternalLink, ChevronRight, Copy, RefreshCw,
  Scale, Calendar, DollarSign, Building2, Info
} from "lucide-react";

interface CMSDraft {
  disputeId: string;
  disputeRef: string;
  serviceType: string;
  billedAmount: string;
  generatedAt: Date;
  status?: "draft" | "submitted" | "determined" | "withdrawn";
  dbId?: string;
  eligibility: {
    isEligible: boolean;
    eligibilityReason: string;
    missingRequirements: string[];
    warnings: string[];
    estimatedDeadline: string | null;
    regulatoryBasis?: string[];
  };
  draft: {
    formFields: Record<string, string>;
    attachmentChecklist: Array<{ item: string; status: string }>;
    submissionNarrative: string;
    regulatoryBasis: string[];
    estimatedOutcome: string;
    nextSteps: string[];
  };
  processingTimeSeconds?: number;
}

export default function CMSSubmissionTracker() {
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const [drafts, setDrafts] = useState<CMSDraft[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [additionalContext, setAdditionalContext] = useState("");
  const [showContextFor, setShowContextFor] = useState<string | null>(null);

  const { data: disputesData, isLoading: disputesLoading } = trpc.disputes.list.useQuery({ limit: 100, offset: 0 });

  // Load persisted drafts from the database on mount
  const { data: persistedDrafts, isLoading: draftsLoading } = trpc.ai.listCMSDrafts.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  // Update draft status mutation
  const updateStatusMutation = trpc.ai.updateDraftStatus.useMutation({
    onSuccess: () => {
      utils.ai.listCMSDrafts.invalidate();
      toast.success("Draft status updated");
    },
    onError: (err) => toast.error(`Status update failed: ${err.message}`),
  });

  // Merge persisted drafts with local state on load
  useEffect(() => {
    if (!persistedDrafts || !disputesData?.items) return;
    const merged: CMSDraft[] = persistedDrafts.map((pd: any) => {
      const dispute = (disputesData.items as any[]).find((d: any) => d.id === pd.disputeId);
      return {
        disputeId: pd.disputeId,
        disputeRef: dispute?.referenceNumber ?? pd.disputeId,
        serviceType: dispute?.serviceType ?? "Unknown",
        billedAmount: dispute?.billedAmount ?? "N/A",
        generatedAt: pd.updatedAt ? new Date(pd.updatedAt) : new Date(pd.createdAt),
        status: pd.status,
        dbId: pd.id,
        eligibility: {
          isEligible: pd.isEligible,
          eligibilityReason: pd.eligibilityReason,
          missingRequirements: pd.missingRequirements ?? [],
          warnings: pd.warnings ?? [],
          estimatedDeadline: pd.estimatedDeadline ?? null,
          regulatoryBasis: pd.regulatoryBasis ?? [],
        },
        draft: {
          formFields: pd.formFields ?? {},
          attachmentChecklist: pd.attachmentChecklist ?? [],
          submissionNarrative: pd.submissionNarrative ?? "",
          regulatoryBasis: pd.draftRegulatoryBasis ?? [],
          estimatedOutcome: pd.estimatedOutcome ?? "",
          nextSteps: pd.nextSteps ?? [],
        },
        processingTimeSeconds: pd.processingTimeSeconds ? parseFloat(pd.processingTimeSeconds) : undefined,
      } as CMSDraft;
    });
    setDrafts(merged);
    if (merged.length > 0 && !selectedDraftId) {
      setSelectedDraftId(merged[0].disputeId);
    }
  }, [persistedDrafts, disputesData]);

  const cmsMutation = trpc.ai.generateCMSSubmission.useMutation({
    onSuccess: (data: any, variables) => {
      const dispute = (disputesData?.items || []).find((d: any) => d.id === variables.disputeId) as any;
      const newDraft: CMSDraft = {
        disputeId: variables.disputeId,
        disputeRef: dispute?.referenceNumber ?? variables.disputeId,
        serviceType: dispute?.serviceType ?? "Unknown",
        billedAmount: dispute?.billedAmount ?? "N/A",
        generatedAt: new Date(),
        status: "draft",
        eligibility: data.eligibility,
        draft: data.draft,
        processingTimeSeconds: data.processingTimeSeconds,
      };
      setDrafts((prev) => {
        const filtered = prev.filter((d) => d.disputeId !== variables.disputeId);
        return [newDraft, ...filtered];
      });
      setSelectedDraftId(variables.disputeId);
      setGeneratingId(null);
      setShowContextFor(null);
      utils.ai.listCMSDrafts.invalidate(); // refresh persisted list
      toast.success(`CMS draft generated and saved for ${newDraft.disputeRef}`);
    },
    onError: (err) => {
      setGeneratingId(null);
      toast.error(`Generation failed: ${err.message}`);
    },
  });

  const generateDraft = (disputeId: string) => {
    setGeneratingId(disputeId);
    cmsMutation.mutate({ disputeId, additionalContext: additionalContext || undefined });
    setAdditionalContext("");
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  const selectedDraft = drafts.find((d) => d.disputeId === selectedDraftId);

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full text-center p-8">
          <ClipboardList className="mx-auto mb-3 text-muted-foreground" size={40} />
          <h2 className="text-lg font-semibold">CMS Submission Tracker</h2>
          <p className="text-sm text-muted-foreground mt-1">Sign in to access submission drafts</p>
        </Card>
      </div>
    );
  }

  const disputes = (disputesData?.items || []) as any[];

  return (
    <div className="p-4 max-w-7xl mx-auto flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10">
            <ClipboardList className="text-primary" size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">CMS Submission Tracker</h1>
            <p className="text-sm text-muted-foreground">
              AI-generated CMS IDR portal submission drafts · CMSSubmissionAgent (LangGraph)
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.open("https://nsa-idr.cms.gov", "_blank")}
        >
          <ExternalLink size={14} className="mr-2" />CMS IDR Portal
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Dispute list */}
        <div className="lg:col-span-1 flex flex-col gap-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Active Disputes</CardTitle>
              <CardDescription className="text-xs">
                Select a dispute to generate or view its CMS submission draft
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea style={{ maxHeight: "520px" }}>
                {disputesLoading ? (
                  <div className="flex items-center justify-center p-8">
                    <Loader2 size={20} className="animate-spin text-muted-foreground" />
                  </div>
                ) : disputes.length === 0 ? (
                  <div className="text-center p-6 text-muted-foreground text-sm">
                    No disputes found
                  </div>
                ) : (
                  <div className="divide-y">
                    {disputes.map((d: any) => {
                      const hasDraft = drafts.some((dr) => dr.disputeId === d.id);
                      const isSelected = selectedDraftId === d.id;
                      const isGenerating = generatingId === d.id;
                      const draft = drafts.find((dr) => dr.disputeId === d.id);

                      return (
                        <div
                          key={d.id}
                          className={`p-3 cursor-pointer hover:bg-accent/30 transition-colors ${isSelected ? "bg-accent" : ""}`}
                          onClick={() => setSelectedDraftId(d.id)}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold truncate">{d.referenceNumber}</p>
                              <p className="text-xs text-muted-foreground truncate">
                                {d.serviceType?.replace(/_/g, " ")}
                              </p>
                              <div className="flex items-center gap-1 mt-1 flex-wrap">
                                <Badge variant="outline" className="text-xs py-0">
                                  ${d.billedAmount ?? "N/A"}
                                </Badge>
                                {hasDraft && (
                                  <Badge
                                    variant="outline"
                                    className={`text-xs py-0 ${
                                      draft?.eligibility.isEligible
                                        ? "text-green-600 border-green-300"
                                        : "text-red-600 border-red-300"
                                    }`}
                                  >
                                    {draft?.eligibility.isEligible ? "Eligible" : "Issues"}
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-1 shrink-0">
                              {isGenerating ? (
                                <Loader2 size={14} className="animate-spin text-primary" />
                              ) : hasDraft ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 text-xs px-2"
                                  onClick={(e) => { e.stopPropagation(); setShowContextFor(d.id); }}
                                >
                                  <RefreshCw size={10} className="mr-1" />Regen
                                </Button>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-6 text-xs px-2"
                                  onClick={(e) => { e.stopPropagation(); setShowContextFor(d.id); }}
                                >
                                  <Sparkles size={10} className="mr-1" />Generate
                                </Button>
                              )}
                            </div>
                          </div>

                          {/* Context input */}
                          {showContextFor === d.id && (
                            <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                              <Textarea
                                placeholder="Additional context (optional)..."
                                value={additionalContext}
                                onChange={(e) => setAdditionalContext(e.target.value)}
                                className="text-xs min-h-[60px]"
                              />
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  className="flex-1 h-7 text-xs"
                                  onClick={() => generateDraft(d.id)}
                                  disabled={isGenerating}
                                >
                                  {isGenerating ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                                  <span className="ml-1">Run Agent</span>
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => setShowContextFor(null)}
                                >Cancel</Button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Right: Draft detail */}
        <div className="lg:col-span-2">
          {selectedDraft ? (
            <ScrollArea style={{ maxHeight: "600px" }}>
              <div className="flex flex-col gap-3 pr-1">
                {/* Header */}
                <Card className={selectedDraft.eligibility.isEligible ? "border-green-300" : "border-red-300"}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <CardTitle className="text-base flex items-center gap-2">
                          {selectedDraft.eligibility.isEligible
                            ? <CheckCircle2 size={16} className="text-green-600" />
                            : <AlertTriangle size={16} className="text-red-600" />
                          }
                          {selectedDraft.disputeRef}
                        </CardTitle>
                        <CardDescription className="text-xs mt-1">
                          {selectedDraft.serviceType?.replace(/_/g, " ")} · ${selectedDraft.billedAmount}
                          {selectedDraft.processingTimeSeconds && ` · Generated in ${selectedDraft.processingTimeSeconds}s`}
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-1 flex-wrap">
                        <Badge variant="outline" className={`text-xs ${selectedDraft.eligibility.isEligible ? "text-green-600 border-green-300 bg-green-50" : "text-red-600 border-red-300 bg-red-50"}`}>
                          {selectedDraft.eligibility.isEligible ? "IDR Eligible" : "Eligibility Issues"}
                        </Badge>
                        {selectedDraft.status && (
                          <Badge variant="outline" className={`text-xs ${
                            selectedDraft.status === "submitted" ? "text-blue-600 border-blue-300 bg-blue-50" :
                            selectedDraft.status === "determined" ? "text-teal-600 border-teal-300 bg-teal-50" :
                            selectedDraft.status === "withdrawn" ? "text-gray-500 border-gray-300" :
                            "text-amber-600 border-amber-300 bg-amber-50"
                          }`}>
                            {selectedDraft.status}
                          </Badge>
                        )}
                        {(selectedDraft.eligibility.regulatoryBasis || []).slice(0, 2).map((r) => (
                          <Badge key={r} variant="secondary" className="text-xs">{r}</Badge>
                        ))}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">{selectedDraft.eligibility.eligibilityReason}</p>
                    {selectedDraft.eligibility.missingRequirements.length > 0 && (
                      <div className="mt-2">
                        <p className="text-xs font-medium text-red-600">Missing Requirements:</p>
                        <ul className="text-xs text-red-600 mt-1 space-y-0.5">
                          {selectedDraft.eligibility.missingRequirements.map((r, i) => (
                            <li key={i}>• {r}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {selectedDraft.eligibility.warnings.length > 0 && (
                      <div className="mt-2">
                        <p className="text-xs font-medium text-yellow-600">Warnings:</p>
                        <ul className="text-xs text-yellow-600 mt-1 space-y-0.5">
                          {selectedDraft.eligibility.warnings.map((w, i) => (
                            <li key={i}>• {w}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {selectedDraft.eligibility.estimatedDeadline && (
                      <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                        <Calendar size={10} />
                        Estimated deadline: {selectedDraft.eligibility.estimatedDeadline}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Form fields */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Pre-filled CMS Portal Fields</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 gap-1">
                      {Object.entries(selectedDraft.draft.formFields).map(([k, v]) => v && (
                        <div key={k} className="flex justify-between items-center py-1 border-b last:border-0 gap-2">
                          <span className="text-xs text-muted-foreground capitalize shrink-0">
                            {k.replace(/([A-Z])/g, " $1").trim()}
                          </span>
                          <span className="text-xs font-medium text-right">{v}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Attachment checklist */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Attachment Checklist</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1.5">
                      {selectedDraft.draft.attachmentChecklist.map((item, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <Badge variant="outline" className={`text-xs shrink-0 ${
                            item.status === "ready" ? "text-green-600 border-green-300 bg-green-50" :
                            item.status === "missing" ? "text-red-600 border-red-300 bg-red-50" :
                            "text-gray-500 border-gray-300"
                          }`}>
                            {item.status}
                          </Badge>
                          <span className="text-xs">{item.item}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Narrative */}
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">Submission Narrative</CardTitle>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => copyToClipboard(selectedDraft.draft.submissionNarrative)}
                      >
                        <Copy size={10} className="mr-1" />Copy
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
                      {selectedDraft.draft.submissionNarrative}
                    </p>
                  </CardContent>
                </Card>

                {/* Outcome + Next Steps */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Estimated Outcome & Next Steps</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="bg-muted/50 rounded p-3">
                      <p className="text-xs font-medium mb-1 flex items-center gap-1">
                        <Info size={10} />Estimated Outcome
                      </p>
                      <p className="text-xs text-muted-foreground">{selectedDraft.draft.estimatedOutcome}</p>
                    </div>
                    <ol className="space-y-1.5">
                      {selectedDraft.draft.nextSteps.map((step, i) => (
                        <li key={i} className="flex gap-2 text-xs">
                          <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                            {i + 1}
                          </span>
                          {step}
                        </li>
                      ))}
                    </ol>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => window.open("https://nsa-idr.cms.gov", "_blank")}
                      >
                        <ExternalLink size={12} className="mr-2" />CMS IDR Portal
                      </Button>
                      {selectedDraft.dbId && selectedDraft.status === "draft" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 border-blue-300 text-blue-700 hover:bg-blue-50"
                          disabled={updateStatusMutation.isPending}
                          onClick={() => updateStatusMutation.mutate({ draftId: selectedDraft.dbId!, status: "submitted" })}
                        >
                          Mark Submitted
                        </Button>
                      )}
                      {selectedDraft.dbId && selectedDraft.status === "submitted" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 border-teal-300 text-teal-700 hover:bg-teal-50"
                          disabled={updateStatusMutation.isPending}
                          onClick={() => updateStatusMutation.mutate({ draftId: selectedDraft.dbId!, status: "determined" })}
                        >
                          Mark Determined
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </ScrollArea>
          ) : (
            <Card className="h-full min-h-[400px] flex items-center justify-center border-dashed">
              <div className="text-center text-muted-foreground p-8">
                <ClipboardList size={40} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">No draft selected</p>
                <p className="text-xs mt-1">
                  Select a dispute from the left and click Generate to run the CMSSubmissionAgent
                </p>
                <div className="flex items-center justify-center gap-1 mt-3 text-xs">
                  <Badge variant="outline" className="text-xs">check_eligibility</Badge>
                  <ChevronRight size={10} />
                  <Badge variant="outline" className="text-xs">generate_form_fields</Badge>
                  <ChevronRight size={10} />
                  <Badge variant="outline" className="text-xs">generate_narrative</Badge>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
