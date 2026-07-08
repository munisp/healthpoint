import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CheckCircle2, Circle, Clock, AlertTriangle, Scale,
  ChevronRight, CalendarDays, Hourglass, Flag, Zap
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
  statutoryDays?: number; // business days from step start
}

interface WorkflowTimelineProps {
  steps: TimelineStep[];
  currentStep: string;
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

// ── Component ──────────────────────────────────────────────────────────────

export default function WorkflowTimeline({ steps, currentStep, disputeCreatedAt, compact = false }: WorkflowTimelineProps) {
  const currentStepIndex = IDR_STEP_DEFS.findIndex(s => s.key === currentStep);
  const completedCount = steps.filter(s => s.isCompleted).length;
  const progressPct = Math.round((completedCount / IDR_STEP_DEFS.length) * 100);

  // Group steps by phase
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

  // Find the date the current step started (for deadline calculation)
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

        {/* Current step deadline badge */}
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
          const phaseStarted = phaseStepKeys.some(k => steps.find(s => s.step === k)?.isCompleted || steps.find(s => s.step === k)?.isCurrent);

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
                {/* Vertical connector line */}
                <div className="absolute left-[22px] top-4 bottom-4 w-px bg-border" />

                <div className="space-y-0">
                  {phaseSteps.map((def, idx) => {
                    const tStep = steps.find(s => s.step === def.key);
                    const isCompleted = tStep?.isCompleted ?? false;
                    const isCurrent = tStep?.isCurrent ?? false;
                    const isPending = !isCompleted && !isCurrent;
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
