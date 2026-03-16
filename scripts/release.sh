#!/usr/bin/env bash
# ============================================================
# AdminPanel — Создание релиза и публикация на GitHub
# ============================================================
# Использование:
#   bash scripts/release.sh
# ============================================================
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

G='\033[0;32m'; Y='\033[1;33m'; C='\033[0;36m'; R='\033[0;31m'; B='\033[1;34m'; N='\033[0m'
ok()   { echo -e "${G}[✓]${N} $*"; }
info() { echo -e "${C}[•]${N} $*"; }
warn() { echo -e "${Y}[!]${N} $*"; }
err()  { echo -e "${R}[✗]${N} $*"; exit 1; }
step() { echo -e "\n${B}━━ $*${N}"; }

REPO="${ADMINPANEL_GITHUB_REPO:-OWNER/AdminPanel}"
BRANCH="main"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   AdminPanel — Публикация релиза"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Проверки зависимостей ────────────────────────────────
step "Проверка зависимостей"

command -v git >/dev/null 2>&1 || err "git не установлен: apt install git"
command -v gh  >/dev/null 2>&1 || err "gh CLI не установлен: https://cli.github.com"
command -v node >/dev/null 2>&1 || err "Node.js не установлен"
command -v npm  >/dev/null 2>&1 || err "npm не установлен"

gh auth status >/dev/null 2>&1 || err "gh не авторизован. Выполни: gh auth login"

ok "Все зависимости в порядке"

# ── Текущая версия ───────────────────────────────────────
step "Версия релиза"

CURRENT_VERSION="$(cat "$DIR/VERSION" 2>/dev/null | head -1 | tr -d '\r' || echo '0.0.0')"
info "Текущая версия: $CURRENT_VERSION"
echo ""
read -r -p "Новая версия [${CURRENT_VERSION}]: " NEW_VERSION_INPUT
NEW_VERSION="${NEW_VERSION_INPUT:-$CURRENT_VERSION}"
NEW_VERSION="$(echo "$NEW_VERSION" | xargs)"

# Валидация формата версии
if ! echo "$NEW_VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?$'; then
  err "Неверный формат версии: $NEW_VERSION (ожидается: X.Y.Z или X.Y.Z.W)"
fi

echo ""
read -r -p "Описание релиза (что изменилось): " RELEASE_NOTES
RELEASE_NOTES="${RELEASE_NOTES:-Обновление $NEW_VERSION}"

info "Версия: $NEW_VERSION"

# ── Сборка фронтенда ─────────────────────────────────────
step "Сборка фронтенда"

cd "$DIR/frontend"
info "Установка зависимостей..."
npm ci --legacy-peer-deps --silent
info "Сборка adminpanel..."
npm run build
info "Сборка ЛК..."
npm run build:lk
cd "$DIR"
ok "Фронтенд собран"

# ── Обновление файлов версии ─────────────────────────────
step "Обновление версии"

echo "$NEW_VERSION" > "$DIR/VERSION"

TODAY="$(date +%Y-%m-%d)"
cat > "$DIR/version.json" << EOF
{
  "version": "${NEW_VERSION}",
  "channel": "release",
  "release_date": "${TODAY}",
  "update_url": ""
}
EOF

ok "Версия обновлена: $NEW_VERSION (${TODAY})"

# ── .gitignore ───────────────────────────────────────────
step "Настройка .gitignore"

cat > "$DIR/.gitignore" << 'GITIGNORE_EOF'
# Секреты и данные конкретного сервера
auth_credentials.json
.auth_tokens.json
.lk_tokens.json
bot_profiles.json
remnawave_profiles.json
lk_profiles.json
lk_binding.json
lk_module_api.json
monitoring_state.json
notifications_state.json
remnawave_online_history.json
github_update_state.json
github_update.log
github_update_config.json
ui_settings.json
monitoring_settings.json
sender_saved_messages.json
panel_users.sqlite
panel_users.sqlite-journal
lk_support.db

