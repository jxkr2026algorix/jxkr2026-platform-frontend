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

cp .env.local.example .env.local   # then fill in the keys
yarn doctor                        # check the setup before wondering why nothing arrives
yarn dev                           # console 5173 · mobile 5176 · map 5183
```

`.env.local` chooses the backend and holds the keys. All three apps read the
same file, because started separately with separate settings they drift: the
console ends up talking to one backend and the phone to another, and the two
screens disagree about what is happening.

```bash
SALGIL_PLATFORM_API_URL=https://api.salgil.gyeongbuk.kr
SALGIL_OPERATOR_API_KEY=…   # the console declares incidents
SALGIL_MOBILE_API_KEY=…     # the phone only reads
```

The two keys are separate on purpose. The phone is the audience view reached by
QR; a screen anyone can open must not carry a key that can declare an incident.
Against a local backend both fall back to the development key the backend ships,
so no configuration is needed to run against your own.

`yarn dev --remote` and `yarn dev --local` override the file for one run.
Nothing here reaches the browser — the dev server proxies with the key so it
never leaves the machine.

**Every platform call is 401 without a key**, including the situation stream, so
a missing key looks like a backend outage rather than a credentials problem.
`yarn doctor` names it, along with a chatbot or push service that is reachable
but switched off at the backend.

`yarn lint`, `yarn typecheck`, `yarn build` cover every workspace.

## Platform incident contract

The frontend consumes the platform backend's real `/api/v1/incidents`
contract. Console and mobile poll open incidents for region `47750` every two
seconds. A new backend incident updates both clients. The mobile client renders
its assigned shelter, route, risk zones, and incident origin over the WebGPU
map; trigger-capable hazards also start at the backend-provided origin.

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

## Dashboard language

The operations dashboard supports Korean and English. It starts in English
unless the operator has previously selected and saved another language.
The language switch updates the interface, page metadata, and the SALGIL logo;
the Gyeongsangbuk-do collaborator logo stays beside it in the top-left header.

The left and right dashboard rails start in dark graphite mode while the map
keeps its original appearance. The appearance button in the district rail
switches only those dashboard rails between dark and light, and the selected
rail theme is saved in the browser.

Dashboard brand assets live in `apps/console-front/public/brand/`. Keep the
Korean and English SALGIL SVGs aligned to the same visual height when replacing
them so the collaboration lockup does not shift between languages.

## Deployment

For the three production domains on one Lightsail instance, follow
[docs/deployment-lightsail.md](docs/deployment-lightsail.md). That stack adds
automatic HTTPS, dashboard authentication, audience-separated API credentials,
the production TMAP proxy, and rollback-friendly image tags.

For local container testing:

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

The console and mobile clients load the map by URL from the browser, so
`VITE_MAP_URL` (default `http://localhost:8082`) must be reachable by the
client and is baked in at build time:

```bash
VITE_MAP_URL=https://map.example.com docker compose build console mobile
```

WebGPU needs a secure context — serve the map over HTTPS outside localhost.
