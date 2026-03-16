#!/usr/bin/env bash
# ============================================================
# AdminPanel — Installation from scratch
# ============================================================
# Usage:
#   bash <(curl -fsSL https://raw.githubusercontent.com/Spakieone/AdminPanel/main/scripts/install.sh)
# or:
#   bash scripts/install.sh
#
# Environment variables:
#   INSTALL_DIR       — installation path (default: /root/adminpanel)
#   ADMINPANEL_GITHUB_REPO — GitHub repo in OWNER/REPO format
# ============================================================
set -euo pipefail

REPO="${ADMINPANEL_GITHUB_REPO:-}"
INSTALL_DIR="${INSTALL_DIR:-/root/adminpanel}"

G='\033[0;32m'; Y='\033[1;33m'; C='\033[0;36m'; R='\033[0;31m'; B='\033[1;34m'; N='\033[0m'
ok()   { echo -e "${G}[✓]${N} $*"; }
info() { echo -e "${C}[•]${N} $*"; }
warn() { echo -e "${Y}[!]${N} $*"; }
err()  { echo -e "${R}[✗]${N} $*"; exit 1; }
step() { echo -e "\n${B}━━ $*${N}"; }

# Check root
[[ "$EUID" -eq 0 ]] || err "Run as root: sudo bash install.sh"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   AdminPanel — Installation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── 1. Detect OS ────────────────────────────────────────
step "Detecting system"

OS=""
if [[ -f /etc/os-release ]]; then
  . /etc/os-release
  OS="${ID:-}"
fi

case "$OS" in
  ubuntu|debian) PKG_MANAGER="apt-get" ;;
  centos|rhel|fedora|rocky|almalinux) PKG_MANAGER="yum" ;;
  *) warn "Unknown OS: $OS — continuing with apt-get"; PKG_MANAGER="apt-get" ;;
esac

info "OS: ${PRETTY_NAME:-$OS}"
info "Install directory: $INSTALL_DIR"

# ── 1.1. Disk space check ──────────────────────────────
AVAIL_MB=$(df -m "$( dirname "$INSTALL_DIR" )" 2>/dev/null | awk 'NR==2{print $4}' || echo "0")
if [[ "$AVAIL_MB" -lt 2048 ]]; then
  warn "Low disk space: ${AVAIL_MB}MB available (recommended: 2GB+)"
  read -r -p "Continue anyway? [y/N]: " CONT_DISK
  [[ "${CONT_DISK:-}" =~ ^[Yy]$ ]] || err "Not enough disk space"
fi

# ── 2. Base packages ──────────────────────────────────
step "Installing base packages"

if [[ "$PKG_MANAGER" == "apt-get" ]]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq 2>/dev/null || true
  apt-get install -y -qq curl git ca-certificates gnupg lsb-release jq 2>/dev/null || {
    warn "Some packages may not have installed — continuing"
  }
else
  yum install -y -q curl git ca-certificates jq 2>/dev/null || {
    warn "Some packages may not have installed — continuing"
  }
fi
ok "Base packages ready"

# ── 3. Docker ──────────────────────────────────────────
step "Checking Docker"

if command -v docker >/dev/null 2>&1; then
  DOCKER_VER="$(docker --version | grep -oP '\d+\.\d+\.\d+' || echo 'unknown')"
  ok "Docker already installed: $DOCKER_VER"
else
  info "Docker not found — installing..."

  if [[ "$PKG_MANAGER" == "apt-get" ]]; then
    install -m 0755 -d /etc/apt/keyrings 2>/dev/null || true
    curl -fsSL "https://download.docker.com/linux/${OS}/gpg" | gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null || {
      # Fallback: use convenience script
      warn "Could not add Docker GPG key — using get.docker.com"
      curl -fsSL https://get.docker.com | sh
    }
    if [[ ! -f /etc/apt/sources.list.d/docker.list ]] && command -v lsb_release >/dev/null 2>&1; then
      chmod a+r /etc/apt/keyrings/docker.gpg 2>/dev/null || true
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
        https://download.docker.com/linux/${OS} $(lsb_release -cs) stable" \
        > /etc/apt/sources.list.d/docker.list
      apt-get update -qq 2>/dev/null || true
      apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin 2>/dev/null || {
        warn "apt install failed — trying get.docker.com"
        curl -fsSL https://get.docker.com | sh
      }
    fi
  else
    curl -fsSL https://get.docker.com | sh
  fi

  systemctl enable docker --now 2>/dev/null || true
  ok "Docker installed"
fi

# Check docker compose (plugin)
if docker compose version >/dev/null 2>&1; then
  ok "Docker Compose: $(docker compose version --short 2>/dev/null || echo 'ok')"
else
  info "Installing docker-compose-plugin..."
  if [[ "$PKG_MANAGER" == "apt-get" ]]; then
    apt-get install -y -qq docker-compose-plugin 2>/dev/null || true
  else
    yum install -y -q docker-compose-plugin 2>/dev/null || true
  fi

  if ! docker compose version >/dev/null 2>&1; then
    err "Docker Compose plugin not available. Update Docker or install manually."
  fi
  ok "Docker Compose installed"
