/**
 * PersonaTour — W7-3 lightweight first-run guided hints for the persona
 * surfaces (/payer/cases, /idre/queue, /orgs, /patient/:token).
 *
 * Hand-rolled with existing deps only (no new npm packages): a small
 * sequential hint card anchored to the bottom-center of the viewport, with
 * Back/Next/Dismiss. Dismissal is persisted PER TOUR in localStorage
 * (key `hp.tour.dismissed.<tourId>`) — labelled: localStorage persistence,
 * not server-side. Keyboard accessible: focus moves into the card on open,
 * Escape dismisses, buttons are native <button>s. Honors
 * prefers-reduced-motion via the global CSS rule.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

export interface PersonaTourStep {
  title: string;
  body: string;
}

const storageKey = (tourId: string) => `hp.tour.dismissed.${tourId}`;

export function isTourDismissed(tourId: string): boolean {
  try {
    return localStorage.getItem(storageKey(tourId)) === "1";
  } catch {
    return false;
  }
}

/** Allows a "Replay tour" affordance to reset dismissal. */
export function resetTour(tourId: string): void {
  try {
    localStorage.removeItem(storageKey(tourId));
  } catch {
    /* storage unavailable */
  }
}

export default function PersonaTour({
  tourId,
  steps,
}: {
  tourId: string;
  steps: PersonaTourStep[];
}) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (steps.length === 0 || isTourDismissed(tourId)) return;
    const t = setTimeout(() => setOpen(true), 800);
    return () => clearTimeout(t);
  }, [tourId, steps.length]);

  useEffect(() => {
    if (open) cardRef.current?.focus();
  }, [open, index]);

  if (!open || steps.length === 0) return null;

  const step = steps[Math.min(index, steps.length - 1)];
  const isLast = index >= steps.length - 1;

  const dismiss = () => {
    try {
      localStorage.setItem(storageKey(tourId), "1");
    } catch {
      /* storage unavailable — tour simply reappears next load */
    }
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      dismiss();
    }
  };

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-modal="false"
      aria-label={`${step.title} (hint ${index + 1} of ${steps.length})`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="fixed bottom-4 left-1/2 z-[100] w-[min(92vw,26rem)] -translate-x-1/2 rounded-lg border bg-card p-4 shadow-xl outline-none"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold">{step.title}</p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss tour"
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-muted-foreground" aria-hidden="true">
          {index + 1} / {steps.length}
        </span>
        <div className="flex gap-2">
          {index > 0 && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setIndex(i => i - 1)}>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Back
            </Button>
          )}
          {isLast ? (
            <Button type="button" size="sm" onClick={dismiss}>
              Got it
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={() => setIndex(i => i + 1)}>
              Next <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
