import { useEffect, useRef } from "react";
import { toast } from "sonner";

/**
 * useNetworkStatus
 *
 * Listens for browser online/offline events and fires Sonner toasts
 * when the network connection drops or is restored.
 *
 * Mount this hook once in the app shell (App.tsx) so it is active on
 * every page without duplicating listeners.
 */
export function useNetworkStatus() {
  // Track whether we have already shown the "offline" toast so we can
  // dismiss it when the connection comes back.
  const offlineToastId = useRef<string | number | null>(null);
  // Suppress the "restored" toast on the very first mount (the browser
  // fires "online" immediately if the tab loads while connected).
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;

    const handleOffline = () => {
      offlineToastId.current = toast.error("No internet connection", {
        description:
          "You are offline. Data may be stale and actions will fail until your connection is restored.",
        duration: Infinity, // keep visible until reconnected
        id: "network-offline",
      });
    };

    const handleOnline = () => {
      // Dismiss the offline toast if it is still showing
      if (offlineToastId.current !== null) {
        toast.dismiss("network-offline");
        offlineToastId.current = null;
      }

      // Don't fire "restored" on initial page load
      if (!mounted.current) return;

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
