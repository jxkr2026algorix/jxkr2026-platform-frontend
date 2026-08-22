#!/usr/bin/env bash

set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="$repo_dir/.env.production"
compose_file="$repo_dir/docker-compose.production.yml"

if [[ ! -f "$env_file" ]]; then
  printf 'Missing %s. Copy .env.production.example and fill every value.\n' "$env_file" >&2
  exit 1
fi

read_env() {
  local key="$1"
  awk -v key="$key" '
    index($0, key "=") == 1 {
      value = substr($0, length(key) + 2)
      if (value ~ /^\047.*\047$/ || value ~ /^".*"$/) {
        value = substr(value, 2, length(value) - 2)
      }
      print value
      exit
    }
  ' "$env_file"
}

require_value() {
  local key="$1"
  local value
  value="$(read_env "$key")"
  if [[ -z "$value" || "$value" == *replace_* || "$value" == *example.com* ]]; then
    printf 'Set a real value for %s in .env.production.\n' "$key" >&2
    exit 1
  fi
}

for key in ACME_EMAIL DASHBOARD_PASSWORD_HASH SALGIL_PLATFORM_API_URL SALGIL_OPERATOR_API_KEY SALGIL_MOBILE_API_KEY; do
  require_value "$key"
done

platform_url="$(read_env SALGIL_PLATFORM_API_URL)"
operator_key="$(read_env SALGIL_OPERATOR_API_KEY)"
mobile_key="$(read_env SALGIL_MOBILE_API_KEY)"
password_hash="$(read_env DASHBOARD_PASSWORD_HASH)"

if [[ "$platform_url" != https://* ]]; then
  printf 'SALGIL_PLATFORM_API_URL must use HTTPS.\n' >&2
  exit 1
fi
if [[ "$operator_key" == "$mobile_key" ]]; then
  printf 'Operator and mobile API keys must be different credentials.\n' >&2
  exit 1
fi
if [[ "$password_hash" != \$2* ]]; then
  printf 'DASHBOARD_PASSWORD_HASH must be a bcrypt hash from hash-dashboard-password.sh.\n' >&2
  exit 1
fi

unset platform_url operator_key mobile_key password_hash

env_mode="$(stat -c '%a' "$env_file" 2>/dev/null || stat -f '%Lp' "$env_file")"
if [[ "$env_mode" != "600" ]]; then
  printf 'Refusing to deploy: run chmod 600 .env.production first (current mode: %s).\n' "$env_mode" >&2
  exit 1
fi

export DEPLOY_TAG="${DEPLOY_TAG:-$(git -C "$repo_dir" rev-parse --short=12 HEAD)}"

docker compose --env-file "$env_file" -f "$compose_file" config --quiet
docker compose --env-file "$env_file" -f "$compose_file" run --rm --no-deps gateway caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose --env-file "$env_file" -f "$compose_file" build --pull
docker compose --env-file "$env_file" -f "$compose_file" up -d --remove-orphans
docker compose --env-file "$env_file" -f "$compose_file" ps
