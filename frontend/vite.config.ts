/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API = process.env.FH_API ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: API, changeOrigin: true }, "/data": { target: API, changeOrigin: true } },
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
