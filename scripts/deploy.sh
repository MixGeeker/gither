#!/bin/sh
# User-run, interactive setup. This never embeds or prints a default password/key.
set -eu
cd "$(dirname "$0")/.."
if ! command -v docker >/dev/null 2>&1; then echo 'Docker Engine with Compose is required. Install it from the official Docker documentation.' >&2; exit 1; fi
docker compose version >/dev/null
case "${1:-}" in
 '') compose() { docker compose -f compose.yaml "$@"; } ;;
 --https) compose() { docker compose -f compose.yaml -f compose.https.yaml "$@"; } ;;
 *) echo 'Usage: ./scripts/deploy.sh [--https]' >&2; exit 2 ;;
esac
compose config --quiet
compose build app
compose run --rm -it app setup --if-needed
compose up -d
echo 'Gither started. Sign in with the owner account you created. API/MCP keys are created separately in account settings.'
