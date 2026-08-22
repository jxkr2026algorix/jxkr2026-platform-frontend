import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * The platform requires a key on every call. Without one the browser gets 401
 * on everything — including the situation stream, so no alert ever arrives and
 * the screen looks like the backend is down rather than unauthenticated.
 *
 * Settings come from `.env.local` at the repo root so the console, the phone
 * and the map all point at the same backend; started separately with separate
 * config they drift, and the two screens disagree about what is happening.
 * The shell still wins, for a one-off override without an edit.
 *
 * This screen is the audience view reached by QR, so it gets its own key
 * rather than the operator's: a screen anyone can open must not be able to
 * declare an incident.
 *
 * On the dev server against a local backend only, the key falls back to the
 * development one the backend ships in its own `.env`. `vite preview` and any
 * real deployment must set a key explicitly.
 */
const platformProxyFor = (dev: boolean, mode: string) => {
  const env = { ...loadEnv(mode, repoRoot, ""), ...process.env };
  const target = env.SALGIL_PLATFORM_API_URL ?? "http://127.0.0.1:8000";
  const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)\b/.test(target);
  const key =
    env.SALGIL_MOBILE_API_KEY ||
    env.SALGIL_PLATFORM_API_KEY ||
    (dev && isLocal ? "dev-operator" : undefined);
  return {
    target,
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api\/platform/, "/api/v1"),
    ...(key ? { headers: { Authorization: `Bearer ${key}` } } : {}),
  };
};

export default defineConfig(({ command, mode }) => ({
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
    proxy: { "/api/platform": platformProxyFor(command === "serve", mode) },
  },
  preview: {
    proxy: { "/api/platform": platformProxyFor(false, mode) },
  },
}));
