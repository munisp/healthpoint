import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/**
 * OfflineBanner
 *
 * Persistent, non-blocking banner shown whenever the browser reports it is
 * offline. Complements the transient Sonner toasts from useNetworkStatus:
 * the banner stays visible for the whole offline period so users always
 * understand why data/actions may be stale, and disappears automatically
 * when connectivity returns.
 */
export default function OfflineBanner() {
  const [isOffline, setIsOffline] = useState<boolean>(
    typeof navigator !== "undefined" ? !navigator.onLine : false
  );

  useEffect(() => {
    const handleOffline = () => setIsOffline(true);
    const handleOnline = () => setIsOffline(false);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-2 bg-warning px-4 py-1.5 text-center text-xs font-medium text-warning-foreground shadow-sm"
    >
      <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        You are offline — data may be stale and some actions will fail until
        your connection is restored.
      </span>
    </div>
  );
}
