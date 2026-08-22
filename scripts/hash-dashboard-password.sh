#!/usr/bin/env bash

set -euo pipefail

read -r -s -p "Dashboard password (14+ characters): " password
printf '\n'
if (( ${#password} < 14 )); then
  printf 'Password must contain at least 14 characters.\n' >&2
  exit 1
fi

read -r -s -p "Confirm dashboard password: " confirmation
printf '\n'
if [[ "$password" != "$confirmation" ]]; then
  printf 'Passwords do not match.\n' >&2
  exit 1
fi

hash="$({ printf '%s' "$password"; } | docker run --rm -i caddy:2.11.4-alpine caddy hash-password --algorithm bcrypt)"
unset password confirmation

printf "DASHBOARD_PASSWORD_HASH='%s'\n" "$hash"
