import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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
  plugins: [react()],
  server: {
    proxy: {
      "/api/platform": platformProxyFor(command === "serve"),
      "/api/mcp": {
        target: "https://datainfra.salgil.gyeongbuk.kr",
        changeOrigin: true,
        rewrite: () => "/mcp/",
      },
    },
  },
  preview: {
    proxy: {
      "/api/platform": platformProxyFor(false),
      "/api/mcp": {
        target: "https://datainfra.salgil.gyeongbuk.kr",
        changeOrigin: true,
        rewrite: () => "/mcp/",
      },
    },
  },
}));
