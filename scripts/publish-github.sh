#!/usr/bin/env bash
# ============================================================
# AdminPanel — Publish to GitHub
# ============================================================
# Инициализирует git-репозиторий и пушит проект на GitHub,
# исключая секреты, кэши и runtime-файлы.
#
# Использование:
#   bash scripts/publish-github.sh
#   bash scripts/publish-github.sh --remote https://github.com/OWNER/REPO.git
#   bash scripts/publish-github.sh --remote git@github.com:OWNER/REPO.git --branch main --message "initial commit"
#
# Требования:
#   - git установлен
#   - gh CLI (опционально, для создания репозитория)
#   - Настроенный SSH ключ или HTTPS токен для GitHub
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

# ── Аргументы ────────────────────────────────────────────
REMOTE_URL=""
BRANCH="main"
COMMIT_MSG=""
FORCE=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --remote)    REMOTE_URL="${2:?missing value for --remote}"; shift 2 ;;
    --branch)    BRANCH="${2:?missing value for --branch}"; shift 2 ;;
    --message|-m) COMMIT_MSG="${2:?missing value for --message}"; shift 2 ;;
    --force)     FORCE=true; shift ;;
    --dry-run)   DRY_RUN=true; shift ;;
    -h|--help)
      echo "Usage: bash scripts/publish-github.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --remote URL      GitHub remote URL (HTTPS or SSH)"
      echo "  --branch NAME     Branch name (default: main)"
      echo "  --message MSG     Commit message"
      echo "  --force           Force push (use with caution)"
      echo "  --dry-run         Show what would happen, don't push"
      exit 0 ;;
    *) err "Unknown argument: $1" ;;
  esac
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   AdminPanel — Публикация на GitHub"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── Проверки ────────────────────────────────────────────
command -v git >/dev/null 2>&1 || err "git не найден. Установи: apt install git"

VERSION="$(cat "$DIR/VERSION" 2>/dev/null | head -1 | tr -d '\r' || echo '0.0.0')"
info "Версия: $VERSION"
info "Рабочая директория: $DIR"

# ── Интерактивный ввод remote если не задан ─────────────
if [[ -z "$REMOTE_URL" ]]; then
  # Проверяем есть ли уже remote
  if git -C "$DIR" remote get-url origin 2>/dev/null; then
    REMOTE_URL="$(git -C "$DIR" remote get-url origin)"
    info "Используем существующий remote: $REMOTE_URL"
  else
    echo ""
    echo "Введи URL репозитория на GitHub:"
    echo "  Примеры:"
    echo "    https://github.com/OWNER/adminpanel.git"
    echo "    git@github.com:OWNER/adminpanel.git"
    echo ""
    read -r -p "Remote URL: " REMOTE_URL || true
    REMOTE_URL="$(echo "${REMOTE_URL:-}" | xargs || true)"
    [[ -z "$REMOTE_URL" ]] && err "Remote URL не задан"
  fi
fi

# ── Commit message ───────────────────────────────────────
if [[ -z "$COMMIT_MSG" ]]; then
  read -r -p "Сообщение коммита [v${VERSION}]: " COMMIT_MSG_IN || true
  COMMIT_MSG="$(echo "${COMMIT_MSG_IN:-}" | xargs || true)"
  [[ -z "$COMMIT_MSG" ]] && COMMIT_MSG="v${VERSION}"
fi

# ── .gitignore ───────────────────────────────────────────
step "Настройка .gitignore"

GITIGNORE="$DIR/.gitignore"

# Категории файлов для исключения
cat > "$GITIGNORE" << 'GITIGNORE_EOF'
# === Runtime data / секреты ===
auth_credentials.json
.auth_tokens.json
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
.lk_tokens.json
panel_users.sqlite
panel_users.sqlite-journal
lk_support.db
*.db
*.sqlite
*.sqlite3

# === Data directory (создаётся при установке) ===
/data/

# === Uploads (пользовательский контент) ===
/uploads/
/telegram_sessions/

# === Логи ===
*.log
/logs/

# === Python ===
__pycache__/
*.py[cod]
*$py.class
*.so
.Python
venv/
.venv/
env/
ENV/
.env
.env.*
backend/venv/
backend/.venv/
backend/.env
backend/.env.*
.pytest_cache/
.mypy_cache/
.ruff_cache/
.cache/

# === Node.js / Frontend build ===
node_modules/
frontend/node_modules/
# dist включаем в git (нужен для установки без Node.js)
# frontend/dist/   ← НЕ игнорируем

# === IDE ===
.idea/
.vscode/
*.swp
*.swo
*~

# === OS ===
.DS_Store
Thumbs.db
desktop.ini

# === Packaging artifacts ===
adminpanel.zip
AdminPanel-*.zip
*.tmp
*.bak

# === LK site configs (содержат настройки конкретного сервера) ===
/lk_site_configs/

# === Временные файлы ===
*.orig
GITIGNORE_EOF

ok ".gitignore обновлён"

# ── Инициализация git ────────────────────────────────────
step "Инициализация git-репозитория"

