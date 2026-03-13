# AdminPanel

Веб-панель управления для Telegram-бота и Remnawave. Backend — FastAPI, frontend — React + Vite. Работает в Docker.

---

## Содержание

1. [Установка](#1-установка)
2. [Обновление панели](#2-обновление-панели)
3. [Личный кабинет (ЛК)](#3-личный-кабинет-лк)
4. [Подключение бота (API-модуль)](#4-подключение-бота-api-модуль)
5. [Reverse proxy (Caddy / Nginx)](#5-reverse-proxy-caddy--nginx)
6. [Публикация на GitHub](#6-публикация-на-github)
7. [Смена пароля и управление пользователями](#7-смена-пароля-и-управление-пользователями)
8. [Диагностика](#8-диагностика)
9. [Удаление](#9-удаление)
10. [Быстрые команды](#10-быстрые-команды)

---

## 1. Установка

### 1.1. Требования

- Docker + Docker Compose
- Открытый порт `8888` (или настроенный reverse proxy)

### 1.2. Запуск

```bash
git clone https://github.com/OWNER/adminpanel.git /root/adminpanel
cd /root/adminpanel
docker compose up -d --build
```

Панель доступна: `http://SERVER_IP:8888/webpanel/`

### 1.3. Обновление образа через ghcr.io

Если используете образ из GitHub Container Registry:

```bash
cd /root/adminpanel
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
```

---

## 2. Обновление панели

### 2.1. Обновление через UI

1. В панели: **Settings → Обновления**.
2. Нажмите **Проверить доступность** — убедитесь, что GitHub доступен.
3. Нажмите **Обновить из GitHub** — начнётся загрузка и установка.
4. Следите за **Логом обновления** в правой колонке.

Что делает обновление автоматически:
- создаёт бэкап: `bot_profiles.json`, `remnawave_profiles.json`, `auth_credentials.json`, `panel_users.sqlite`, `ui_settings.json`, `monitoring_settings.json`, `sender_saved_messages.json`, `uploads/sender/`
- скачивает последнюю версию из GitHub
- заменяет код панели, восстанавливает бэкап
- перезапускает контейнер

> Доступно только для роли `super_admin`.

### 2.2. Файлы данных

| Файл | Что хранит |
|------|-----------|
| `bot_profiles.json` | Профили ботов (токены, API URL) |
| `remnawave_profiles.json` | Профили Remnawave |
| `auth_credentials.json` | Логин и пароль админки |
| `panel_users.sqlite` | Пользователи панели, роли, tg_id для 2FA |
| `ui_settings.json` | Название панели, настройки UI |
| `monitoring_settings.json` | Настройки мониторинга и уведомлений |
| `sender_saved_messages.json` | Сохранённые сообщения для рассылки |
| `uploads/sender/` | Фото для рассылок |
| `api/` | API-модуль бота (копируется в `/root/bot/modules/api`) |

---

## 3. Личный кабинет (ЛК)

ЛК работает в том же контейнере, что и AdminPanel, — на порту `8888`. Роутинг по HTTP-заголовку `Host`.

### 3.1. Настройка домена ЛК в панели

1. Откройте: **Панель → ЛК → Профили ЛК**.
2. Укажите домен профиля, например `lk.example.com`.

### 3.2. Reverse proxy для ЛК

**Caddy** (`/etc/caddy/Caddyfile`):

```caddy
lk.example.com {
    reverse_proxy localhost:8888
}
```

**Nginx** (новый `server`-блок):

```nginx
server {
    listen 80;
    server_name lk.example.com;

    location / {
        proxy_pass http://127.0.0.1:8888;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

> Важно: `proxy_set_header Host $host;` обязательно — иначе панель не поймёт, что запрос предназначен для ЛК.

### 3.3. Проверка без DNS

```bash
curl -H 'Host: lk.example.com' http://127.0.0.1:8888/ | head -5
```

---

## 4. Подключение бота (API-модуль)

Для работы вкладок «Пользователи / Ключи / Серверы / Бот» нужен **API-модуль бота** — HTTP API на `127.0.0.1:7777`.

### 4.1. Установка модуля

```bash
mkdir -p /root/bot/modules
cp -r /root/adminpanel/api /root/bot/modules/api
sudo systemctl restart bot.service
```

Префикс API: `/adminpanel/api`

### 4.2. Reverse proxy для API-модуля

**Caddy** (добавить внутрь блока вашего домена):

```caddy
handle /adminpanel/api/* {
    reverse_proxy 127.0.0.1:7777
}
```

```bash
sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
```

**Nginx** (добавить внутрь `server { ... }`):

```nginx
location /adminpanel/api/ {
    proxy_pass http://127.0.0.1:7777;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 4.3. Получение токена

В боте: **Админы → выберите себя → Сгенерировать токен**. Сохраните — показывается один раз.

### 4.4. Создание профиля в AdminPanel

**AdminPanel → Профили ботов → Создать профиль:**

| Поле | Пример |
|------|--------|
| Bot API URL | `https://bot.example.com/adminpanel/api` |
| Admin ID | ваш `tg_id` |
| Token | токен из бота |

После сохранения и активации профиля страницы Users/Keys/Servers открываются без `401`.

---

## 5. Reverse proxy (Caddy / Nginx)

### 5.1. Caddy

**Установка:**

```bash
sudo apt update && sudo apt install -y caddy
sudo systemctl enable --now caddy
```

**Конфиг** (`/etc/caddy/Caddyfile`):

```caddy
admin.example.com {
    redir /webpanel /webpanel/ 301

    handle /webpanel/* {
        reverse_proxy localhost:8888
    }

    handle /api/* {
        reverse_proxy localhost:8888
    }

    redir / /webpanel/ 301
}
```

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

### 5.2. Nginx

**Установка:**

```bash
sudo apt update && sudo apt install -y nginx
sudo systemctl enable --now nginx
```

**Конфиг** (`/etc/nginx/sites-available/adminpanel`):

```nginx
server {
    listen 80;
    server_name admin.example.com;

    location = /webpanel {
        return 301 /webpanel/;
    }

    location /webpanel/ {
        proxy_pass http://127.0.0.1:8888;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8888;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location = / {
        return 301 /webpanel/;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/adminpanel /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

**SSL (Let's Encrypt):**

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d admin.example.com
```

---

## 6. Публикация на GitHub

Скрипт `scripts/publish-github.sh` инициализирует git-репозиторий, настраивает `.gitignore` (исключает секреты и runtime-файлы) и публикует проект на GitHub.

### 6.1. Использование

```bash
cd /root/adminpanel

# Интерактивный режим (скрипт спросит URL и сообщение коммита)
bash scripts/publish-github.sh

# С параметрами
bash scripts/publish-github.sh \
  --remote https://github.com/OWNER/adminpanel.git \
  --branch main \
  --message "v1.0.0"

# SSH remote
bash scripts/publish-github.sh \
  --remote git@github.com:OWNER/adminpanel.git

# Dry-run (показать что произойдёт, без пуша)
bash scripts/publish-github.sh --dry-run
```

### 6.2. Опции

| Флаг | Описание |
|------|----------|
| `--remote URL` | GitHub remote (HTTPS или SSH) |
| `--branch NAME` | Ветка (по умолчанию: `main`) |
| `--message MSG` | Сообщение коммита |
| `--force` | Force push |
| `--dry-run` | Показать план без выполнения |

### 6.3. Что исключается из репозитория

- `auth_credentials.json`, `.auth_tokens.json`, `bot_profiles.json`, `remnawave_profiles.json`
- `panel_users.sqlite`, `*.db`, `*.sqlite`
- `data/`, `uploads/`, `telegram_sessions/`, `logs/`
- `venv/`, `.env`, `node_modules/`
- `*.log`, `*.zip`, `lk_site_configs/`

`frontend/dist/` **включается** — нужен при клонировании без Node.js.

### 6.4. Настройка SSH-ключа для GitHub

```bash
ssh-keygen -t ed25519 -C "your@email.com"
cat ~/.ssh/id_ed25519.pub
```

Добавьте публичный ключ в GitHub: **Settings → SSH and GPG keys → New SSH key**.

```bash
ssh -T git@github.com  # проверка
```

---

## 7. Смена пароля и управление пользователями

```bash
docker exec -it adminpanel python3 admin_cli.py password
```

Управление через UI: **AdminPanel → Управление пользователями** — создание пользователей, роли (`owner`, `super_admin`, `manager`, `operator`, `viewer`), привязка Telegram для 2FA.

---

## 8. Диагностика

### Статус контейнера

```bash
docker ps | grep adminpanel
docker logs adminpanel --tail 100
docker logs adminpanel -f
```

### Проверка порта

```bash
sudo ss -tlnp | grep 8888
curl -I http://localhost:8888/webpanel/
```

### Частые проблемы

#### Контейнер не запускается

```bash
docker logs adminpanel --tail 50
docker compose up  # без -d, чтобы видеть вывод
```

#### Frontend устарел после обновления

```bash
docker exec adminpanel rm -rf /app/frontend/dist/assets
docker cp /root/adminpanel/frontend/dist/. adminpanel:/app/frontend/dist/
```

#### Caddy / Nginx не проксирует

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo nginx -t
curl -I http://localhost:8888/webpanel/
```

#### ЛК не открывается по домену

```bash
curl -H 'Host: lk.example.com' http://127.0.0.1:8888/ | head -5
```

Убедитесь, что в reverse proxy передаётся `Host: $host`.

---

## 9. Удаление

```bash
cd /root/adminpanel
docker compose down
docker rmi adminpanel 2>/dev/null || true
rm -rf /root/adminpanel
```

---

## 10. Быстрые команды

| Действие | Команда |
|----------|---------|
| Запуск | `docker compose up -d` |
| Остановка | `docker compose down` |
| Перезапуск | `docker compose restart` |
| Логи (live) | `docker logs adminpanel -f` |
| Пересборка | `docker compose up -d --build` |
| Смена пароля | `docker exec -it adminpanel python3 admin_cli.py password` |
| Проверка порта | `sudo ss -tlnp \| grep 8888` |

---

## Поддержка

Telegram: [@spakio]
