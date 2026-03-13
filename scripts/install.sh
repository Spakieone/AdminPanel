#!/usr/bin/env bash
# ============================================================
# AdminPanel — Установка с нуля
# ============================================================
# Использование:
#   bash <(curl -fsSL https://raw.githubusercontent.com/Spakieone/AdminPanel/main/scripts/install.sh)
# или:
#   bash scripts/install.sh
# ============================================================
set -euo pipefail

REPO="Spakieone/AdminPanel"
REPO_URL="https://github.com/${REPO}.git"
INSTALL_DIR="${INSTALL_DIR:-/root/adminpanel}"

G='\033[0;32m'; Y='\033[1;33m'; C='\033[0;36m'; R='\033[0;31m'; B='\033[1;34m'; N='\033[0m'
ok()   { echo -e "${G}[✓]${N} $*"; }
info() { echo -e "${C}[•]${N} $*"; }
warn() { echo -e "${Y}[!]${N} $*"; }
err()  { echo -e "${R}[✗]${N} $*"; exit 1; }
step() { echo -e "\n${B}━━ $*${N}"; }

# Проверка root
[[ "$EUID" -eq 0 ]] || err "Запусти от root: sudo bash install.sh"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   AdminPanel — Установка"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── 1. Определяем ОС ─────────────────────────────────────
step "Определение системы"

OS=""
if [[ -f /etc/os-release ]]; then
  . /etc/os-release
  OS="${ID:-}"
fi

case "$OS" in
  ubuntu|debian) PKG_MANAGER="apt-get" ;;
  centos|rhel|fedora|rocky|almalinux) PKG_MANAGER="yum" ;;
  *) warn "Неизвестная ОС: $OS — продолжаем, но могут быть проблемы"; PKG_MANAGER="apt-get" ;;
esac

info "ОС: ${PRETTY_NAME:-$OS}"
info "Директория установки: $INSTALL_DIR"

# ── 2. Базовые пакеты ────────────────────────────────────
step "Установка базовых пакетов"

if [[ "$PKG_MANAGER" == "apt-get" ]]; then
  apt-get update -qq
  apt-get install -y -qq curl git ca-certificates gnupg lsb-release
else
  yum install -y -q curl git ca-certificates
fi
ok "Базовые пакеты установлены"

# ── 3. Docker ────────────────────────────────────────────
step "Проверка Docker"

if command -v docker >/dev/null 2>&1; then
  DOCKER_VER="$(docker --version | grep -oP '\d+\.\d+\.\d+')"
  ok "Docker уже установлен: $DOCKER_VER"
else
  info "Docker не найден — устанавливаю..."

  if [[ "$PKG_MANAGER" == "apt-get" ]]; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/${OS}/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
      https://download.docker.com/linux/${OS} $(lsb_release -cs) stable" \
      > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
  else
    curl -fsSL https://get.docker.com | sh
  fi

  systemctl enable docker --now
  ok "Docker установлен"
fi

# Проверяем docker compose (plugin)
if docker compose version >/dev/null 2>&1; then
  ok "Docker Compose: $(docker compose version --short)"
else
  info "Устанавливаю docker-compose-plugin..."
  if [[ "$PKG_MANAGER" == "apt-get" ]]; then
    apt-get install -y -qq docker-compose-plugin
  else
    yum install -y -q docker-compose-plugin
  fi
  ok "Docker Compose установлен"
fi

# ── 4. Клонирование репозитория ──────────────────────────
step "Загрузка AdminPanel"

if [[ -d "$INSTALL_DIR/.git" ]]; then
  warn "Директория $INSTALL_DIR уже существует (git репозиторий)"
  read -r -p "Обновить существующую установку? [y/N]: " UPDATE_EXISTING
  if [[ "${UPDATE_EXISTING:-}" =~ ^[Yy]$ ]]; then
    git -C "$INSTALL_DIR" fetch origin
    git -C "$INSTALL_DIR" reset --hard origin/main
    ok "Код обновлён до последней версии"
  else
    info "Используем существующий код"
  fi
elif [[ -d "$INSTALL_DIR" ]]; then
  warn "Директория $INSTALL_DIR существует но не является git репозиторием"
  read -r -p "Удалить и переустановить? [y/N]: " REINSTALL
  [[ "${REINSTALL:-}" =~ ^[Yy]$ ]] || err "Прервано. Укажи другую директорию: INSTALL_DIR=/другой/путь bash install.sh"
  rm -rf "$INSTALL_DIR"
  git clone "$REPO_URL" "$INSTALL_DIR"
  ok "Репозиторий клонирован"
else
  git clone "$REPO_URL" "$INSTALL_DIR"
  ok "Репозиторий клонирован в $INSTALL_DIR"
fi

cd "$INSTALL_DIR"
VERSION="$(cat VERSION 2>/dev/null | head -1 | tr -d '\r' || echo 'unknown')"
info "Версия: $VERSION"

# ── 5. Конфигурация ──────────────────────────────────────
step "Настройка конфигурации"

# .env файл
if [[ ! -f "$INSTALL_DIR/.env" ]]; then
  if [[ -f "$INSTALL_DIR/.env.example" ]]; then
    cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
    info ".env создан из .env.example"
  else
    # Создаём минимальный .env
    cat > "$INSTALL_DIR/.env" << 'ENV_EOF'
HOST_PROJECT_DIR=/root/adminpanel
ENV_EOF
    info ".env создан"
  fi
else
  ok ".env уже существует"
fi

# Создаём директорию data если нет
mkdir -p "$INSTALL_DIR/data"
ok "Директория data готова"

# ── 6. Сборка и запуск ───────────────────────────────────
step "Сборка Docker образа"

cd "$INSTALL_DIR"

# Обновляем HOST_PROJECT_DIR в .env
if grep -q "HOST_PROJECT_DIR" "$INSTALL_DIR/.env"; then
  sed -i "s|HOST_PROJECT_DIR=.*|HOST_PROJECT_DIR=${INSTALL_DIR}|" "$INSTALL_DIR/.env"
else
  echo "HOST_PROJECT_DIR=${INSTALL_DIR}" >> "$INSTALL_DIR/.env"
fi

info "Собираем образ (это займёт несколько минут)..."
docker compose -f docker-compose.yml build

ok "Образ собран"

step "Запуск контейнера"

docker compose -f docker-compose.yml up -d
ok "Контейнер запущен"

# ── 7. Проверка ──────────────────────────────────────────
step "Проверка работоспособности"

info "Ждём запуска..."
for i in $(seq 1 15); do
  sleep 2
  HTTP_CODE="$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8888/api/health 2>/dev/null || echo '000')"
  if [[ "$HTTP_CODE" == "200" ]]; then
    ok "AdminPanel запущен и отвечает (HTTP 200)"
    break
  fi
  if [[ "$i" -eq 15 ]]; then
    warn "Панель не ответила за 30 секунд — проверь логи: docker logs adminpanel"
  fi
done

# ── 8. Итог ──────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${G}  AdminPanel $VERSION успешно установлен!${N}"
echo ""
echo "  Директория: $INSTALL_DIR"
echo "  Порт:       8888 (только localhost)"
echo ""
echo "  Следующие шаги:"
echo "  1. Настрой Caddy/Nginx для проксирования на порт 8888"
echo "  2. Открой панель и создай первого пользователя"
echo ""
echo "  Полезные команды:"
echo "  • Логи:    docker logs -f adminpanel"
echo "  • Стоп:    docker compose -f $INSTALL_DIR/docker-compose.yml down"
echo "  • Рестарт: docker compose -f $INSTALL_DIR/docker-compose.yml restart"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
