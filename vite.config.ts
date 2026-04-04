import { defineConfig } from "vite";
// @ts-expect-error node builtin used only in vite config
import { resolve } from "path";

declare const process: { env: Record<string, string | undefined> };

const host = process.env.TAURI_DEV_HOST;
const isWeb = process.env.BUILD_TARGET === "web";

void resolve;

// https://vite.dev/config/
export default defineConfig(async () => ({
  base: isWeb ? "/mh370-analysis-tool/" : "/",
  clearScreen: false,
  assetsInclude: ["**/*.tiff", "**/*.tif"],
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
