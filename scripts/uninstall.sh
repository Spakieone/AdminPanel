#!/usr/bin/env bash
# ============================================================
# AdminPanel — Uninstall
# ============================================================
# Usage:
#   bash <(curl -fsSL https://raw.githubusercontent.com/Spakieone/AdminPanel/main/scripts/uninstall.sh)
# or:
#   bash scripts/uninstall.sh
# ============================================================
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/root/adminpanel}"

G='\033[0;32m'; Y='\033[1;33m'; C='\033[0;36m'; R='\033[0;31m'; B='\033[1;34m'; N='\033[0m'
ok()   { echo -e "${G}[✓]${N} $*"; }
info() { echo -e "${C}[•]${N} $*"; }
warn() { echo -e "${Y}[!]${N} $*"; }
err()  { echo -e "${R}[✗]${N} $*"; exit 1; }
step() { echo -e "\n${B}━━ $*${N}"; }

[[ "$EUID" -eq 0 ]] || err "Run as root: sudo bash uninstall.sh"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "   ${R}AdminPanel — Удаление${N}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [[ ! -d "$INSTALL_DIR" ]]; then
  err "Директория $INSTALL_DIR не найдена"
fi

# ── 1. Backup ─────────────────────────────────────────
step "Бэкап данных"

if [[ -d "$INSTALL_DIR/data" ]]; then
  BACKUP_FILE="$HOME/adminpanel_backup_$(date +%Y%m%d_%H%M%S).tar.gz"
  read -r -p "  Сделать бэкап данных перед удалением? [Y/n]: " DO_BACKUP
  DO_BACKUP="${DO_BACKUP:-y}"
  if [[ "${DO_BACKUP}" =~ ^[Yy]$ ]]; then
    tar -czf "$BACKUP_FILE" -C "$INSTALL_DIR/data" . 2>/dev/null && {
      ok "Бэкап сохранён: $BACKUP_FILE"
    } || {
      warn "Не удалось создать бэкап"
    }
  else
    info "Бэкап пропущен"
  fi
else
  info "Данные не найдены"
fi

# ── 2. Stop container ─────────────────────────────────
step "Остановка контейнера"

if command -v docker >/dev/null 2>&1; then
  cd "$INSTALL_DIR" 2>/dev/null || true
  docker compose down --rmi local 2>/dev/null && {
    ok "Контейнер остановлен, образ удалён"
  } || {
    docker compose down 2>/dev/null || true
    info "Контейнер остановлен"
  }
else
  info "Docker не найден"
fi

# ── 3. Remove reverse proxy ──────────────────────────
step "Reverse proxy"

REMOVED_PROXY=""

# Caddy
if [[ -f /etc/caddy/Caddyfile ]] && grep -q "localhost:8888" /etc/caddy/Caddyfile 2>/dev/null; then
  read -r -p "  Удалить конфиг Caddy для AdminPanel? [Y/n]: " RM_CADDY
  RM_CADDY="${RM_CADDY:-y}"
  if [[ "${RM_CADDY}" =~ ^[Yy]$ ]]; then
    rm -f /etc/caddy/Caddyfile
    systemctl reload caddy 2>/dev/null || true
    ok "Caddy конфиг удалён"
    REMOVED_PROXY="caddy"
  fi
fi

# Nginx
if [[ -f /etc/nginx/sites-available/adminpanel ]] || [[ -f /etc/nginx/sites-enabled/adminpanel ]]; then
  read -r -p "  Удалить конфиг Nginx для AdminPanel? [Y/n]: " RM_NGINX
  RM_NGINX="${RM_NGINX:-y}"
  if [[ "${RM_NGINX}" =~ ^[Yy]$ ]]; then
    rm -f /etc/nginx/sites-enabled/adminpanel
    rm -f /etc/nginx/sites-available/adminpanel
    nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true
    ok "Nginx конфиг удалён"
    REMOVED_PROXY="nginx"
  fi
fi

[[ -z "$REMOVED_PROXY" ]] && info "Конфиг reverse proxy не найден"

# ── 4. Remove files ───────────────────────────────────
step "Удаление файлов"

echo ""
echo -e "  ${R}Будет удалено: $INSTALL_DIR${N}"
echo ""
read -r -p "  Продолжить? [y/N]: " CONFIRM_DELETE
if [[ "${CONFIRM_DELETE:-}" =~ ^[Yy]$ ]]; then
  cd "$HOME"
  rm -rf "$INSTALL_DIR"
  ok "Директория $INSTALL_DIR удалена"
else
  info "Файлы оставлены в $INSTALL_DIR"
fi

# ── 5. Summary ────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${G}  AdminPanel удалён${N}"
echo ""
if [[ -n "${BACKUP_FILE:-}" ]] && [[ -f "${BACKUP_FILE:-}" ]]; then
  echo -e "  Бэкап: ${C}${BACKUP_FILE}${N}"
  echo "  Восстановить при повторной установке:"
  echo "    tar -xzf $BACKUP_FILE -C /root/adminpanel/data/"
fi
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