if [[ ! -d "$DIR/.git" ]]; then
  git -C "$DIR" init -b "$BRANCH"
  ok "git init"
else
  info "Git репозиторий уже существует"
  CURR_BRANCH="$(git -C "$DIR" branch --show-current 2>/dev/null || echo '')"
  if [[ -n "$CURR_BRANCH" && "$CURR_BRANCH" != "$BRANCH" ]]; then
    warn "Текущая ветка: $CURR_BRANCH (ожидалось: $BRANCH)"
    read -r -p "Продолжить с веткой $CURR_BRANCH? [y/N]: " CONT || true
    [[ "${CONT:-}" =~ ^[Yy]$ ]] || err "Прервано"
    BRANCH="$CURR_BRANCH"
  fi
fi

# ── Remote ───────────────────────────────────────────────
step "Настройка remote origin"

if git -C "$DIR" remote get-url origin 2>/dev/null | grep -q "."; then
  EXISTING_REMOTE="$(git -C "$DIR" remote get-url origin)"
  if [[ "$EXISTING_REMOTE" != "$REMOTE_URL" ]]; then
    warn "Существующий remote: $EXISTING_REMOTE"
    warn "Новый remote: $REMOTE_URL"
    read -r -p "Заменить remote? [y/N]: " REPLACE || true
    if [[ "${REPLACE:-}" =~ ^[Yy]$ ]]; then
      git -C "$DIR" remote set-url origin "$REMOTE_URL"
      ok "Remote обновлён"
    fi
  else
    ok "Remote уже настроен: $REMOTE_URL"
  fi
else
  git -C "$DIR" remote add origin "$REMOTE_URL"
  ok "Remote добавлен: $REMOTE_URL"
fi

# ── git config (если не настроен) ───────────────────────
if ! git config user.email >/dev/null 2>&1; then
  git config --global user.email "admin@adminpanel.local"
  git config --global user.name "AdminPanel"
  warn "git user не был настроен — установлены значения по умолчанию"
fi

# ── Staging ──────────────────────────────────────────────
step "Подготовка файлов к коммиту"

git -C "$DIR" add -A

STAGED="$(git -C "$DIR" diff --cached --name-only | wc -l)"
info "Файлов к коммиту: $STAGED"

if [[ "$STAGED" -eq 0 ]]; then
  info "Нет изменений для коммита"
  # Проверяем если уже есть коммиты
  if git -C "$DIR" log --oneline -1 2>/dev/null | grep -q "."; then
    info "Существующий репозиторий без новых изменений"
    if [[ "$DRY_RUN" != true ]]; then
      read -r -p "Пушить без нового коммита? [y/N]: " PUSH_EMPTY || true
      [[ "${PUSH_EMPTY:-}" =~ ^[Yy]$ ]] || { info "Ничего не сделано"; exit 0; }
    fi
  else
    err "Нет файлов для коммита. Проверь .gitignore — возможно исключено слишком много файлов."
  fi
else
  # ── Commit ───────────────────────────────────────────────
  step "Создание коммита"

  echo ""
  echo "Будут включены:"
  git -C "$DIR" diff --cached --name-only | head -30
  if [[ "$STAGED" -gt 30 ]]; then
    echo "  ... и ещё $(( STAGED - 30 )) файлов"
  fi
  echo ""

  if [[ "$DRY_RUN" == true ]]; then
    warn "DRY RUN — коммит не создан"
  else
    git -C "$DIR" commit -m "$COMMIT_MSG"
    ok "Коммит создан: $COMMIT_MSG"
  fi
fi

# ── Push ─────────────────────────────────────────────────
step "Отправка на GitHub"

if [[ "$DRY_RUN" == true ]]; then
  warn "DRY RUN — push не выполнен"
  echo ""
  echo "Команда которая бы выполнилась:"
  if [[ "$FORCE" == true ]]; then
    echo "  git push -u --force origin $BRANCH"
  else
    echo "  git push -u origin $BRANCH"
  fi
else
  read -r -p "Пушить на $REMOTE_URL (ветка: $BRANCH)? [y/N]: " CONFIRM || true
  if [[ "${CONFIRM:-}" =~ ^[Yy]$ ]]; then
    if [[ "$FORCE" == true ]]; then
      warn "Force push!"
      git -C "$DIR" push -u --force origin "$BRANCH"
    else
      git -C "$DIR" push -u origin "$BRANCH"
    fi
    ok "Успешно запушено на $REMOTE_URL"

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${G}  Репозиторий обновлён!${N}"
    REPO_HTTPS="${REMOTE_URL%.git}"
    REPO_HTTPS="${REPO_HTTPS/git@github.com:/https://github.com/}"
    echo "  $REPO_HTTPS"
    echo ""
    echo "  После публикации:"
    echo "  • Проверь что .gitignore скрывает секреты"
    echo "  • Добавь описание в README.md"
    echo "  • Настрой GitHub Actions (если нужен auto-build)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  else
    info "Push отменён"
  fi
fi
