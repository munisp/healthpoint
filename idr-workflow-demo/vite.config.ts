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
    "import.meta.env.VITE_APP_TITLE": JSON.stringify(
      process.env.VITE_APP_TITLE ?? "HealthPoint"
    ),
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
      // Force all packages to use the same React instance to prevent
      // "Cannot read properties of null (reading 'useState')" errors
      react: path.resolve(import.meta.dirname, "node_modules/react"),
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
    // Largest lazy-loaded data-visualization vendor chunk; enforce a reviewed 400 KB budget.
    chunkSizeWarningLimit: 400,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (/(?:^|\/)(react|react-dom|scheduler|wouter)(?:\/|$)/.test(id)) {
            return "react-vendor";
          }
          if (id.includes("@radix-ui") || id.includes("lucide-react"))
            return "ui-vendor";
          if (id.includes("recharts")) return "recharts-vendor";
          if (id.includes("d3-")) return "d3-vendor";
          if (id.includes("chart.js")) return "chartjs-vendor";
          if (/(react-hook-form|zod|@hookform)/.test(id)) return "forms-vendor";
          if (id.includes("@tanstack")) return "query-vendor";
        },
      },
    },
  },
  server: {
    host: true,
    allowedHosts: ["localhost", "127.0.0.1"],
    // HMR WebSocket — override clientPort/protocol if running behind a TLS proxy
    // e.g. hmr: { clientPort: 443, protocol: "wss" }
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
