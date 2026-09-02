/**
 * useSessionExpiry.ts
 *
 * Polls /api/auth/session every 60 seconds to track the session TTL.
 * When the session is within SESSION_WARN_BEFORE_MS (default 5 minutes)
 * of expiry, it sets `showWarning = true` to trigger the SessionExpiryWarning modal.
 *
 * Also handles:
 *  - Visibility-based polling pause (stops when tab is hidden, resumes on focus)
 *  - Immediate re-check on tab focus (catches expiry while tab was hidden)
 *  - Clearing the warning state after a successful refresh
 */

import { useState, useEffect, useRef, useCallback } from "react";

const POLL_INTERVAL_MS = 60_000;          // Check every 60 seconds
const WARN_BEFORE_MS   = 5 * 60_000;     // Show warning 5 minutes before expiry
const URGENT_MS        = 60_000;         // "Urgent" threshold: 1 minute

interface SessionStatus {
  authenticated: boolean;
  expiresAt?: number;   // ms epoch
  remainingMs?: number;
  userId?: string;
}

interface UseSessionExpiryReturn {
  /** Whether the expiry warning modal should be shown */
  showWarning: boolean;
  /** Remaining ms when the warning was triggered (for the countdown) */
  warningRemainingMs: number;
  /** Whether the session is in the "urgent" (<1 min) zone */
  isUrgent: boolean;
  /** Call this after a successful /api/auth/refresh to reset the warning */
  onSessionExtended: (newExpiresAt: number) => void;
  /** Current session expiry timestamp (ms epoch), or undefined if unknown */
  expiresAt: number | undefined;
}

async function fetchSessionStatus(): Promise<SessionStatus> {
  try {
    const res = await fetch("/api/auth/session", {
      credentials: "include",
      headers: { "Cache-Control": "no-cache" },
    });
    if (!res.ok) return { authenticated: false };
    return (await res.json()) as SessionStatus;
  } catch {
    // Network error — treat as still authenticated to avoid false logouts
    return { authenticated: true };
  }
}

export function useSessionExpiry(isAuthenticated: boolean): UseSessionExpiryReturn {
  const [showWarning, setShowWarning]               = useState(false);
  const [warningRemainingMs, setWarningRemainingMs] = useState(WARN_BEFORE_MS);
  const [isUrgent, setIsUrgent]                     = useState(false);
  const [expiresAt, setExpiresAt]                   = useState<number | undefined>(undefined);

  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMounted   = useRef(true);

  const check = useCallback(async () => {
    if (!isAuthenticated || !isMounted.current) return;

    const status = await fetchSessionStatus();

    if (!isMounted.current) return;

    if (!status.authenticated) {
      // Session is gone — redirect to login preserving current path
      const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/api/auth/login?redirectTo=${returnTo}`;
      return;
    }

    if (status.expiresAt) {
      setExpiresAt(status.expiresAt);
      const remaining = Math.max(0, status.expiresAt - Date.now());

      if (remaining <= WARN_BEFORE_MS) {
        setWarningRemainingMs(remaining);
        setIsUrgent(remaining <= URGENT_MS);
        setShowWarning(true);
      } else {
        // Session is healthy — hide warning if it was showing
        setShowWarning(false);
        setIsUrgent(false);
      }
    }
  }, [isAuthenticated]);

  // Start polling when authenticated
  useEffect(() => {
    isMounted.current = true;

    if (!isAuthenticated) {
      if (timerRef.current) clearInterval(timerRef.current);
      setShowWarning(false);
      return;
    }

    // Initial check after a short delay (don't block first render)
    const initialDelay = setTimeout(() => { void check(); }, 2000);

    timerRef.current = setInterval(() => { void check(); }, POLL_INTERVAL_MS);

    return () => {
      isMounted.current = false;
      clearTimeout(initialDelay);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isAuthenticated, check]);

  // Re-check immediately when the tab becomes visible again
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && isAuthenticated) {
        void check();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [isAuthenticated, check]);

  const onSessionExtended = useCallback((newExpiresAt: number) => {
    setExpiresAt(newExpiresAt);
    setShowWarning(false);
    setIsUrgent(false);
    setWarningRemainingMs(WARN_BEFORE_MS);
  }, []);

  return {
    showWarning,
    warningRemainingMs,
    isUrgent,
    onSessionExtended,
    expiresAt,
  };
}
