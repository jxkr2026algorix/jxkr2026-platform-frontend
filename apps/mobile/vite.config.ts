import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * The platform requires a key on every call. Without one the browser gets 401
 * on everything — including the situation stream, so no alert ever arrives and
 * the dashboard looks like the backend is down rather than unauthenticated.
 *
 * On the dev server only, fall back to the development key the backend ships
 * in its own `.env`. `vite preview` and any real deployment still require
 * SALGIL_PLATFORM_API_KEY to be set, because that key grants incident
 * declaration and resident contact.
 */
const platformProxyFor = (dev: boolean) => {
  const key =
    process.env.SALGIL_PLATFORM_API_KEY ?? (dev ? "dev-operator" : undefined);
  return {
    target: process.env.SALGIL_PLATFORM_API_URL ?? "http://127.0.0.1:8000",
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api\/platform/, "/api/v1"),
    ...(key ? { headers: { Authorization: `Bearer ${key}` } } : {}),
  };
};

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // The generated worker handles caching; this adds the push listener that
      // makes an alert arrive with no page open. Kept as a separate file in
      // `public/` because the rest of the worker is generated on every build.
      workbox: { importScripts: ["/push-sw.js"] },
      injectRegister: "auto",
      // The worker is what makes an emergency alert land on a locked phone,
      // so it has to be exercisable in development rather than only in a
      // production build.
      devOptions: { enabled: true, type: "module" },
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
    proxy: { "/api/platform": platformProxyFor(command === "serve") },
  },
  preview: {
    proxy: { "/api/platform": platformProxyFor(false) },
  },
}));
