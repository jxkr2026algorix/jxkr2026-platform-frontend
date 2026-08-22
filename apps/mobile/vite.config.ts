import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

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
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["salgil-mark.svg", "pwa-192x192.png", "pwa-512x512.png"],
      manifest: {
        name: "SALGIL Mobile",
        short_name: "SALGIL",
        description: "Resident safety and field response companion",
        theme_color: "#ffffff",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
          {
            src: "/salgil-mark.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
    }),
  ],
  server: {
    proxy: { "/api/platform": platformProxy },
  },
  preview: {
    proxy: { "/api/platform": platformProxy },
  },
});
