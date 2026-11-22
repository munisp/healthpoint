import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import superjson from "superjson";
import App from "./App";
import "./index.css";

// Register service worker for PWA offline support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // When a new service worker takes control, a new app version has been
    // activated. Offer a persistent toast with an explicit refresh action
    // instead of a transient notice the user might miss.
    let updateToastShown = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (updateToastShown) return;
      updateToastShown = true;
      toast('A new version of HealthPoint IDR is ready', {
        description:
          'Refresh to load the latest updates. Unsaved work on this page will not be affected until you refresh.',
        duration: Infinity,
        id: 'sw-update-available',
        action: {
          label: 'Refresh',
          onClick: () => window.location.reload(),
        },
      });
    });

    navigator.serviceWorker.register('/sw.js').catch((error) => {
      // Registration failure must not break the app, but it should be visible.
      console.warn('[PWA] Service worker registration failed:', error);
    });
  });
}

// Global query defaults: a short staleTime prevents refetch-on-mount storms
// when navigating between pages whose data was fetched moments ago, while
// keeping data effectively live. refetchOnWindowFocus is disabled globally
// (per-query overrides still apply, e.g. useAuth already sets its own).
// Mutations are unaffected — they always execute and invalidate explicitly.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});
const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        // Wave W5-6: attach the impersonation token (when an admin is
        // impersonating) so the server can audit every request.
        const headers = new Headers(init?.headers ?? {});
        try {
          const imp = sessionStorage.getItem("hp_impersonation_token");
          if (imp) headers.set("x-impersonation-token", imp);
        } catch { /* sessionStorage unavailable */ }
        return globalThis.fetch(input, {
          ...(init ?? {}),
          headers,
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
