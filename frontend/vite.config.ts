import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const apiProxyTarget = process.env.SOLARPV_API_PROXY_TARGET?.trim() || "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    proxy: {
      "/api/v1": { target: apiProxyTarget, changeOrigin: true },
    },
  },
  preview: {host: '127.0.0.1'},
  test: {
    environment: "jsdom",
    css: { include: /importWorkspace\.css/ },
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
