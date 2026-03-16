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
  cat > "$INSTALL_DIR/.env" << ENV_EOF
HOST_PROJECT_DIR=${INSTALL_DIR}
ENV_EOF
  info ".env создан"
else
  ok ".env уже существует"
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

# ── 9. Настройка reverse proxy ───────────────────────
step "Настройка reverse proxy"

echo ""
echo "  Панель слушает localhost:8888."
echo "  Для доступа по домену с SSL нужен reverse proxy."
echo ""
read -r -p "  Настроить reverse proxy? [Y/n]: " SETUP_PROXY
SETUP_PROXY="${SETUP_PROXY:-y}"

PANEL_DOMAIN=""
LK_DOMAIN=""

if [[ "${SETUP_PROXY}" =~ ^[Yy]$ ]]; then
  echo ""
  read -r -p "  Домен панели управления (например admin.example.com): " PANEL_DOMAIN
  PANEL_DOMAIN="$(echo "${PANEL_DOMAIN:-}" | xargs)"
  [[ -z "$PANEL_DOMAIN" ]] && { warn "Домен не указан — пропускаю настройку proxy"; SETUP_PROXY="n"; }
fi

if [[ "${SETUP_PROXY}" =~ ^[Yy]$ ]]; then
  read -r -p "  Домен личного кабинета (например lk.example.com, Enter — пропустить): " LK_DOMAIN
  LK_DOMAIN="$(echo "${LK_DOMAIN:-}" | xargs)"

  echo ""
  echo "  Какой reverse proxy использовать?"
  echo "  1) Caddy  (рекомендуется — автоматический SSL)"
  echo "  2) Nginx  (+ Certbot для SSL)"
  echo "  3) Пропустить"
  echo ""
  read -r -p "  Выбор [1/2/3]: " PROXY_CHOICE
  PROXY_CHOICE="${PROXY_CHOICE:-1}"

  case "$PROXY_CHOICE" in
    1)
      # ── Caddy ──
      info "Установка Caddy..."
      if ! command -v caddy >/dev/null 2>&1; then
        if [[ "$PKG_MANAGER" == "apt-get" ]]; then
          apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https 2>/dev/null || true
          curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' 2>/dev/null | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null || true
          curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' 2>/dev/null | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null 2>&1 || true
          apt-get update -qq 2>/dev/null || true
          apt-get install -y -qq caddy 2>/dev/null || {
            warn "Не удалось установить Caddy через apt — пробую бинарник"
            curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=$(dpkg --print-architecture)" -o /usr/bin/caddy 2>/dev/null && chmod +x /usr/bin/caddy || err "Не удалось установить Caddy"
          }
        else
          yum install -y -q caddy 2>/dev/null || {
            curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=amd64" -o /usr/bin/caddy 2>/dev/null && chmod +x /usr/bin/caddy || err "Не удалось установить Caddy"
          }
        fi
      fi
      ok "Caddy готов"

      # Генерация Caddyfile — добавление блоков (не перезаписывая существующие)
      CADDYFILE="/etc/caddy/Caddyfile"
      mkdir -p /etc/caddy
      [[ -f "$CADDYFILE" ]] || touch "$CADDYFILE"

      # Добавляем домен панели, если его ещё нет в конфиге
      if grep -q "${PANEL_DOMAIN}" "$CADDYFILE" 2>/dev/null; then
        warn "Домен ${PANEL_DOMAIN} уже есть в Caddyfile — пропускаю"
      else
        {
          echo ""
          echo "# AdminPanel"
          echo "${PANEL_DOMAIN} {"
          echo "    reverse_proxy localhost:8888"
          echo "}"
        } >> "$CADDYFILE"
        ok "Добавлен ${PANEL_DOMAIN} в Caddyfile"
      fi

      # Добавляем домен ЛК, если указан и его ещё нет
      if [[ -n "$LK_DOMAIN" ]]; then
        if grep -q "${LK_DOMAIN}" "$CADDYFILE" 2>/dev/null; then
          warn "Домен ${LK_DOMAIN} уже есть в Caddyfile — пропускаю"
        else
          {
            echo ""
            echo "# AdminPanel — Личный кабинет"
            echo "${LK_DOMAIN} {"
            echo "    reverse_proxy localhost:8888"
            echo "}"
          } >> "$CADDYFILE"
          ok "Добавлен ${LK_DOMAIN} в Caddyfile"
        fi
      fi

      systemctl enable caddy --now 2>/dev/null || caddy start 2>/dev/null || true
      systemctl reload caddy 2>/dev/null || caddy reload --config "$CADDYFILE" 2>/dev/null || true
      ok "Caddy настроен — SSL будет получен автоматически"
      ;;

    2)
      # ── Nginx ──
      info "Установка Nginx + Certbot..."
      if [[ "$PKG_MANAGER" == "apt-get" ]]; then
        apt-get install -y -qq nginx certbot python3-certbot-nginx 2>/dev/null || err "Не удалось установить Nginx"
      else
        yum install -y -q nginx certbot python3-certbot-nginx 2>/dev/null || err "Не удалось установить Nginx"
      fi
      ok "Nginx + Certbot установлены"

      NGINX_CONF="/etc/nginx/sites-available/adminpanel"
      mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled

      # Проверяем, нет ли уже конфига для этого домена
      if [[ -f "$NGINX_CONF" ]] && grep -q "${PANEL_DOMAIN}" "$NGINX_CONF" 2>/dev/null; then
        warn "Конфиг Nginx для ${PANEL_DOMAIN} уже существует — перезаписываю"
      fi

      # Генерация конфига Nginx
      {
        echo "# AdminPanel — сгенерировано install.sh"
        echo "server {"
        echo "    listen 80;"
        echo "    server_name ${PANEL_DOMAIN};"
        echo ""
        echo "    location / {"
        echo "        proxy_pass http://127.0.0.1:8888;"
        echo "        proxy_set_header Host \$host;"
        echo "        proxy_set_header X-Real-IP \$remote_addr;"
        echo "        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;"
        echo "        proxy_set_header X-Forwarded-Proto \$scheme;"
        echo "        proxy_http_version 1.1;"
        echo "        proxy_set_header Upgrade \$http_upgrade;"
        echo '        proxy_set_header Connection "upgrade";'
        echo "        proxy_read_timeout 86400;"
        echo "    }"
        echo ""
        echo "    client_max_body_size 50M;"
        echo "}"
        if [[ -n "$LK_DOMAIN" ]]; then
          echo ""
          echo "server {"
          echo "    listen 80;"
          echo "    server_name ${LK_DOMAIN};"
          echo ""
          echo "    location / {"
          echo "        proxy_pass http://127.0.0.1:8888;"
          echo "        proxy_set_header Host \$host;"
          echo "        proxy_set_header X-Real-IP \$remote_addr;"
          echo "        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;"
          echo "        proxy_set_header X-Forwarded-Proto \$scheme;"
          echo "        proxy_http_version 1.1;"
          echo "        proxy_set_header Upgrade \$http_upgrade;"
          echo '        proxy_set_header Connection "upgrade";'
          echo "        proxy_read_timeout 86400;"
          echo "    }"
          echo ""
          echo "    client_max_body_size 50M;"
          echo "}"
        fi
      } > "$NGINX_CONF"

      ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/adminpanel
      # Удаляем default только если других сайтов нет
      OTHER_SITES=$(find /etc/nginx/sites-enabled/ -type l ! -name adminpanel ! -name default 2>/dev/null | wc -l)
      if [[ "$OTHER_SITES" -eq 0 ]]; then
        rm -f /etc/nginx/sites-enabled/default
      fi
      systemctl enable nginx --now 2>/dev/null || true
      nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null
      ok "Nginx настроен"

      # SSL через Certbot
      CERTBOT_DOMAINS="-d ${PANEL_DOMAIN}"
      [[ -n "$LK_DOMAIN" ]] && CERTBOT_DOMAINS="${CERTBOT_DOMAINS} -d ${LK_DOMAIN}"

      info "Получение SSL-сертификата..."
      certbot --nginx ${CERTBOT_DOMAINS} --non-interactive --agree-tos --register-unsafely-without-email 2>/dev/null && {
        ok "SSL-сертификат получен"
      } || {
        warn "Certbot не сработал — SSL не настроен. Запустите вручную:"
        warn "  certbot --nginx ${CERTBOT_DOMAINS}"
      }
      ;;

    *)
      info "Настройка reverse proxy пропущена"
      ;;
  esac
fi

# ── 10. Итог ──────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${G}  AdminPanel $VERSION успешно установлен!${N}"
echo ""
echo "  Директория: $INSTALL_DIR"
echo ""
if [[ -n "$PANEL_DOMAIN" ]]; then
  echo -e "  ${C}Панель:${N}  https://${PANEL_DOMAIN}/webpanel/"
  [[ -n "$LK_DOMAIN" ]] && echo -e "  ${C}ЛК:${N}      https://${LK_DOMAIN}/"
else
  echo "  Порт: 8888 (только localhost)"
  echo "  Настройте Caddy/Nginx для доступа по домену"
fi
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
