#!/usr/bin/env bash
# ============================================
# AdminPanel — Docker update script
# ============================================
# Pulls latest image from GHCR and restarts container.
# Can be called from CLI or from the panel's "Updates" page.
#
# Usage:
#   bash scripts/update-docker.sh              # uses docker-compose.ghcr.yml
#   bash scripts/update-docker.sh --local      # rebuild from local source (docker-compose.yml)
#   bash scripts/update-docker.sh --log FILE   # append output to log file
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

MODE="ghcr"
LOG_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --local)  MODE="local"; shift ;;
    --log)    LOG_FILE="${2:?missing log file}"; shift 2 ;;
    *)        shift ;;
  esac
done

log() {
  local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
  echo "$msg"
  if [ -n "$LOG_FILE" ]; then
    echo "$msg" >> "$LOG_FILE"
  fi
}

if [ "$MODE" = "local" ]; then
  COMPOSE_FILE="docker-compose.yml"
  log "[update] Mode: local build"
  log "[update] Building image from source..."
  docker compose -f "$COMPOSE_FILE" build --no-cache
else
  COMPOSE_FILE="docker-compose.ghcr.yml"
  log "[update] Mode: GHCR pull"

  # Re-login to GHCR if .env has token
  ENV_FILE="$ROOT_DIR/.env"
  if [ -f "$ENV_FILE" ]; then
    source "$ENV_FILE"
    if [ -n "${GHCR_TOKEN:-}" ]; then
      log "[update] Logging in to GHCR..."
      echo "$GHCR_TOKEN" | docker login ghcr.io -u "${GHCR_OWNER:-spakieone}" --password-stdin 2>/dev/null
    fi
  fi

  log "[update] Pulling latest image..."
  docker compose -f "$COMPOSE_FILE" pull
fi

log "[update] Stopping old container..."
docker compose -f "$COMPOSE_FILE" down --timeout 10

log "[update] Starting new container..."
docker compose -f "$COMPOSE_FILE" up -d

log "[update] Waiting for healthcheck..."
sleep 3

# Quick health check
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8888/ 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "307" ] || [ "$HTTP_CODE" = "200" ]; then
  log "[update] Panel is up (HTTP $HTTP_CODE). Update complete!"
else
  log "[update] WARNING: Panel returned HTTP $HTTP_CODE. Check logs with: docker compose -f $COMPOSE_FILE logs"
fi

# Cleanup old images
docker image prune -f 2>/dev/null | grep -v "Total" || true
log "[update] Done."
