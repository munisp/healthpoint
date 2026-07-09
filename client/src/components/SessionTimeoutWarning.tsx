import { useEffect, useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Clock, LogIn } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";

// Show warning 2 minutes before expiry
const WARN_BEFORE_MS = 2 * 60 * 1000;
// Poll the /me endpoint every 60 seconds to detect session state
const POLL_INTERVAL_MS = 60 * 1000;
// Default session length if we can't determine it (30 minutes)
const DEFAULT_SESSION_MS = 30 * 60 * 1000;

export default function SessionTimeoutWarning() {
  const [showWarning, setShowWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(120);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastActivityRef = useRef<number>(Date.now());

  const meQuery = trpc.auth.me.useQuery(undefined, {
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  // Track user activity to reset the idle timer
  useEffect(() => {
    const resetActivity = () => {
      lastActivityRef.current = Date.now();
      if (showWarning) setShowWarning(false);
    };
    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    events.forEach(e => window.addEventListener(e, resetActivity, { passive: true }));
    return () => events.forEach(e => window.removeEventListener(e, resetActivity));
  }, [showWarning]);

  // Set up idle detection timer
  useEffect(() => {
    if (!meQuery.data) return; // Not logged in, don't warn

    function checkIdle() {
      const idleMs = Date.now() - lastActivityRef.current;
      const remaining = DEFAULT_SESSION_MS - idleMs;

      if (remaining <= WARN_BEFORE_MS && remaining > 0 && !showWarning) {
        setShowWarning(true);
        setSecondsLeft(Math.floor(remaining / 1000));
      }
    }

    timerRef.current = setInterval(checkIdle, 10_000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [meQuery.data, showWarning]);

  // Countdown ticker when warning is visible
  useEffect(() => {
    if (!showWarning) {
      if (countdownRef.current) clearInterval(countdownRef.current);
      return;
    }

    countdownRef.current = setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) {
          // Session expired — redirect to login
          window.location.href = getLoginUrl();
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [showWarning]);

  function stayLoggedIn() {
    // Touching the /me endpoint refreshes the session cookie
    meQuery.refetch();
    lastActivityRef.current = Date.now();
    setShowWarning(false);
    setSecondsLeft(120);
  }

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const timeStr = `${mins}:${secs.toString().padStart(2, "0")}`;

  return (
    <Dialog open={showWarning} onOpenChange={() => {}}>
      <DialogContent
        className="max-w-sm"
        onInteractOutside={e => e.preventDefault()}
        onEscapeKeyDown={e => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-amber-500" />
            Session expiring soon
          </DialogTitle>
          <DialogDescription>
            Your session will expire due to inactivity. You will be logged out in:
          </DialogDescription>
        </DialogHeader>

        {/* Countdown display */}
        <div className="flex justify-center py-4">
          <div className="flex items-center justify-center h-24 w-24 rounded-full border-4 border-amber-400 bg-amber-50 dark:bg-amber-950/30">
            <span className="text-3xl font-bold font-mono text-amber-600 dark:text-amber-400">
              {timeStr}
            </span>
          </div>
        </div>

        <p className="text-sm text-center text-muted-foreground">
          Any unsaved changes may be lost. Click below to stay logged in.
        </p>

        <div className="flex gap-3 pt-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => { window.location.href = getLoginUrl(); }}
          >
            Log out now
          </Button>
          <Button
            className="flex-1"
            onClick={stayLoggedIn}
          >
            <LogIn className="h-4 w-4 mr-2" />
            Stay logged in
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
