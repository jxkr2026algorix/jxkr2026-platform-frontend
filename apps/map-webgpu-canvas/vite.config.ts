import { defineConfig } from "vite";

// TMap raster tiles (topopentile*.tmap.co.kr) do not send CORS headers, so
// the dev server proxies them under same-origin paths. Three shards work
// around the browser's 6-connections-per-origin limit for fast tile loads.
// A production embed needs equivalent proxies on its own server.
const tmapProxy = Object.fromEntries(
  [1, 2, 3].map((n) => [
    `/tmap-tiles${n}`,
    {
      target: `https://topopentile${n}.tmap.co.kr`,
      changeOrigin: true,
      rewrite: (path: string) =>
        path.replace(new RegExp(`^/tmap-tiles${n}`), "/tms/1.0.0/hd_tile"),
    },
  ]),
);

export default defineConfig({
  server: {
    port: 5183,
    proxy: tmapProxy,
  },
  preview: {
    proxy: tmapProxy,
  },
  build: {
    target: "es2022",
  },
});