fi

# ── 4. Clone repository ──────────────────────────────
step "Downloading AdminPanel"

if [[ -z "$REPO" ]]; then
  echo ""
  echo "Enter GitHub repository (format: OWNER/REPO):"
  read -r -p "Repository: " REPO
  REPO="$(echo "${REPO:-}" | xargs)"
  [[ -z "$REPO" ]] && err "Repository not specified"
fi

REPO_URL="https://github.com/${REPO}.git"

if [[ -d "$INSTALL_DIR/.git" ]]; then
  warn "Directory $INSTALL_DIR already exists (git repository)"
  read -r -p "Update existing installation? [y/N]: " UPDATE_EXISTING
  if [[ "${UPDATE_EXISTING:-}" =~ ^[Yy]$ ]]; then
    git -C "$INSTALL_DIR" fetch origin 2>/dev/null || true
    git -C "$INSTALL_DIR" reset --hard origin/main 2>/dev/null || true
    ok "Code updated to latest version"
  else
    info "Using existing code"
  fi
elif [[ -d "$INSTALL_DIR" ]]; then
  warn "Directory $INSTALL_DIR exists but is not a git repository"
  read -r -p "Remove and reinstall? [y/N]: " REINSTALL
  [[ "${REINSTALL:-}" =~ ^[Yy]$ ]] || err "Cancelled. Set another directory: INSTALL_DIR=/other/path bash install.sh"
  rm -rf "$INSTALL_DIR"
  git clone "$REPO_URL" "$INSTALL_DIR"
  ok "Repository cloned"
else
  git clone "$REPO_URL" "$INSTALL_DIR"
  ok "Repository cloned to $INSTALL_DIR"
fi

cd "$INSTALL_DIR"
VERSION="$(cat VERSION 2>/dev/null | head -1 | tr -d '\r' || echo 'unknown')"
info "Version: $VERSION"

# ── 5. Configuration ──────────────────────────────────
step "Setting up configuration"

# .env file
if [[ ! -f "$INSTALL_DIR/.env" ]]; then
  cat > "$INSTALL_DIR/.env" << ENV_EOF
HOST_PROJECT_DIR=${INSTALL_DIR}
ENV_EOF
  info ".env created"
else
  ok ".env already exists"
fi

# Create data directory
mkdir -p "$INSTALL_DIR/data"
ok "Data directory ready"

# ── 6. Build and start ────────────────────────────────
step "Building Docker image"

cd "$INSTALL_DIR"

# Update HOST_PROJECT_DIR in .env
if grep -q "HOST_PROJECT_DIR" "$INSTALL_DIR/.env"; then
  sed -i "s|HOST_PROJECT_DIR=.*|HOST_PROJECT_DIR=${INSTALL_DIR}|" "$INSTALL_DIR/.env"
else
  echo "HOST_PROJECT_DIR=${INSTALL_DIR}" >> "$INSTALL_DIR/.env"
fi

info "Building image (this may take a few minutes)..."
docker compose -f docker-compose.yml build || err "Docker build failed. Check Dockerfile and logs."

ok "Image built"

step "Starting container"

docker compose -f docker-compose.yml up -d || err "Failed to start container"
ok "Container started"

# ── 7. Health check ──────────────────────────────────
step "Checking health"

info "Waiting for startup..."
for i in $(seq 1 15); do
  sleep 2
  HTTP_CODE="$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8888/api/health 2>/dev/null || echo '000')"
  if [[ "$HTTP_CODE" == "200" ]]; then
    ok "AdminPanel is running (HTTP 200)"
    break
  fi
  if [[ "$i" -eq 15 ]]; then
    warn "Panel did not respond in 30 seconds — check logs: docker logs adminpanel"
  fi
done

# ── 8. Get initial credentials ────────────────────────
INIT_PASSWORD=""
for i in $(seq 1 10); do
  INIT_PASSWORD="$(docker logs adminpanel 2>&1 | grep -oP 'Password: \K\S+' || true)"
  if [[ -n "$INIT_PASSWORD" ]]; then
    break
  fi
  sleep 1
done

# ── 9. Summary ────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${G}  AdminPanel $VERSION installed successfully!${N}"
echo ""
echo "  Directory: $INSTALL_DIR"
echo "  Port:      8888 (localhost only)"
echo ""
if [[ -n "$INIT_PASSWORD" ]]; then
  echo -e "  ${Y}First login credentials:${N}"
  echo "  Login:    admin"
  echo -e "  Password: ${G}${INIT_PASSWORD}${N}"
  echo -e "  ${R}Change password after first login!${N}"
  echo ""
fi
echo "  Next steps:"
echo "  1. Set up Caddy/Nginx to proxy port 8888"
echo "  2. Log in and change password"
echo ""
echo "  Useful commands:"
echo "  • Logs:    docker logs -f adminpanel"
echo "  • Stop:    docker compose -f $INSTALL_DIR/docker-compose.yml down"
echo "  • Restart: docker compose -f $INSTALL_DIR/docker-compose.yml restart"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
