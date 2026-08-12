import React, { useMemo, useState, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  CheckCircle2, Circle, Clock, AlertTriangle, Scale,
  ChevronRight, CalendarDays, Hourglass, Flag, Zap,
  StickyNote, Plus, Trash2, Loader2, X, MessageSquarePlus, Pencil, Check,
  Paperclip, FileText, Image as ImageIcon, Download
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

interface TimelineStep {
  step: string;
  isCompleted: boolean;
  isCurrent: boolean;
  event?: {
    description?: string | null;
    createdAt?: string | Date | null | undefined;
    metadata?: Record<string, unknown> | null | undefined;
  } | null;
}

interface IDRStepDef {
  key: string;
  label: string;
  description: string;
  days: string;
  phase: "negotiation" | "idr_filing" | "entity_selection" | "arbitration" | "payment" | "appeal";
  statutoryDays?: number;
}

interface WorkflowTimelineProps {
  steps: TimelineStep[];
  currentStep: string;
  disputeId?: string;           // required for note functionality
  disputeCreatedAt?: string | Date | null;
  compact?: boolean;
}

// ── Step definitions with phases ──────────────────────────────────────────

const IDR_STEP_DEFS: IDRStepDef[] = [
  { key: "STEP_01_OPEN_NEGOTIATION_INITIATED", label: "Open Negotiation Initiated", description: "30-business-day open negotiation period begins per 45 CFR §149.510(b)", days: "Day 0", phase: "negotiation", statutoryDays: 0 },
  { key: "STEP_02_OPEN_NEGOTIATION_PERIOD", label: "Open Negotiation Period", description: "Parties negotiate in good faith; counter-offers exchanged", days: "+30 bd", phase: "negotiation", statutoryDays: 30 },
  { key: "STEP_03_OPEN_NEGOTIATION_FAILED", label: "Open Negotiation Failed", description: "No agreement reached; either party may initiate federal IDR", days: "Day 30", phase: "negotiation" },
  { key: "STEP_04_IDR_INITIATED", label: "Federal IDR Initiated", description: "Initiating party submits IDR request to CMS portal within 4 bd of negotiation failure", days: "+4 bd", phase: "idr_filing", statutoryDays: 4 },
  { key: "STEP_05_IDR_NOTICE_SENT", label: "IDR Notice Sent", description: "CMS sends notice to both parties and eligible IDR entities", days: "+1 bd", phase: "idr_filing", statutoryDays: 1 },
  { key: "STEP_06_IDR_ENTITY_SELECTION", label: "IDR Entity Selection", description: "Parties jointly select a certified IDR entity within 3 bd", days: "+3 bd", phase: "entity_selection", statutoryDays: 3 },
  { key: "STEP_07_IDR_ENTITY_SELECTED", label: "IDR Entity Selected", description: "Certified IDR entity confirmed and assigned to dispute", days: "Day 0 of IDR", phase: "entity_selection" },
  { key: "STEP_08_ELIGIBILITY_REVIEW", label: "Eligibility Review", description: "IDR entity reviews dispute eligibility per 45 CFR §149.510", days: "+3 bd", phase: "arbitration", statutoryDays: 3 },
  { key: "STEP_09_OFFER_SUBMISSION", label: "Offer Submission", description: "Both parties submit payment offers to IDR entity", days: "+10 bd", phase: "arbitration", statutoryDays: 10 },
  { key: "STEP_10_QPA_DISCLOSURE", label: "QPA Disclosure", description: "Qualifying Payment Amount (QPA) disclosed to IDR entity", days: "Concurrent", phase: "arbitration" },
  { key: "STEP_11_ADDITIONAL_INFORMATION", label: "Additional Information", description: "Parties may submit additional supporting information", days: "+5 bd", phase: "arbitration", statutoryDays: 5 },
  { key: "STEP_12_ARBITRATION_REVIEW", label: "Arbitration Review", description: "IDR entity reviews all offers and supporting information", days: "Active review", phase: "arbitration" },
  { key: "STEP_13_DETERMINATION_ISSUED", label: "Determination Issued", description: "IDR entity selects one party's offer as the payment amount", days: "+30 bd", phase: "arbitration", statutoryDays: 30 },
  { key: "STEP_14_PAYMENT_DETERMINATION", label: "Payment Determination", description: "Losing party notified; payment obligation established", days: "Day 0 of payment", phase: "payment" },
  { key: "STEP_15_PAYMENT_MADE", label: "Payment Made", description: "Determined payment amount transmitted to winning party", days: "+30 days", phase: "payment", statutoryDays: 30 },
  { key: "STEP_16_ADMINISTRATIVE_FEE_PAID", label: "Administrative Fee Paid", description: "Losing party pays IDR administrative fee to CMS", days: "Concurrent", phase: "payment" },
  { key: "STEP_17_DISPUTE_CLOSED", label: "Dispute Closed", description: "Dispute formally closed in the federal IDR portal", days: "Final", phase: "payment" },
  { key: "STEP_18_APPEAL_FILED", label: "Appeal Filed (Optional)", description: "Party files appeal in federal district court", days: "Optional", phase: "appeal" },
  { key: "STEP_19_APPEAL_RESOLVED", label: "Appeal Resolved (Optional)", description: "Federal court issues final ruling on appeal", days: "Optional", phase: "appeal" },
];

const PHASE_META: Record<IDRStepDef["phase"], { label: string; color: string; bg: string; border: string }> = {
  negotiation:      { label: "Open Negotiation",   color: "text-amber-700",  bg: "bg-amber-50",   border: "border-amber-200" },
  idr_filing:       { label: "IDR Filing",          color: "text-blue-700",   bg: "bg-blue-50",    border: "border-blue-200" },
  entity_selection: { label: "Entity Selection",    color: "text-violet-700", bg: "bg-violet-50",  border: "border-violet-200" },
  arbitration:      { label: "Arbitration",         color: "text-indigo-700", bg: "bg-indigo-50",  border: "border-indigo-200" },
  payment:          { label: "Payment",             color: "text-green-700",  bg: "bg-green-50",   border: "border-green-200" },
  appeal:           { label: "Appeal",              color: "text-rose-700",   bg: "bg-rose-50",    border: "border-rose-200" },
};

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(d: string | Date | null | undefined): string {
  if (!d) return "";
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function businessDaysSince(from: Date): number {
  const now = new Date();
  let count = 0;
  const cursor = new Date(from);
  while (cursor < now) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

function deadlineStatus(stepStartDate: Date, statutoryDays: number): { daysLeft: number; status: "ok" | "warning" | "overdue" } {
  const bd = businessDaysSince(stepStartDate);
  const daysLeft = statutoryDays - bd;
  return {
    daysLeft,
    status: daysLeft < 0 ? "overdue" : daysLeft <= 3 ? "warning" : "ok",
  };
}

// ── Step Notes sub-component ───────────────────────────────────────────────

interface NoteAttachment {
  key: string;
  url: string;
  name: string;
  size: number;
  mimeType: string;
}

interface StepNotesProps {
  disputeId: string;
  stepId: string;
  isCurrent: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

function StepNotesPanel({ disputeId, stepId, isCurrent }: StepNotesProps) {
  const [noteText, setNoteText] = useState("");
  const [showForm, setShowForm] = useState(false);
  // Per-note edit state: noteId -> draft text (undefined = not editing)
  const [editingNotes, setEditingNotes] = useState<Record<string, string>>({});
  // Pending attachments for the new note form
  const [pendingAttachments, setPendingAttachments] = useState<NoteAttachment[]>([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Image preview modal
  const [previewImage, setPreviewImage] = useState<{ url: string; name: string } | null>(null);
  const utils = trpc.useUtils();

  const notesQuery = trpc.workflow.getNotes.useQuery(
    { disputeId, stepId },
    { enabled: !!disputeId }
  );

  const addNoteMutation = trpc.workflow.addNote.useMutation({
    onSuccess: () => {
      toast.success("Note added to step");
      setNoteText("");
      setShowForm(false);
      setPendingAttachments([]);
      utils.workflow.getNotes.invalidate({ disputeId, stepId });
    },
    onError: (err) => toast.error(err.message),
  });

  const uploadAttachmentMutation = trpc.workflow.uploadNoteAttachment.useMutation({
    onSuccess: (att) => {
      setPendingAttachments(prev => [...prev, att]);
      toast.success(`Attached: ${att.name}`);
    },
    onError: (err) => toast.error(`Upload failed: ${err.message}`),
  });

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File must be under 10 MB");
      return;
    }
    setUploadingFile(true);
    try {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        uploadAttachmentMutation.mutate({
          disputeId,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          fileBase64: base64,
        });
        setUploadingFile(false);
      };
      reader.onerror = () => { toast.error("Failed to read file"); setUploadingFile(false); };
      reader.readAsDataURL(file);
    } catch {
      setUploadingFile(false);
    }
    // Reset input so same file can be re-selected
    e.target.value = "";
  }

  const deleteNoteMutation = trpc.workflow.deleteNote.useMutation({
    onSuccess: () => {
      toast.success("Note removed");
      utils.workflow.getNotes.invalidate({ disputeId, stepId });
    },
    onError: (err) => toast.error(err.message),
  });

  const updateNoteMutation = trpc.workflow.updateNote.useMutation({
    onSuccess: (updated) => {
      toast.success("Note updated");
      setEditingNotes(prev => { const n = { ...prev }; delete n[updated.id]; return n; });
      utils.workflow.getNotes.invalidate({ disputeId, stepId });
    },
    onError: (err) => toast.error(err.message),
  });

  function startEditing(noteId: string, currentText: string) {
    setEditingNotes(prev => ({ ...prev, [noteId]: currentText }));
  }

  function cancelEditing(noteId: string) {
    setEditingNotes(prev => { const n = { ...prev }; delete n[noteId]; return n; });
  }

  function saveEdit(noteId: string) {
    const draft = editingNotes[noteId]?.trim();
    if (!draft) return;
    updateNoteMutation.mutate({ noteId, disputeId, note: draft });
  }

  function removeAttachment(key: string) {
    setPendingAttachments(prev => prev.filter(a => a.key !== key));
  }

  const notes = notesQuery.data ?? [];

  return (
    <div className="mt-2 space-y-2">
      {/* Existing notes */}
      {notes.length > 0 && (
        <div className="space-y-1.5">
          {notes.map(note => {
            const isEditing = note.id in editingNotes;
            const draft = editingNotes[note.id] ?? "";
            return (
              <div
                key={note.id}
                className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded px-2.5 py-2 group"
              >
                {isEditing ? (
                  /* ── Edit mode ── */
                  <div className="space-y-1.5">
                    <Textarea
                      value={draft}
                      onChange={e => setEditingNotes(prev => ({ ...prev, [note.id]: e.target.value }))}
                      className="text-xs min-h-[64px] resize-none bg-white dark:bg-yellow-950"
                      autoFocus
                      maxLength={2000}
                      onKeyDown={e => {
                        if (e.key === "Escape") cancelEditing(note.id);
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveEdit(note.id);
                      }}
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground">{draft.length}/2000 · ⌘Enter to save</span>
                      <div className="flex gap-1">
                        <Button
                          size="sm" variant="ghost" className="h-6 text-xs px-2"
                          onClick={() => cancelEditing(note.id)}
                        >
                          <X className="h-3 w-3 mr-1" /> Cancel
                        </Button>
                        <Button
                          size="sm" className="h-6 text-xs px-2"
                          disabled={!draft.trim() || draft === note.note || updateNoteMutation.isPending}
                          onClick={() => saveEdit(note.id)}
                        >
                          {updateNoteMutation.isPending
                            ? <Loader2 className="h-3 w-3 animate-spin mr-1" />
                            : <Check className="h-3 w-3 mr-1" />}
                          Save
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* ── Read mode ── */
                  <div className="flex items-start gap-2">
                    <StickyNote className="h-3.5 w-3.5 text-yellow-600 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs leading-relaxed text-foreground/80 whitespace-pre-wrap">{note.note}</p>
                      {/* Attachments display */}
                      {(() => {
                        let atts: NoteAttachment[] = [];
                        try { atts = JSON.parse(note.attachments || "[]"); } catch { atts = []; }
                        return atts.length > 0 ? (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {atts.map((att) => (
                              isImage(att.mimeType) ? (
                                /* Image attachment — show thumbnail + click to preview */
                                <button
                                  key={att.key}
                                  className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border bg-white dark:bg-background hover:border-primary/50 hover:text-primary transition-colors max-w-[180px] group/att"
                                  title={`Preview ${att.name}`}
                                  onClick={() => setPreviewImage({ url: att.url, name: att.name })}
                                >
                                  <ImageIcon className="h-3 w-3 shrink-0 text-blue-500" />
                                  <span className="truncate">{att.name}</span>
                                  <span className="text-[9px] text-muted-foreground opacity-0 group-hover/att:opacity-100 shrink-0">preview</span>
                                </button>
                              ) : (
                                /* Non-image attachment — open in new tab */
                                <a
                                  key={att.key}
                                  href={att.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border bg-white dark:bg-background hover:border-primary/50 hover:text-primary transition-colors max-w-[180px] group/att"
                                  title={`${att.name} (${formatBytes(att.size)})`}
                                >
                                  <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                                  <span className="truncate">{att.name}</span>
                                  <Download className="h-2.5 w-2.5 shrink-0 opacity-0 group-hover/att:opacity-100" />
                                </a>
                              )
                            ))}
                          </div>
                        ) : null;
                      })()}
                      <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                        <span>{note.authorName ?? note.authorId}</span>
                        <span>·</span>
                        <span>{formatDateTime(note.createdAt)}</span>
                        {note.updatedAt && note.updatedAt !== note.createdAt && (
                          <span className="italic">(edited {formatDateTime(note.updatedAt)})</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button
                        className="text-muted-foreground hover:text-primary p-0.5 rounded"
                        onClick={() => startEditing(note.id, note.note)}
                        title="Edit note"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        className="text-muted-foreground hover:text-destructive p-0.5 rounded"
                        onClick={() => deleteNoteMutation.mutate({ noteId: note.id, disputeId })}
                        disabled={deleteNoteMutation.isPending}
                        title="Delete note"
                      >
                        {deleteNoteMutation.isPending
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <Trash2 className="h-3 w-3" />}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add note form */}
      {showForm ? (
        <div className="space-y-1.5">
          <Textarea
            placeholder="Add a note about this step — context, decisions, blockers, next actions..."
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            className="text-xs min-h-[72px] resize-none"
            autoFocus
            maxLength={2000}
          />
          {/* Pending attachments preview */}
          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {pendingAttachments.map(att => (
                <div
                  key={att.key}
                  className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border bg-muted/50 max-w-[180px] group/patt"
                >
                  {isImage(att.mimeType) ? (
                    <ImageIcon className="h-3 w-3 shrink-0 text-blue-500" />
                  ) : (
                    <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate flex-1">{att.name}</span>
                  <span className="text-muted-foreground shrink-0">{formatBytes(att.size)}</span>
                  <button
                    className="ml-0.5 opacity-0 group-hover/patt:opacity-100 hover:text-destructive"
                    onClick={() => removeAttachment(att.key)}
                    title="Remove attachment"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/*,.pdf,.doc,.docx,.txt,.csv,.xlsx,.xls"
            onChange={handleFileSelect}
          />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">{noteText.length}/2000</span>
              <button
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingFile || uploadAttachmentMutation.isPending}
                title="Attach a file or image"
              >
                {uploadingFile || uploadAttachmentMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Paperclip className="h-3 w-3" />
                )}
                Attach file
              </button>
            </div>
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => { setShowForm(false); setNoteText(""); setPendingAttachments([]); }}
              >
                <X className="h-3 w-3 mr-1" /> Cancel
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs"
                disabled={!noteText.trim() || addNoteMutation.isPending}
                onClick={() => addNoteMutation.mutate({ disputeId, stepId, note: noteText.trim(), attachments: pendingAttachments })}
              >
                {addNoteMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <Plus className="h-3 w-3 mr-1" />
                )}
                Save Note
              </Button>
            </div>
          </div>
        </div>
      ) : (
        isCurrent && (
          <button
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-primary transition-colors py-0.5"
            onClick={() => setShowForm(true)}
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            Add note to this step
            {notes.length > 0 && (
              <span className="bg-yellow-100 text-yellow-700 rounded-full px-1.5 py-0.5 text-[10px] font-medium">
                {notes.length}
              </span>
            )}
          </button>
        )
      )}

      {/* Note count for non-current steps */}
      {!isCurrent && notes.length > 0 && (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <StickyNote className="h-3 w-3" />
          {notes.length} note{notes.length !== 1 ? "s" : ""}
        </div>
      )}

      {/* Image Preview Modal */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setPreviewImage(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`Preview: ${previewImage.name}`}
        >
          <div
            className="relative max-w-[90vw] max-h-[90vh] bg-background rounded-lg shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/40">
              <div className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-blue-500" />
                <span className="text-sm font-medium truncate max-w-[320px]">{previewImage.name}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <a
                  href={previewImage.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary px-2 py-1 rounded border hover:border-primary/50 transition-colors"
                  title="Open original"
                  onClick={e => e.stopPropagation()}
                >
                  <Download className="h-3.5 w-3.5" />
                  Open original
                </a>
                <button
                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setPreviewImage(null)}
                  title="Close preview"
                  aria-label="Close image preview"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            {/* Image */}
            <div className="overflow-auto max-h-[80vh] flex items-center justify-center p-2 bg-muted/20">
              <img
                src={previewImage.url}
                alt={previewImage.name}
                className="max-w-full max-h-[75vh] object-contain rounded"
                onError={e => {
                  (e.target as HTMLImageElement).src = "";
                  (e.target as HTMLImageElement).alt = "Image failed to load";
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function WorkflowTimeline({ steps, currentStep, disputeId, disputeCreatedAt, compact = false }: WorkflowTimelineProps) {
  const currentStepIndex = IDR_STEP_DEFS.findIndex(s => s.key === currentStep);
  const completedCount = steps.filter(s => s.isCompleted).length;
  const progressPct = Math.round((completedCount / IDR_STEP_DEFS.length) * 100);

  const phaseGroups = useMemo(() => {
    const groups: { phase: IDRStepDef["phase"]; steps: IDRStepDef[] }[] = [];
    let lastPhase: IDRStepDef["phase"] | null = null;
    for (const def of IDR_STEP_DEFS) {
      if (def.phase !== lastPhase) {
        groups.push({ phase: def.phase, steps: [def] });
        lastPhase = def.phase;
      } else {
        groups[groups.length - 1].steps.push(def);
      }
    }
    return groups;
  }, []);

  const currentStepEvent = steps.find(s => s.isCurrent)?.event;
  const currentStepStartDate = currentStepEvent?.createdAt ? new Date(currentStepEvent.createdAt) : null;
  const currentStepDef = IDR_STEP_DEFS.find(s => s.key === currentStep);

  return (
    <div className="space-y-4">
      {/* ── Progress header ── */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span className="font-medium">IDR Progress</span>
            <span>{completedCount} of {IDR_STEP_DEFS.length} steps · {progressPct}%</span>
          </div>
          <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${progressPct}%`,
                background: progressPct === 100
                  ? "hsl(var(--chart-2))"
                  : `linear-gradient(90deg, hsl(var(--chart-1)), hsl(var(--chart-3)))`,
              }}
            />
          </div>
        </div>

        {currentStepStartDate && currentStepDef?.statutoryDays != null && (
          (() => {
            const { daysLeft, status } = deadlineStatus(currentStepStartDate, currentStepDef.statutoryDays);
            return (
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                status === "overdue" ? "bg-red-50 border-red-200 text-red-700" :
                status === "warning" ? "bg-amber-50 border-amber-200 text-amber-700" :
                "bg-green-50 border-green-200 text-green-700"
              }`}>
                {status === "overdue" ? <AlertTriangle className="h-3 w-3" /> :
                 status === "warning" ? <Hourglass className="h-3 w-3" /> :
                 <Clock className="h-3 w-3" />}
                {status === "overdue"
                  ? `${Math.abs(daysLeft)} bd overdue`
                  : `${daysLeft} bd remaining`}
              </div>
            );
          })()
        )}
      </div>

      {/* ── Phase-grouped timeline ── */}
      <div className="space-y-3">
        {phaseGroups.map(({ phase, steps: phaseSteps }) => {
          const phaseMeta = PHASE_META[phase];
          const phaseStepKeys = phaseSteps.map(s => s.key);
          const phaseCompleted = phaseStepKeys.every(k => steps.find(s => s.step === k)?.isCompleted);
          const phaseActive = phaseStepKeys.some(k => steps.find(s => s.step === k)?.isCurrent);

          return (
            <div key={phase} className={`rounded-lg border overflow-hidden ${
              phaseActive ? `${phaseMeta.border} ${phaseMeta.bg}` :
              phaseCompleted ? "border-green-200 bg-green-50/50" :
              "border-border bg-background"
            }`}>
              {/* Phase header */}
              <div className={`flex items-center justify-between px-3 py-2 border-b ${
                phaseActive ? phaseMeta.border : phaseCompleted ? "border-green-200" : "border-border"
              }`}>
                <div className="flex items-center gap-2">
                  {phaseCompleted
                    ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                    : phaseActive
                    ? <Zap className="h-3.5 w-3.5 text-primary" />
                    : <Circle className="h-3.5 w-3.5 text-muted-foreground" />}
                  <span className={`text-xs font-semibold ${
                    phaseActive ? phaseMeta.color :
                    phaseCompleted ? "text-green-700" :
                    "text-muted-foreground"
                  }`}>
                    {phaseMeta.label}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground">
                    {phaseStepKeys.filter(k => steps.find(s => s.step === k)?.isCompleted).length}/{phaseSteps.length}
                  </span>
                  {phaseCompleted && <Badge variant="secondary" className="text-[10px] h-4 px-1">Done</Badge>}
                  {phaseActive && <Badge className="text-[10px] h-4 px-1">Active</Badge>}
                </div>
              </div>

              {/* Steps in phase */}
              <div className="relative">
                <div className="absolute left-[22px] top-4 bottom-4 w-px bg-border" />
                <div className="space-y-0">
                  {phaseSteps.map((def, idx) => {
                    const tStep = steps.find(s => s.step === def.key);
                    const isCompleted = tStep?.isCompleted ?? false;
                    const isCurrent = tStep?.isCurrent ?? false;
                    const stepNumber = IDR_STEP_DEFS.findIndex(s => s.key === def.key) + 1;
                    const eventDate = tStep?.event?.createdAt;
                    const isLast = idx === phaseSteps.length - 1;

                    return (
                      <div
                        key={def.key}
                        className={`relative flex items-start gap-3 px-3 py-2.5 ${
                          isCurrent ? "bg-white/60 dark:bg-black/20" : ""
                        } ${!isLast ? "border-b border-dashed border-border/40" : ""}`}
                      >
                        {/* Step circle */}
                        <div className={`relative z-10 flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold border-2 ${
                          isCompleted
                            ? "bg-green-500 border-green-500 text-white"
                            : isCurrent
                            ? "bg-primary border-primary text-primary-foreground animate-pulse"
                            : "bg-background border-muted-foreground/30 text-muted-foreground"
                        }`}>
                          {isCompleted ? <CheckCircle2 className="h-3.5 w-3.5" /> : stepNumber}
                        </div>

                        {/* Step content */}
                        <div className="flex-1 min-w-0 pt-0.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <span className={`text-sm font-medium leading-tight ${
                                isCurrent ? phaseMeta.color :
                                isCompleted ? "text-green-700" :
                                "text-muted-foreground"
                              }`}>
                                {def.label}
                              </span>
                              {isCurrent && (
                                <Badge className="ml-2 text-[9px] h-4 px-1.5 align-middle">Current</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <span className="text-[10px] text-muted-foreground whitespace-nowrap">{def.days}</span>
                              {isCurrent && def.statutoryDays != null && currentStepStartDate && (
                                (() => {
                                  const { daysLeft, status } = deadlineStatus(currentStepStartDate, def.statutoryDays);
                                  return (
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                      status === "overdue" ? "bg-red-100 text-red-700" :
                                      status === "warning" ? "bg-amber-100 text-amber-700" :
                                      "bg-green-100 text-green-700"
                                    }`}>
                                      {status === "overdue" ? `${Math.abs(daysLeft)}bd late` : `${daysLeft}bd left`}
                                    </span>
                                  );
                                })()
                              )}
                            </div>
                          </div>

                          {!compact && (
                            <p className={`text-xs mt-0.5 leading-relaxed ${
                              isCurrent ? "text-foreground/70" :
                              isCompleted ? "text-green-600/80" :
                              "text-muted-foreground/60"
                            }`}>
                              {def.description}
                            </p>
                          )}

                          {/* Event timestamp */}
                          {eventDate && (
                            <div className="flex items-center gap-1 mt-1.5 text-[10px] text-muted-foreground">
                              <CalendarDays className="h-3 w-3" />
                              {isCompleted ? "Completed" : "Started"}: {formatDateTime(eventDate)}
                            </div>
                          )}

                          {/* Event description */}
                          {tStep?.event?.description && !compact && (
                            <div className="mt-1.5 text-xs text-muted-foreground bg-white/80 dark:bg-black/20 border border-border/50 rounded px-2 py-1 leading-relaxed">
                              {tStep.event.description}
                            </div>
                          )}

                          {/* Step Notes — shown on current step always, on others when disputeId provided */}
                          {disputeId && (isCurrent || isCompleted) && !compact && (
                            <StepNotesPanel
                              disputeId={disputeId}
                              stepId={def.key}
                              isCurrent={isCurrent}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Summary footer ── */}
      <div className="grid grid-cols-3 gap-2 pt-1">
        <div className="text-center p-2 rounded-lg bg-green-50 border border-green-200">
          <div className="text-lg font-bold text-green-700">{completedCount}</div>
          <div className="text-[10px] text-green-600">Completed</div>
        </div>
        <div className="text-center p-2 rounded-lg bg-primary/5 border border-primary/20">
          <div className="text-lg font-bold text-primary">{currentStepIndex + 1}</div>
          <div className="text-[10px] text-primary/70">Current Step</div>
        </div>
        <div className="text-center p-2 rounded-lg bg-muted border border-border">
          <div className="text-lg font-bold text-muted-foreground">{IDR_STEP_DEFS.length - completedCount - 1}</div>
          <div className="text-[10px] text-muted-foreground">Remaining</div>
        </div>
      </div>

      {/* Dispute start date */}
      {disputeCreatedAt && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1">
          <Flag className="h-3 w-3" />
          Dispute opened: {formatDate(disputeCreatedAt)}
          {currentStepIndex >= 0 && (
            <span className="ml-1">
              · {businessDaysSince(new Date(disputeCreatedAt))} business days elapsed
            </span>
          )}
        </div>
      )}
    </div>
  );
}
