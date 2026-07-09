import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, ChevronRight, ChevronLeft, Sparkles, CheckCircle2 } from "lucide-react";

const TOUR_KEY = "healthpoint_tour_completed";

interface TourStep {
  title: string;
  description: string;
  emoji: string;
  tip?: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    title: "Welcome to HealthPoint",
    description: "HealthPoint automates the complete 19-step Federal IDR process under the No Surprises Act. Let's take a quick tour of the platform.",
    emoji: "🏥",
    tip: "You can reopen this tour anytime from Settings → Help.",
  },
  {
    title: "Manage Your Disputes",
    description: "The Disputes section is your command center. Create new IDR disputes, track their progress through all 19 workflow steps, and manage deadlines — all in one place.",
    emoji: "⚖️",
    tip: "Use Cmd+K to quickly navigate to any dispute or page.",
  },
  {
    title: "AI-Powered Document Analysis",
    description: "Upload EOBs, Remittance Advices, and CMS-1500 forms to the Document Analyzer. Our AI extracts 25 structured fields automatically — saving hours of manual data entry.",
    emoji: "🔍",
    tip: "Drag and drop files directly onto the analyzer for instant processing.",
  },
  {
    title: "Financial Ledger & Analytics",
    description: "Track every dollar with the double-entry Financial Ledger. Monitor win rates by payer in Payer Intelligence, and export data to your BI tools via the Lakehouse.",
    emoji: "📊",
    tip: "Use the Group by Account toggle to see subtotals per account type.",
  },
  {
    title: "You're Ready to Go",
    description: "Your platform is fully configured. Start by creating your first dispute, or explore the Dashboard to see your KPIs at a glance. Press ? at any time to see all keyboard shortcuts.",
    emoji: "🚀",
    tip: "The Audit Trail records every action — nothing is ever lost.",
  },
];

export default function OnboardingTour() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const completed = localStorage.getItem(TOUR_KEY);
    if (!completed) {
      // Show tour after a short delay on first load
      const timer = setTimeout(() => setVisible(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  function complete() {
    localStorage.setItem(TOUR_KEY, "true");
    setVisible(false);
    setDismissed(true);
  }

  function dismiss() {
    setVisible(false);
    setDismissed(true);
    // Don't mark as completed so it shows again next session
  }

  if (!visible || dismissed) return null;

  const current = TOUR_STEPS[step];
  const isLast = step === TOUR_STEPS.length - 1;
  const isFirst = step === 0;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm"
        onClick={dismiss}
        aria-hidden="true"
      />

      {/* Tour card — centered */}
      <div
        className="fixed z-[61] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md"
        role="dialog"
        aria-modal="true"
        aria-label="Onboarding tour"
      >
        <div className="bg-background rounded-2xl shadow-2xl border overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-primary/10 to-primary/5 px-6 pt-6 pb-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <span className="text-4xl">{current.emoji}</span>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                      {step + 1} / {TOUR_STEPS.length}
                    </Badge>
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <h2 className="text-lg font-bold leading-tight">{current.title}</h2>
                </div>
              </div>
              <button
                className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted transition-colors"
                onClick={dismiss}
                aria-label="Close tour"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-1 bg-muted">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${((step + 1) / TOUR_STEPS.length) * 100}%` }}
            />
          </div>

          {/* Body */}
          <div className="px-6 py-5">
            <p className="text-sm text-foreground/80 leading-relaxed">{current.description}</p>

            {current.tip && (
              <div className="mt-4 flex items-start gap-2 rounded-lg bg-primary/5 border border-primary/20 px-3 py-2.5">
                <span className="text-base shrink-0">💡</span>
                <p className="text-xs text-muted-foreground leading-relaxed">{current.tip}</p>
              </div>
            )}
          </div>

          {/* Step dots */}
          <div className="flex justify-center gap-1.5 pb-2">
            {TOUR_STEPS.map((_, i) => (
              <button
                key={i}
                className={`h-1.5 rounded-full transition-all ${i === step ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/30"}`}
                onClick={() => setStep(i)}
                aria-label={`Go to step ${i + 1}`}
              />
            ))}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t bg-muted/30">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={dismiss}
            >
              Skip tour
            </Button>
            <div className="flex items-center gap-2">
              {!isFirst && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setStep(s => s - 1)}
                >
                  <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                  Back
                </Button>
              )}
              {isLast ? (
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  onClick={complete}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                  Get started
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setStep(s => s + 1)}
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// Hook to programmatically restart the tour
export function useRestartTour() {
  return () => {
    localStorage.removeItem(TOUR_KEY);
    window.location.reload();
  };
}
