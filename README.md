<div align="center">

# AdminPanel

**Веб-панель управления Telegram-ботом и Remnawave VPN**

FastAPI · React + Vite · Docker

[![Docker](https://img.shields.io/badge/Docker-20.10+-2496ED?logo=docker&logoColor=white)](https://docs.docker.com/get-docker/)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)](https://python.org)
[![React](https://img.shields.io/badge/React-18+-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

</div>

---

## Возможности

- **Дашборд** — статистика в реальном времени, графики, мониторинг системы
- **Управление пользователями** — поиск, фильтры, редактирование, бан/разбан, операции с балансом
- **Подписки** — создание, продление, отзыв ключей с отслеживанием трафика
- **Remnawave** — полное управление нодами, пользователями, ключами через Remnawave API
- **Управление ботом** — настройки, тарифы, купоны, подарки, рассылки, логи
- **Личный кабинет (ЛК)** — портал самообслуживания для пользователей (тарифы, оплата, ключи)
- **Роли доступа** — 5 уровней: owner, super_admin, manager, operator, viewer
- **2FA** — двухфакторная аутентификация через Telegram
- **Темы** — полная поддержка тёмной и светлой темы
- **Адаптивность** — работает на десктопе, планшете и мобильном
- **Автообновления** — обновление из UI или CLI в один клик

---

## Быстрый старт

```bash
git clone https://github.com/Spakieone/AdminPanel.git /root/adminpanel
cd /root/adminpanel
docker compose up -d --build
```

Панель доступна через reverse proxy: `https://ваш-домен/webpanel/`

---

## Требования

| Компонент | Минимум |
|-----------|---------|
| ОС | Ubuntu 20.04+ / Debian 11+ / CentOS 8+ |
| Docker | 20.10+ с Compose plugin |
| RAM | 512 MB |
| Диск | 2 GB свободного места |
| Порт | 8888 (или через reverse proxy) |

---

## Установка

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Spakieone/AdminPanel/main/scripts/install.sh)
```

Скрипт автоматически:
- Определит ОС и установит зависимости
- Установит Docker (если не установлен)
- Клонирует репозиторий
- Соберёт Docker-образ
- Запустит панель
- Покажет логин и пароль для первого входа

### Готовый образ (GHCR)

```bash
cd /root/adminpanel
bash scripts/install-docker.sh
```

> Требуется GitHub PAT с правом `read:packages`

---

## Обновление

### Через панель (рекомендуется)

1. **Настройки → Обновления**
2. **Проверить доступность**
3. **Обновить из GitHub**

> Доступно только для роли `super_admin`

### Через CLI

```bash
cd /root/adminpanel

# Готовый образ из GHCR
bash scripts/update-docker.sh

# Пересборка из исходников
bash scripts/update-docker.sh --local
```

### Что сохраняется при обновлении

| Файл | Содержимое |
|------|-----------|
| `bot_profiles.json` | Профили ботов (токены, API URL) |
| `remnawave_profiles.json` | Профили Remnawave |
| `auth_credentials.json` | Логин и пароль панели |
| `panel_users.sqlite` | Пользователи, роли, 2FA |
| `ui_settings.json` | Название панели, темы |
| `monitoring_settings.json` | Мониторинг и уведомления |
| `uploads/` | Загруженные файлы |

---

## Личный кабинет (ЛК)

ЛК работает в том же контейнере на порту `8888`. Роутинг — по HTTP-заголовку `Host`.

### Настройка

1. **Панель → ЛК → Профили ЛК**
2. Укажите домен, например `lk.example.com`
3. Настройте reverse proxy (см. ниже)

### Проверка без DNS

```bash
curl -H 'Host: lk.example.com' http://127.0.0.1:8888/ | head -5
```

---

## Подключение бота (API-модуль)

Вкладки **Пользователи / Ключи / Серверы / Бот** требуют API-модуль — HTTP API на `127.0.0.1:7777`.

### Установка модуля

```bash
mkdir -p /root/bot/modules
cp -r /root/adminpanel/api /root/bot/modules/api
sudo systemctl restart bot.service
```

### Получение токена

В боте: **Админы → выберите себя → Сгенерировать токен**

> Токен показывается один раз — сохраните его!

### Создание профиля

**AdminPanel → Профили ботов → Создать профиль:**

| Поле | Пример |
|------|--------|
| Bot API URL | `https://bot.example.com/adminpanel/api` |
| Admin ID | ваш `tg_id` |
| Token | токен из бота |

---

## Reverse Proxy

### Caddy (рекомендуется)

```bash
sudo apt update && sudo apt install -y caddy
sudo systemctl enable --now caddy
```

`/etc/caddy/Caddyfile`:

```caddy
admin.example.com {
    reverse_proxy localhost:8888
}

# Личный кабинет (опционально)
lk.example.com {
    reverse_proxy localhost:8888
}
```

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

> Caddy получает SSL автоматически — сертификаты не нужны.

### Nginx

```bash
sudo apt update && sudo apt install -y nginx
```

`/etc/nginx/sites-available/adminpanel`:

```nginx
server {
    listen 80;
    server_name admin.example.com;

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

## Управление пользователями

### Смена пароля через CLI

```bash
docker exec -it adminpanel python3 admin_cli.py password
```

### Через панель

**AdminPanel → Управление пользователями**

| Роль | Права |
|------|-------|
| `owner` | Полный доступ, управление super_admin |
| `super_admin` | Обновления, управление пользователями |
| `manager` | Управление ботом, пользователями бота |
| `operator` | Просмотр + базовые действия |
| `viewer` | Только просмотр |

---

## Быстрые команды

| Действие | Команда |
|----------|---------|
| Запуск | `docker compose up -d` |
| Остановка | `docker compose down` |
| Перезапуск | `docker compose restart` |
| Логи | `docker logs adminpanel -f` |
| Пересборка | `docker compose up -d --build` |
| Смена пароля | `docker exec -it adminpanel python3 admin_cli.py password` |
| Проверка порта | `sudo ss -tlnp \| grep 8888` |
| Статус | `docker ps \| grep adminpanel` |

---

## Структура проекта

```
adminpanel/
├── backend/              # FastAPI backend (Python)
│   ├── main.py           # Основной API
│   ├── auth_utils.py     # Аутентификация
│   ├── bot_proxy.py      # Проксирование к боту
│   └── ...
├── frontend/             # React frontend (TypeScript)
│   ├── src/
│   │   ├── pages/        # Страницы
│   │   ├── components/   # UI компоненты
│   │   ├── api/          # API клиент
│   │   └── ...
│   ├── dist/             # Собранный фронтенд
│   └── dist-lk/          # Собранный ЛК
├── scripts/              # Скрипты установки/обновления
├── data/                 # Данные (создаётся автоматически)
├── docker-compose.yml    # Docker конфигурация
├── Dockerfile            # Сборка образа
└── VERSION               # Текущая версия
```

---

## Безопасность

- Панель слушает только `127.0.0.1:8888` — используйте reverse proxy с HTTPS
- JWT токены с ограниченным сроком действия
- 2FA через Telegram
- Ролевая система доступа (5 уровней)
- CSRF защита на мутирующих запросах
- Все секреты в `data/` и исключены из git

---

## Диагностика

<details>
<summary>Контейнер не запускается</summary>

```bash
docker logs adminpanel --tail 50
docker compose up    # без -d для просмотра вывода
```
</details>

<details>
<summary>Фронтенд устарел после обновления</summary>

```bash
docker exec adminpanel rm -rf /app/frontend/dist/assets
docker cp frontend/dist/. adminpanel:/app/frontend/dist/
```
</details>

<details>
<summary>Reverse proxy не работает</summary>

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo nginx -t
curl -I http://localhost:8888/webpanel/
```
</details>

<details>
<summary>ЛК не открывается по домену</summary>

```bash
curl -H 'Host: lk.example.com' http://127.0.0.1:8888/ | head -5
```

Убедитесь, что reverse proxy передаёт `Host: $host`.
</details>

---

## Удаление

```bash
cd /root/adminpanel
docker compose down
docker rmi adminpanel 2>/dev/null || true
rm -rf /root/adminpanel
```

---

## Лицензия

MIT

---

<div align="center">

**FastAPI** · **React** · **Docker**

</div>
