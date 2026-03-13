#!/usr/bin/env bash
# ============================================
# AdminPanel — Docker Installation Script
# ============================================
# Sets up GHCR auth, Caddy reverse-proxy with HTTPS, and starts the panel.
#
# Usage:
#   bash scripts/install-docker.sh
#   bash scripts/install-docker.sh --skip-caddy   # skip Caddy setup
#   bash scripts/install-docker.sh --domain web.example.com --lk-domain lk.example.com
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

COMPOSE_FILE="$ROOT_DIR/docker-compose.ghcr.yml"
ENV_FILE="$ROOT_DIR/.env"

SKIP_CADDY=false
WEB_DOMAIN=""
LK_DOMAIN=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-caddy)    SKIP_CADDY=true; shift ;;
    --domain)        WEB_DOMAIN="${2:?missing domain}"; shift 2 ;;
    --lk-domain)     LK_DOMAIN="${2:?missing lk-domain}"; shift 2 ;;
    -h|--help)
      echo "Usage: bash scripts/install-docker.sh [--skip-caddy] [--domain web.example.com] [--lk-domain lk.example.com]"
      exit 0
      ;;
    *) shift ;;
  esac
done

echo "========================================"
echo "  AdminPanel — Docker Installation"
echo "========================================"
echo ""

# --- 1. Check Docker ---
if ! command -v docker &>/dev/null; then
  echo "[install] Docker not found. Installing..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
  echo "[install] Docker installed."
fi

if ! docker compose version &>/dev/null 2>&1; then
  echo "[ERROR] 'docker compose' plugin not available. Update Docker."
  exit 1
fi

echo "[install] Docker: $(docker --version)"

# --- 2. Ensure data directory ---
mkdir -p "$ROOT_DIR/data"
mkdir -p "$ROOT_DIR/data/uploads"

# Migrate data if coming from bare-metal install
if [ -f "$ROOT_DIR/bot_profiles.json" ] && [ ! -f "$ROOT_DIR/data/bot_profiles.json" ]; then
  echo "[install] Migrating data files to ./data/..."
  bash "$SCRIPT_DIR/migrate-data-to-docker.sh"
fi

# --- 3. GHCR Authentication ---
echo ""
echo "[install] Setting up GHCR (GitHub Container Registry)..."
echo "  You need a GitHub Personal Access Token with 'read:packages' scope."
echo "  Create: https://github.com/settings/tokens/new?scopes=read:packages"
echo ""

GHCR_OWNER="spakieone"
GHCR_TOKEN=""

# Load existing token
if [ -f "$ENV_FILE" ]; then
  while IFS='=' read -r key val; do
    case "$key" in
      GHCR_TOKEN) GHCR_TOKEN="$val" ;;
      GHCR_OWNER) GHCR_OWNER="$val" ;;
    esac
  done < "$ENV_FILE"
fi

if [ -n "$GHCR_TOKEN" ]; then
  echo "[install] Found existing GHCR token in .env"
  read -rp "  Use existing token? [Y/n]: " use_existing
  if [[ "${use_existing,,}" == "n" ]]; then
    GHCR_TOKEN=""
  fi
fi

if [ -z "$GHCR_TOKEN" ]; then
  read -rsp "  Enter GitHub PAT: " GHCR_TOKEN
  echo ""
fi

if [ -z "$GHCR_TOKEN" ]; then
  echo "[ERROR] Token is required."
  exit 1
fi

# Save to .env
cat > "$ENV_FILE" <<EOF
GHCR_TOKEN=${GHCR_TOKEN}
GHCR_OWNER=${GHCR_OWNER}
HOST_PROJECT_DIR=${ROOT_DIR}
EOF
chmod 600 "$ENV_FILE"

# Login
echo "[install] Logging in to GHCR..."
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_OWNER" --password-stdin
echo "[install] GHCR login OK."

# --- 4. Pull and start ---
echo ""
echo "[install] Pulling latest image..."
docker compose -f "$COMPOSE_FILE" pull

echo "[install] Starting AdminPanel..."
docker compose -f "$COMPOSE_FILE" up -d

echo "[install] Waiting for startup..."
sleep 3

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8888/ 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "307" ] || [ "$HTTP_CODE" = "200" ]; then
  echo "[install] AdminPanel is running (HTTP $HTTP_CODE)."
else
  echo "[install] WARNING: AdminPanel returned HTTP $HTTP_CODE."
  echo "  Check logs: docker compose -f $COMPOSE_FILE logs"
fi

# --- 5. Caddy reverse proxy ---
if [ "$SKIP_CADDY" = true ]; then
  echo ""
  echo "[install] Skipping Caddy setup (--skip-caddy)."
else
  echo ""
  echo "[install] Setting up Caddy reverse proxy..."

  if [ -z "$WEB_DOMAIN" ]; then
    read -rp "  Web panel domain (e.g. web.example.com): " WEB_DOMAIN
  fi
  if [ -z "$LK_DOMAIN" ]; then
    read -rp "  LK domain (e.g. lk.example.com, leave empty to skip): " LK_DOMAIN
  fi

  if [ -z "$WEB_DOMAIN" ]; then
    echo "[install] No domain provided, skipping Caddy."
  else
    # Install Caddy if not present
    if ! command -v caddy &>/dev/null; then
      echo "[install] Installing Caddy..."
      apt-get update -qq
      apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
      apt-get update -qq
      apt-get install -y -qq caddy
      echo "[install] Caddy installed."
    fi

    # Generate Caddyfile
    CADDYFILE="/etc/caddy/Caddyfile"
    echo "[install] Writing $CADDYFILE..."

    cat > "$CADDYFILE" <<CADDYEOF
# AdminPanel — auto-generated Caddyfile

${WEB_DOMAIN} {
	reverse_proxy localhost:8888
}
CADDYEOF

    if [ -n "$LK_DOMAIN" ]; then
      cat >> "$CADDYFILE" <<CADDYEOF

${LK_DOMAIN} {
	reverse_proxy localhost:8888
}
CADDYEOF
    fi

    # Validate and reload
    caddy validate --config "$CADDYFILE" --adapter caddyfile
    systemctl enable --now caddy
    systemctl reload caddy
    echo "[install] Caddy is running."
    echo "  Web panel: https://${WEB_DOMAIN}"
    [ -n "$LK_DOMAIN" ] && echo "  LK: https://${LK_DOMAIN}"
  fi
fi

echo ""
echo "========================================"
echo "  Installation complete!"
echo "========================================"
echo ""
echo "  Admin panel: http://localhost:8888/webpanel/"
[ -n "${WEB_DOMAIN:-}" ] && echo "  Web: https://${WEB_DOMAIN}/webpanel/"
[ -n "${LK_DOMAIN:-}" ] && echo "  LK:  https://${LK_DOMAIN}/"
echo ""
echo "  Update from panel UI: Settings → Updates → 'Обновить из GitHub'"
echo "  Update from CLI:      bash scripts/update-docker.sh"
echo ""
