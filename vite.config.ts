import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

// Tauri sets TAURI_DEV_HOST when running `tauri android dev` so the
// device/emulator can reach the dev server over the network.
const host = process.env.TAURI_DEV_HOST ?? "";

export default defineConfig({
  plugins: [
    // File-based routing: generates src/routeTree.gen.ts from src/routes (commit it).
    tanstackRouter({
      target: "react",
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
      quoteStyle: "double",
      semicolons: true,
    }),
    react(),
  ],
  define: {
    __BUILD_ID__: JSON.stringify(process.env.GITHUB_SHA ?? `dev-${Date.now()}`),
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host !== "" ? host : false,
    ...(host !== "" ? { hmr: { protocol: "ws", host, port: 1421 } } : {}),
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
  },
});
