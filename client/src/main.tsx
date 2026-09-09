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

const queryClient = new QueryClient();
const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
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
