# JXKR 2026 Platform Frontend

SALGIL — a disaster response platform for Gyeongbuk. Yarn workspace holding the
operations console, the mobile PWA, and the WebGPU map canvas.

| Workspace | Purpose |
| --- | --- |
| `apps/console-front` | React operations dashboard |
| `apps/mobile` | Installable PWA for residents and field responders |
| `apps/map-webgpu-canvas` | WebGPU 3D map, embedded by the console in an iframe |

`salgil-ops-web` and `salgil-field-web` are earlier prototypes kept as design references.

## Development

Requires Node.js 20.19+ and Corepack.

```bash
corepack enable
yarn install

yarn dev:console   # needs `yarn dev:map --port 5175` running alongside
yarn dev:mobile
```

`yarn lint`, `yarn typecheck`, `yarn build` cover every workspace.

## Deployment

```bash
docker compose up -d --build
```

| Service | Port |
| --- | --- |
| `console` | 8080 |
| `mobile` | 8081 |
| `map` | 8082 |

Each service builds its workspace and serves the static bundle from nginx.
Override ports with `CONSOLE_PORT`, `MOBILE_PORT`, `MAP_PORT`.

The console loads the map by URL from the browser, so `VITE_MAP_URL` (default
`http://localhost:8082`) must be reachable by the client and is baked in at build time:

```bash
VITE_MAP_URL=https://map.example.com docker compose build console
```

WebGPU needs a secure context — serve the map over HTTPS outside localhost.
