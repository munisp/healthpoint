import { QueryClient } from "@tanstack/react-query";

/**
 * Single shared QueryClient. Exported from a module (not the root layout) so
 * the auth layer can wipe cached API data on sign-out without a prop chain.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});
