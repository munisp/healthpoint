import { useEffect, useRef } from "react";
import { toast } from "sonner";

/**
 * useNetworkStatus
 *
 * Listens for browser online/offline events and fires Sonner toasts
 * when the network connection drops or is restored.
 *
 * Mount this hook once in the app shell (App.tsx) so it is active on
 * every page without duplicating listeners. A persistent OfflineBanner
 * complements these transient toasts.
 */
export function useNetworkStatus() {
  // Track whether the "offline" toast is currently showing so we can
  // dismiss it — and only announce a restore after an actual outage.
  const offlineToastId = useRef<string | number | null>(null);

  useEffect(() => {
    const handleOffline = () => {
      offlineToastId.current = toast.error("No internet connection", {
        description:
          "You are offline. Data may be stale and actions will fail until your connection is restored.",
        duration: Infinity, // keep visible until reconnected
        id: "network-offline",
      });
    };

    const handleOnline = () => {
      // Only announce a restore if we previously showed an outage notice;
      // this suppresses noise from the initial "online" event some
      // browsers fire on page load.
      const wasOffline = offlineToastId.current !== null;
      toast.dismiss("network-offline");
      offlineToastId.current = null;
      if (!wasOffline) return;

      toast.success("Connection restored", {
        description: "You are back online. Your data will refresh automatically.",
        duration: 4000,
        id: "network-online",
      });
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    // If the page loaded while already offline, show the toast immediately
    if (!navigator.onLine) {
      handleOffline();
    }

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);
}
