import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@ccqa/shared": path.resolve(__dirname, "../shared/src/index.ts"),
    },
  },
  server: {
    port: 4318,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4317",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
