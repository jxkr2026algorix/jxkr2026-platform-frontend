import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api/mcp": {
        target: "https://datainfra.salgil.gyeongbuk.kr",
        changeOrigin: true,
        rewrite: () => "/mcp/",
      },
    },
  },
  preview: {
    proxy: {
      "/api/mcp": {
        target: "https://datainfra.salgil.gyeongbuk.kr",
        changeOrigin: true,
        rewrite: () => "/mcp/",
      },
    },
  },
});
