import { QueryClient } from "@tanstack/react-query";

/**
 * Single shared QueryClient. Exported from a module (not the root layout) so
 * the auth layer can wipe cached API data on sign-out without a prop chain.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Reference data (lists, dashboard aggregates) rarely changes
      // second-to-second; 30s staleness avoids refetch storms on tab focus.
      staleTime: 30_000,
      // Keep unused cache entries for 5 minutes so back-navigation renders
      // instantly without a network round trip.
      gcTime: 5 * 60_000,
      retry: 1,
      // Mobile connectivity is intermittent: refetch stale queries when the
      // device comes back online, but don't refetch on every screen focus
      // (RN apps focus far more often than browser tabs).
      refetchOnReconnect: true,
      refetchOnWindowFocus: false,
    },
  },
});
