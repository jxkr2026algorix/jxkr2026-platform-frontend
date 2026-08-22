import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

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
 * `The console declares incidents, so it carries the operator key.`
 *
 * On the dev server against a local backend only, the key falls back to the
 * development one the backend ships in its own `.env`. `vite preview` and any
 * real deployment must set a key explicitly, because it grants incident declaration and resident contact.
 */
const platformProxyFor = (dev: boolean, mode: string) => {
  const env = { ...loadEnv(mode, repoRoot, ""), ...process.env };
  const target = env.SALGIL_PLATFORM_API_URL ?? "http://127.0.0.1:8000";
  const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)\b/.test(target);
  const key =
    env.SALGIL_OPERATOR_API_KEY ||
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
  plugins: [react()],
  server: {
    proxy: {
      "/api/platform": platformProxyFor(command === "serve", mode),
      "/api/mcp": {
        target: "https://datainfra.salgil.gyeongbuk.kr",
        changeOrigin: true,
        rewrite: () => "/mcp/",
      },
    },
  },
  preview: {
    proxy: {
      "/api/platform": platformProxyFor(false, mode),
      "/api/mcp": {
        target: "https://datainfra.salgil.gyeongbuk.kr",
        changeOrigin: true,
        rewrite: () => "/mcp/",
      },
    },
  },
}));
