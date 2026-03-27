import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// PORT defaults to 5173 (Vite default) when not set by the environment.
const port = Number(process.env.PORT ?? "5173");

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${process.env.PORT}"`);
}

// BASE_PATH defaults to "/" for local development.
// Replit sets this to a sub-path for proxying.
const basePath = process.env.BASE_PATH ?? "/";

// In Replit, the infrastructure proxy routes /api traffic to the API server,
// so no Vite proxy is needed there. Locally, Vite must proxy /api itself.
const isReplit = process.env.REPL_ID !== undefined;

// The port the API server listens on locally (default 3001).
const apiPort = process.env.VITE_API_PORT ?? "3001";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
    // Only proxy locally. Replit's infrastructure proxy handles /api routing.
    proxy: isReplit
      ? undefined
      : {
          "/api": {
            target: `http://localhost:${apiPort}`,
            changeOrigin: true,
            ws: true,
          },
        },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
