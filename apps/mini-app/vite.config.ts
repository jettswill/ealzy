import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { writeReleaseManifest } from "./release-manifest";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

function ealzyReleasePlugin(): Plugin {
  return {
    name: "ealzy-release",
    apply: "build",
    closeBundle() {
      writeReleaseManifest(path.resolve(rootDir, "dist"));
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), ealzyReleasePlugin()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_DEV_API_URL ?? "http://localhost:3001",
        changeOrigin: true,
        timeout: 120_000,
        proxyTimeout: 120_000,
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: true,
    env: {
      VITE_API_BASE_URL: "",
      VITE_TELEGRAM_BOT_USERNAME: "ealzy_bot",
      VITE_TELEGRAM_BOT_ID: "8605994246",
    },
  },
});
