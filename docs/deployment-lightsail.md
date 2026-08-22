# Lightsail production deployment

This deployment serves three public HTTPS origins from one Ubuntu Lightsail
instance:

| Origin | Service | Public access |
| --- | --- | --- |
| `https://salgil.gyeongbuk.kr` | Operations dashboard | HTTP Basic authentication required |
| `https://mobile.salgil.gyeongbuk.kr` | Mobile PWA | Public |
| `https://map.salgil.gyeongbuk.kr` | WebGPU map and TMAP tile proxy | Public, embeddable only by SALGIL origins |

Caddy is the only container with host ports. The three nginx frontend
containers are reachable only on the private Compose network. The already
deployed backend remains external to this stack; Caddy forwards the allowed API
requests to its HTTPS origin. Caddy obtains and renews certificates
automatically after DNS points to the instance.

## 1. Prepare Lightsail and DNS

1. Create an Ubuntu Lightsail instance and attach a static IP.
2. Allow TCP 80 and TCP/UDP 443 in the Lightsail firewall. Restrict SSH to the
   administrator's IP whenever possible.
3. Create A records for `salgil`, `mobile.salgil`, and `map.salgil` under
   `gyeongbuk.kr`, all pointing to the static IP.
4. Install Docker Engine with the Compose plugin, then clone this repository.

Do not continue until all three names resolve to the static IP. Certificate
issuance will fail if DNS still points elsewhere or ports 80/443 are blocked.

## 2. Create production secrets

```bash
cp .env.production.example .env.production
chmod 600 .env.production
./scripts/hash-dashboard-password.sh
```

Paste the generated `DASHBOARD_PASSWORD_HASH='...'` line into
`.env.production`. Keep its single quotes so Compose and shell tooling preserve
the bcrypt `$` characters.

Fill the remaining values. `SALGIL_PLATFORM_API_URL` must be the existing
backend's HTTPS origin without `/api/v1`; this Compose project does not build or
run a backend. The backend must issue two different credentials:

- `SALGIL_OPERATOR_API_KEY`: operator access used only behind the authenticated dashboard.
- `SALGIL_MOBILE_API_KEY`: a limited mobile credential allowed to list/stream incidents and request evacuation routes, but not create or administer incidents.

Never reuse the operator key for the public mobile origin. Browser-safe `VITE_*`
settings are baked into frontend assets; API keys are injected only by Caddy and
must not use the `VITE_` prefix.

## 3. Deploy

```bash
./scripts/deploy-lightsail.sh
```

The script fails closed when a required value is missing, the API URL is not
HTTPS, both audiences share a credential, the dashboard hash is invalid, or
`.env.production` is not mode 600. It validates Compose and Caddy, builds
SHA-tagged images, starts the stack, and prints container health.

## 4. Verify the public surfaces

Run these from a machine outside Lightsail:

```bash
curl -I https://salgil.gyeongbuk.kr
curl -u 'operator:YOUR_PASSWORD' -I https://salgil.gyeongbuk.kr
curl -I https://mobile.salgil.gyeongbuk.kr
curl -I https://map.salgil.gyeongbuk.kr
curl -i -X POST https://mobile.salgil.gyeongbuk.kr/api/platform/incidents
```

Expected results are 401 for the first request, 200 for the next three, and 404
for the disallowed mobile API method. Then open the mobile PWA on a phone and
confirm that the route sheet, embedded map, and notification prompt load over
HTTPS. Open the dashboard and confirm that its mobile QR points to
`https://mobile.salgil.gyeongbuk.kr`.

## Operations and rollback

View container status and logs without printing the environment file:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml ps
docker compose --env-file .env.production -f docker-compose.production.yml logs --tail=200 gateway console mobile map
```

Before major upgrades, take a Lightsail snapshot. Images are tagged with the
Git commit used for deployment. To roll back while that image tag remains on
the instance:

```bash
DEPLOY_TAG=PREVIOUS_GIT_SHA docker compose --env-file .env.production -f docker-compose.production.yml up -d --no-build
```

Caddy certificate state is stored in the named `caddy_data` volume. Do not
delete that volume during routine deployments.

## Security invariants

| Invariant | Enforcement |
| --- | --- |
| No backend credential enters a browser bundle | Only browser-safe build args exist in `Dockerfile`; Caddy injects bearer headers at runtime |
| Dashboard and mobile use separate audiences | Distinct required variables in `docker-compose.production.yml`; deploy script rejects equal keys |
| Public mobile cannot call operator endpoints | Exact method/path allowlist in `deploy/Caddyfile`; all other mobile platform paths return 404 |
| Missing secrets stop deployment | Required Compose interpolation and `scripts/deploy-lightsail.sh` validation |
| Frontends are not directly exposed | Only the gateway publishes host ports |
