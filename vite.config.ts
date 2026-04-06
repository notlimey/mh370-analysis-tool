import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

declare const process: { env: Record<string, string | undefined> };

const host = process.env.TAURI_DEV_HOST;
const isWeb = process.env.BUILD_TARGET === "web";

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [solid()],
  base: isWeb ? "/mh370-analysis-tool/" : "/",
  clearScreen: false,
  assetsInclude: ["**/*.tiff", "**/*.tif"],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          mapbox: ["mapbox-gl"],
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
