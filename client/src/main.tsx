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
    // Notify the user once when a new service worker takes control
    // (i.e. an updated app version has been activated).
    let updateToastShown = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (updateToastShown) return;
      updateToastShown = true;
      toast('App updated — refresh');
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