# Базы данных
*.db
*.sqlite
*.sqlite3

# Данные и загрузки
/data/
/uploads/
/telegram_sessions/
/lk_site_configs/

# Логи
*.log
/logs/

# Python
__pycache__/
*.py[cod]
*.so
venv/
.venv/
env/
ENV/
.env
.env.*
backend/venv/
backend/.venv/
.pytest_cache/
.mypy_cache/
.ruff_cache/

# Node.js
node_modules/
frontend/node_modules/

# IDE
.idea/
.vscode/
*.swp
*.swo
*~

# OS
.DS_Store
Thumbs.db

# Архивы
*.zip
*.tmp
*.bak
GITIGNORE_EOF

ok ".gitignore настроен"

# ── Git ──────────────────────────────────────────────────
step "Git — коммит и тег"

# Настройка git если нужно
if ! git config user.email >/dev/null 2>&1; then
  git config --global user.email "release@adminpanel.local"
  git config --global user.name "AdminPanel Release"
fi

# Инициализация если нужно
if [[ ! -d "$DIR/.git" ]]; then
  git -C "$DIR" init -b "$BRANCH"
  ok "Git репозиторий инициализирован"
fi

# Remote
GH_TOKEN="$(gh auth token 2>/dev/null || echo '')"
if [[ -z "$GH_TOKEN" ]]; then
  err "Нет токена GitHub. Выполни: gh auth login"
fi
REMOTE_URL="https://${GH_TOKEN}@github.com/${REPO}.git"
if git -C "$DIR" remote get-url origin 2>/dev/null | grep -q "."; then
  git -C "$DIR" remote set-url origin "$REMOTE_URL"
else
  git -C "$DIR" remote add origin "$REMOTE_URL"
fi

TAG="v${NEW_VERSION}"

# Проверяем нет ли уже такого тега
if git -C "$DIR" tag | grep -qx "$TAG"; then
  warn "Тег $TAG уже существует!"
  read -r -p "Перезаписать? [y/N]: " OVERWRITE
  if [[ "${OVERWRITE:-}" =~ ^[Yy]$ ]]; then
    git -C "$DIR" tag -d "$TAG" 2>/dev/null || true
    gh release delete "$TAG" --repo "$REPO" --yes 2>/dev/null || true
  else
    err "Прервано"
  fi
fi

git -C "$DIR" add -A
STAGED="$(git -C "$DIR" diff --cached --name-only | wc -l)"
info "Файлов к коммиту: $STAGED"

if [[ "$STAGED" -gt 0 ]]; then
  git -C "$DIR" commit -m "Release $TAG"
  ok "Коммит создан"
else
  info "Нет изменений — используем существующий коммит"
fi

git -C "$DIR" tag -a "$TAG" -m "Release $TAG"
ok "Тег создан: $TAG"

# ── Push ─────────────────────────────────────────────────
step "Push на GitHub"

echo ""
info "Репозиторий: https://github.com/${REPO}"
info "Версия: $TAG"
info "Описание: $RELEASE_NOTES"
echo ""
read -r -p "Опубликовать? [y/N]: " CONFIRM
[[ "${CONFIRM:-}" =~ ^[Yy]$ ]] || { info "Отменено"; exit 0; }

git -C "$DIR" push -u origin "$BRANCH" --force
git -C "$DIR" push origin "$TAG"
ok "Код запушен"

# ── GitHub Release ───────────────────────────────────────
step "Создание GitHub Release"

gh release create "$TAG" \
  --repo "$REPO" \
  --title "AdminPanel $TAG" \
  --notes "$RELEASE_NOTES" \
  --latest

ok "Релиз создан: https://github.com/${REPO}/releases/tag/${TAG}"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${G}  Релиз $TAG успешно опубликован!${N}"
echo "  https://github.com/${REPO}/releases/tag/${TAG}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
