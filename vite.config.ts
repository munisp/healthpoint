import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

const plugins = [react(), tailwindcss(), jsxLocPlugin()];

export default defineConfig({
  plugins,
  define: {
    // Provide defaults so the app works even without .env overrides
    'import.meta.env.VITE_APP_TITLE': JSON.stringify(
      process.env.VITE_APP_TITLE ?? 'HealthPoint'
    ),
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
      // Force all packages to use the same React instance to prevent
      // "Cannot read properties of null (reading 'useState')" errors
      "react": path.resolve(import.meta.dirname, "node_modules/react"),
      "react-dom": path.resolve(import.meta.dirname, "node_modules/react-dom"),
    },
    dedupe: ["react", "react-dom", "@tanstack/react-query"],
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Split stable, always-loaded vendor code out of the app entry chunk
        // so app-code changes don't bust the browser cache for the framework
        // bundle (and vice versa). Route pages are already lazy-loaded in
        // client/src/App.tsx. Charts/motion libs are deliberately NOT forced
        // here: they are only imported by lazy routes, and forcing a shared
        // manual chunk would preload them eagerly on first paint.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/scheduler/") ||
            id.includes("/wouter/")
          ) {
            return "vendor-react";
          }
          if (
            id.includes("/@tanstack/") ||
            id.includes("/@trpc/") ||
            id.includes("/superjson/")
          ) {
            return "vendor-data";
          }
          return undefined;
        },
      },
    },
  },
  server: {
    host: true,
    allowedHosts: [
      "localhost",
      "127.0.0.1",
    ],
    // HMR WebSocket — override clientPort/protocol if running behind a TLS proxy
    // e.g. hmr: { clientPort: 443, protocol: "wss" }
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
