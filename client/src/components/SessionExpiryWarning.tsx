/**
 * SessionExpiryWarning.tsx
 *
 * A modal dialog that appears when the user's session is about to expire.
 * Shows a live countdown timer and offers two actions:
 *   - "Stay Signed In" → calls /api/auth/refresh to silently extend the session
 *   - "Sign Out Now"   → redirects to /api/auth/logout
 *
 * This component is rendered once inside App.tsx and is controlled by
 * the useSessionExpiry hook via a shared context.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Clock, LogOut, RefreshCw, ShieldAlert } from "lucide-react";
import { getLogoutUrl } from "@/const";
import { toast } from "sonner";

interface SessionExpiryWarningProps {
  /** Whether the warning dialog is currently visible */
  open: boolean;
  /** Remaining session time in milliseconds when the dialog was opened */
  remainingMs: number;
  /** Called when the user successfully extends their session */
  onExtended: (newExpiresAt: number) => void;
  /** Called when the user chooses to sign out */
  onSignOut?: () => void;
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  }
  return `${seconds}s`;
}

export function SessionExpiryWarning({
  open,
  remainingMs,
  onExtended,
  onSignOut,
}: SessionExpiryWarningProps) {
  const [countdown, setCountdown] = useState(remainingMs);
  const [isExtending, setIsExtending] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const openedAtRef = useRef(Date.now());

  // Reset countdown when dialog opens with new remainingMs
  useEffect(() => {
    if (open) {
      openedAtRef.current = Date.now();
      setCountdown(remainingMs);
    }
  }, [open, remainingMs]);

  // Live countdown ticker
  useEffect(() => {
    if (!open) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - openedAtRef.current;
      const remaining = Math.max(0, remainingMs - elapsed);
      setCountdown(remaining);

      if (remaining === 0) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        // Session has expired — redirect to login
        window.location.href = getLogoutUrl();
      }
    }, 500);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [open, remainingMs]);

  const handleExtend = useCallback(async () => {
    setIsExtending(true);
    try {
      const res = await fetch("/api/auth/refresh", {
        method: "GET",
        credentials: "include",
      });

      if (!res.ok) {
        throw new Error(`Refresh failed: ${res.status}`);
      }

      const data = (await res.json()) as {
        refreshed: boolean;
        expiresAt: number;
        remainingMs: number;
      };

      if (data.refreshed) {
        toast.success("Session extended", {
          description: "You are signed in for another 8 hours.",
          duration: 3000,
        });
        onExtended(data.expiresAt);
      } else {
        throw new Error("Server returned refreshed: false");
      }
    } catch (err) {
      console.error("[SessionExpiry] Refresh failed:", err);
      toast.error("Could not extend session", {
        description: "Please sign in again.",
        duration: 4000,
      });
      // Redirect to login after a short delay so the toast is visible
      setTimeout(() => {
        window.location.href = getLogoutUrl();
      }, 1500);
    } finally {
      setIsExtending(false);
    }
  }, [onExtended]);

  const handleSignOut = useCallback(() => {
    onSignOut?.();
    window.location.href = getLogoutUrl();
  }, [onSignOut]);

  // Progress bar: 0% = just opened (full time), 100% = expired
  const initialMs = remainingMs || 1;
  const progressPct = Math.min(100, ((initialMs - countdown) / initialMs) * 100);
  const isUrgent = countdown < 60_000; // < 1 minute

  return (
    <Dialog open={open} modal>
      {/* No DialogTrigger — controlled externally */}
      <DialogContent
        className="sm:max-w-md"
        // Prevent closing by clicking outside or pressing Escape
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-full ${
                isUrgent
                  ? "bg-destructive/10 text-destructive"
                  : "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
              }`}
            >
              {isUrgent ? (
                <ShieldAlert className="h-5 w-5" />
              ) : (
                <Clock className="h-5 w-5" />
              )}
            </div>
            <DialogTitle className="text-lg">
              {isUrgent ? "Session expiring now" : "Your session is about to expire"}
            </DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground">
            {isUrgent
              ? "Your session has almost expired. Extend it now to avoid losing unsaved work."
              : "For your security, your session will automatically end soon. Would you like to stay signed in?"}
          </DialogDescription>
        </DialogHeader>

        {/* Countdown display */}
        <div className="my-4 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Time remaining</span>
            <span
              className={`font-mono font-semibold text-base tabular-nums ${
                isUrgent ? "text-destructive" : "text-foreground"
              }`}
            >
              {formatCountdown(countdown)}
            </span>
          </div>
          <Progress
            value={progressPct}
            className={`h-2 ${isUrgent ? "[&>div]:bg-destructive" : "[&>div]:bg-amber-500"}`}
          />
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSignOut}
            className="gap-2"
            disabled={isExtending}
          >
            <LogOut className="h-4 w-4" />
            Sign Out Now
          </Button>
          <Button
            size="sm"
            onClick={handleExtend}
            disabled={isExtending}
            className="gap-2"
          >
            {isExtending ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Extending…
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" />
                Stay Signed In
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
