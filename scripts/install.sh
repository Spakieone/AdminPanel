#!/usr/bin/env bash
# ============================================================
# AdminPanel — Установка
# ============================================================
# Использование:
#   bash <(curl -fsSL https://raw.githubusercontent.com/Spakieone/AdminPanel/main/scripts/install.sh)
# или:
#   bash scripts/install.sh
#
# Переменные окружения:
#   INSTALL_DIR       — путь установки (по умолчанию: /root/adminpanel)
#   ADMINPANEL_GITHUB_REPO — GitHub репозиторий в формате OWNER/REPO
# ============================================================
set -euo pipefail

REPO="${ADMINPANEL_GITHUB_REPO:-Spakieone/AdminPanel}"
INSTALL_DIR="${INSTALL_DIR:-/root/adminpanel}"

G='\033[0;32m'; Y='\033[1;33m'; C='\033[0;36m'; R='\033[0;31m'; B='\033[1;34m'; N='\033[0m'
ok()   { echo -e "${G}[✓]${N} $*"; }
info() { echo -e "${C}[•]${N} $*"; }
warn() { echo -e "${Y}[!]${N} $*"; }
err()  { echo -e "${R}[✗]${N} $*"; exit 1; }
step() { echo -e "\n${B}━━ $*${N}"; }

# Проверка root
[[ "$EUID" -eq 0 ]] || err "Запустите от root: sudo bash install.sh"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   AdminPanel — Установка"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── 1. Определение системы ────────────────────────────
step "Определение системы"

OS=""
if [[ -f /etc/os-release ]]; then
  . /etc/os-release
  OS="${ID:-}"
fi

case "$OS" in
  ubuntu|debian) PKG_MANAGER="apt-get" ;;
  centos|rhel|fedora|rocky|almalinux) PKG_MANAGER="yum" ;;
  *) warn "Неизвестная ОС: $OS — продолжаю с apt-get"; PKG_MANAGER="apt-get" ;;
esac

info "ОС: ${PRETTY_NAME:-$OS}"
info "Директория установки: $INSTALL_DIR"

# ── 1.1. Проверка диска ──────────────────────────────
AVAIL_MB=$(df -m "$( dirname "$INSTALL_DIR" )" 2>/dev/null | awk 'NR==2{print $4}' || echo "0")
if [[ "$AVAIL_MB" -lt 2048 ]]; then
  warn "Мало места на диске: ${AVAIL_MB}МБ (рекомендуется: 2ГБ+)"
  read -r -p "Продолжить? [y/N]: " CONT_DISK
  [[ "${CONT_DISK:-}" =~ ^[Yy]$ ]] || err "Недостаточно места на диске"
fi

