# JXKR 2026 Platform Frontend

SALGIL — a disaster response platform for Gyeongbuk. Yarn workspace holding the
operations console, the mobile PWA, and the WebGPU map canvas.

## License

Licensed under the [Apache License, Version 2.0](LICENSE).

| Workspace | Purpose |
| --- | --- |
| `apps/console-front` | React operations dashboard |
| `apps/mobile` | Installable PWA for residents and field responders |
| `apps/map-webgpu-canvas` | WebGPU 3D map, embedded by the console in an iframe |
| `apps/platform-client` | Typed incident REST client shared by console and mobile |

`salgil-ops-web` and `salgil-field-web` are earlier prototypes kept as design references.

## Development

Requires Node.js 20.19+ and Corepack.

```bash
corepack enable
yarn install

yarn dev:map --port 5175
SALGIL_PLATFORM_API_URL=http://127.0.0.1:8000 SALGIL_PLATFORM_API_KEY=<operator-key> yarn dev:mobile --port 5174
SALGIL_PLATFORM_API_URL=http://127.0.0.1:8000 SALGIL_PLATFORM_API_KEY=<operator-key> VITE_MAP_URL=http://localhost:5175 VITE_MOBILE_URL=http://localhost:5174 yarn dev:console --port 5173
```

`yarn lint`, `yarn typecheck`, `yarn build` cover every workspace.

## Platform incident contract

The frontend consumes the platform backend's real `/api/v1/incidents`
contract. Console and mobile poll open incidents for region `47750` every two
seconds. A new backend incident updates both clients; a `wildfire` incident
also switches the WebGPU map to wildfire and triggers a visible origin.

Creating an event from the console posts an `IncidentCreate` to
`POST /api/v1/incidents`. The selected map point is recorded as
`opening_evidence.map_origin`, so the same coordinates survive the backend
round trip. A backend-created wildfire without coordinates uses the shared
Cheongsong demo origin. Frontend scenario names are translated to the
backend's canonical hazard names (`rain` to `heavy_rain`, `snow` to
`heavy_snow`, and so on).

API credentials are never baked into the browser bundle. During development,
Vite proxies `/api/platform/*` to `${SALGIL_PLATFORM_API_URL}/api/v1/*` and
adds the server-only `SALGIL_PLATFORM_API_KEY` as a bearer token. Production
must provide the same narrow reverse-proxy path and inject its operator
credential there. If the backend is unavailable, the UI reports the failure
and does not claim that a local-only incident was recorded.

Set `VITE_PLATFORM_REGION_CODE` to operate on a region other than the default
Cheongsong code `47750`.

Set `VITE_DISABLE_REACT_DEVTOOLS=1` to disable the development-only
react-grab/react-scan instrumentation.

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
