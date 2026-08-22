import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const platformApiKey = process.env.SALGIL_PLATFORM_API_KEY;
const platformProxy = {
  target: process.env.SALGIL_PLATFORM_API_URL ?? "http://127.0.0.1:8000",
  changeOrigin: true,
  rewrite: (path: string) => path.replace(/^\/api\/platform/, "/api/v1"),
  ...(platformApiKey
    ? { headers: { Authorization: `Bearer ${platformApiKey}` } }
    : {}),
};

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api/platform": platformProxy,
      "/api/mcp": {
        target: "https://datainfra.salgil.gyeongbuk.kr",
        changeOrigin: true,
        rewrite: () => "/mcp/",
      },
    },
  },
  preview: {
    proxy: {
      "/api/platform": platformProxy,
      "/api/mcp": {
        target: "https://datainfra.salgil.gyeongbuk.kr",
        changeOrigin: true,
        rewrite: () => "/mcp/",
      },
    },
  },
});