# ── 1.2. Проверка swap (для сборки нужно ~1.5ГБ RAM) ─
TOTAL_RAM_MB=$(awk '/MemTotal/{printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo "0")
SWAP_MB=$(awk '/SwapTotal/{printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo "0")

if [[ "$TOTAL_RAM_MB" -lt 1536 && "$SWAP_MB" -lt 512 ]]; then
  step "Создание swap (обнаружено ${TOTAL_RAM_MB}МБ RAM)"
  if [[ ! -f /swapfile ]]; then
    fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null 2>&1
    swapon /swapfile 2>/dev/null
    if ! grep -q '/swapfile' /etc/fstab 2>/dev/null; then
      echo '/swapfile none swap sw 0 0' >> /etc/fstab
    fi
    ok "Swap 2ГБ создан"
  else
    swapon /swapfile 2>/dev/null || true
    ok "Swap уже существует"
  fi
fi

# ── 2. Базовые пакеты ────────────────────────────────
step "Установка базовых пакетов"

if [[ "$PKG_MANAGER" == "apt-get" ]]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq 2>/dev/null || true
  apt-get install -y -qq curl git ca-certificates gnupg lsb-release jq 2>/dev/null || {
    warn "Некоторые пакеты не установились — продолжаю"
  }
else
  yum install -y -q curl git ca-certificates jq 2>/dev/null || {
    warn "Некоторые пакеты не установились — продолжаю"
  }
fi
ok "Базовые пакеты готовы"

# ── 3. Docker ─────────────────────────────────────────
step "Проверка Docker"

if command -v docker >/dev/null 2>&1; then
  DOCKER_VER="$(docker --version | grep -oP '\d+\.\d+\.\d+' || echo 'unknown')"
  ok "Docker уже установлен: $DOCKER_VER"
else
  info "Docker не найден — устанавливаю..."

  if [[ "$PKG_MANAGER" == "apt-get" ]]; then
    install -m 0755 -d /etc/apt/keyrings 2>/dev/null || true
    curl -fsSL "https://download.docker.com/linux/${OS}/gpg" | gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null || {
      warn "Не удалось добавить GPG ключ Docker — использую get.docker.com"
      curl -fsSL https://get.docker.com | sh
    }
    if [[ ! -f /etc/apt/sources.list.d/docker.list ]] && command -v lsb_release >/dev/null 2>&1; then
      chmod a+r /etc/apt/keyrings/docker.gpg 2>/dev/null || true
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
        https://download.docker.com/linux/${OS} $(lsb_release -cs) stable" \
        > /etc/apt/sources.list.d/docker.list
      apt-get update -qq 2>/dev/null || true
      apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin 2>/dev/null || {
        warn "Установка через apt не удалась — пробую get.docker.com"
        curl -fsSL https://get.docker.com | sh
      }
    fi
  else
    curl -fsSL https://get.docker.com | sh
  fi

  systemctl enable docker --now 2>/dev/null || true
  ok "Docker установлен"
fi

# Проверка Docker Compose
if docker compose version >/dev/null 2>&1; then
  ok "Docker Compose: $(docker compose version --short 2>/dev/null || echo 'ok')"
else
  info "Устанавливаю docker-compose-plugin..."
  if [[ "$PKG_MANAGER" == "apt-get" ]]; then
    apt-get install -y -qq docker-compose-plugin 2>/dev/null || true
  else
    yum install -y -q docker-compose-plugin 2>/dev/null || true
  fi

  if ! docker compose version >/dev/null 2>&1; then
    err "Docker Compose не доступен. Обновите Docker или установите вручную."
  fi
  ok "Docker Compose установлен"
fi

# ── 4. Загрузка репозитория ──────────────────────────
step "Загрузка AdminPanel"

REPO_URL="https://github.com/${REPO}.git"

if [[ -d "$INSTALL_DIR/.git" ]]; then
  warn "Директория $INSTALL_DIR уже существует (git-репозиторий)"
  read -r -p "Обновить существующую установку? [y/N]: " UPDATE_EXISTING
  if [[ "${UPDATE_EXISTING:-}" =~ ^[Yy]$ ]]; then
    git -C "$INSTALL_DIR" fetch origin 2>/dev/null || true
    git -C "$INSTALL_DIR" reset --hard origin/main 2>/dev/null || true
    ok "Код обновлён до последней версии"
  else
    info "Используется существующий код"
  fi
elif [[ -d "$INSTALL_DIR" ]]; then
  warn "Директория $INSTALL_DIR существует, но не является git-репозиторием"
  read -r -p "Удалить и установить заново? [y/N]: " REINSTALL
  [[ "${REINSTALL:-}" =~ ^[Yy]$ ]] || err "Отменено. Укажите другую директорию: INSTALL_DIR=/другой/путь bash install.sh"
  rm -rf "$INSTALL_DIR"
  git clone "$REPO_URL" "$INSTALL_DIR"
  ok "Репозиторий склонирован"
else
  git clone "$REPO_URL" "$INSTALL_DIR"
  ok "Репозиторий склонирован в $INSTALL_DIR"
fi

cd "$INSTALL_DIR"
VERSION="$(cat VERSION 2>/dev/null | head -1 | tr -d '\r' || echo 'unknown')"
info "Версия: $VERSION"

# ── 5. Конфигурация ──────────────────────────────────
step "Настройка конфигурации"

# .env файл
if [[ ! -f "$INSTALL_DIR/.env" ]]; then
  JWT_SECRET="$(openssl rand -hex 64 2>/dev/null || head -c 128 /dev/urandom | od -A n -t x1 | tr -d ' \n')"
  cat > "$INSTALL_DIR/.env" << ENV_EOF
HOST_PROJECT_DIR=${INSTALL_DIR}
ADMINPANEL_JWT_SECRET=${JWT_SECRET}
ENV_EOF
  info ".env создан"
else
  ok ".env уже существует"
  # Добавить JWT_SECRET если отсутствует или пустой (обновление со старой версии)
  if ! grep -q "ADMINPANEL_JWT_SECRET" "$INSTALL_DIR/.env"; then
    JWT_SECRET="$(openssl rand -hex 64 2>/dev/null || head -c 128 /dev/urandom | od -A n -t x1 | tr -d ' \n')"
    echo "ADMINPANEL_JWT_SECRET=${JWT_SECRET}" >> "$INSTALL_DIR/.env"
    info "JWT секрет добавлен в .env"
  elif grep -qE "^ADMINPANEL_JWT_SECRET=\s*$" "$INSTALL_DIR/.env"; then
    JWT_SECRET="$(openssl rand -hex 64 2>/dev/null || head -c 128 /dev/urandom | od -A n -t x1 | tr -d ' \n')"
    sed -i "s|^ADMINPANEL_JWT_SECRET=.*|ADMINPANEL_JWT_SECRET=${JWT_SECRET}|" "$INSTALL_DIR/.env"
    info "JWT секрет был пустым — сгенерирован новый"
  fi
  # Добавить HOST_PROJECT_DIR если отсутствует
  if ! grep -q "HOST_PROJECT_DIR" "$INSTALL_DIR/.env"; then
    echo "HOST_PROJECT_DIR=${INSTALL_DIR}" >> "$INSTALL_DIR/.env"
    info "HOST_PROJECT_DIR добавлен в .env"
  fi
fi

# Создание директории данных
mkdir -p "$INSTALL_DIR/data"
ok "Директория данных готова"

# Запомним, есть ли уже учётные данные (для вывода пароля в конце)
CREDENTIALS_EXISTED="no"
[[ -f "$INSTALL_DIR/data/auth_credentials.json" ]] && CREDENTIALS_EXISTED="yes"

# ── 6. Сборка и запуск ───────────────────────────────
step "Сборка Docker-образа"

cd "$INSTALL_DIR"

# Обновить HOST_PROJECT_DIR в .env
if grep -q "HOST_PROJECT_DIR" "$INSTALL_DIR/.env"; then
  sed -i "s|HOST_PROJECT_DIR=.*|HOST_PROJECT_DIR=${INSTALL_DIR}|" "$INSTALL_DIR/.env"
else
  echo "HOST_PROJECT_DIR=${INSTALL_DIR}" >> "$INSTALL_DIR/.env"
fi

info "Сборка образа (может занять несколько минут)..."
docker compose -f docker-compose.yml build || err "Ошибка сборки Docker. Проверьте Dockerfile и логи."
ok "Образ собран"

# Скачиваем docker:cli для автообновлений (маленький образ ~30MB)
info "Подготовка образа для автообновлений..."
docker pull docker:cli >/dev/null 2>&1 || warn "Не удалось скачать docker:cli (автообновление может работать нестабильно)"

step "Запуск контейнера"

docker compose -f docker-compose.yml up -d || err "Не удалось запустить контейнер"
ok "Контейнер запущен"

# ── 7. Проверка работоспособности ────────────────────
step "Проверка работоспособности"

info "Ожидание запуска..."
for i in $(seq 1 15); do
  sleep 2
  HTTP_CODE="$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8888/api/health 2>/dev/null || echo '000')"
  if [[ "$HTTP_CODE" == "200" ]]; then
    ok "AdminPanel работает (HTTP 200)"
    break
  fi
  if [[ "$i" -eq 15 ]]; then
    warn "Панель не ответила за 30 секунд — проверьте логи: docker logs adminpanel"
  fi
done

# ── 8. Получение начальных данных для входа ──────────
INIT_PASSWORD=""
for i in $(seq 1 10); do
  INIT_PASSWORD="$(docker logs adminpanel 2>&1 | grep -oP 'Password: \K\S+' || true)"
  if [[ -n "$INIT_PASSWORD" ]]; then
    break
  fi
  sleep 1
done

# ── 9. Итог ──────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${G}  AdminPanel $VERSION успешно установлен!${N}"
echo ""
echo "  Директория: $INSTALL_DIR"
echo "  Порт: 8888"
echo ""
echo "  Для доступа по домену настройте reverse proxy (Caddy/Nginx)"
echo "  Пример Caddy:"
echo "    admin.example.com { reverse_proxy localhost:8888 }"
echo ""
if [[ -n "$INIT_PASSWORD" ]]; then
  echo -e "  ${Y}Данные для первого входа:${N}"
  echo "  Логин:  admin"
  echo -e "  Пароль: ${G}${INIT_PASSWORD}${N}"
  echo -e "  ${R}Смените пароль после первого входа!${N}"
  echo ""
elif [[ "$CREDENTIALS_EXISTED" == "yes" ]]; then
  echo -e "  ${C}Данные для входа сохранены от предыдущей установки.${N}"
  echo "  Если забыли пароль:"
  echo "    docker exec -it adminpanel python3 admin_cli.py password"
  echo ""
else
  echo -e "  ${Y}Данные для входа:${N}"
  echo "  Логин:  admin"
  echo "  Пароль можно найти в логах:"
  echo "    docker logs adminpanel 2>&1 | grep Password"
  echo ""
fi
echo "  Полезные команды:"
echo "  • Логи:        docker logs -f adminpanel"
echo "  • Остановка:   docker compose -f $INSTALL_DIR/docker-compose.yml down"
echo "  • Перезапуск:  docker compose -f $INSTALL_DIR/docker-compose.yml restart"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
