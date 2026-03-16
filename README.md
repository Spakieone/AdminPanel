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

- Дашборд, графики, мониторинг системы
- Управление пользователями, подписками, балансом
- Remnawave — ноды, пользователи, ключи
- Управление ботом — тарифы, купоны, рассылки
- Личный кабинет (ЛК) для пользователей
- 5 ролей доступа, 2FA (TOTP-приложение)
- Тёмная и светлая тема, адаптивность
- Обновление из UI в один клик

---

## Установка

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Spakieone/AdminPanel/main/scripts/install.sh)
```

Скрипт установит Docker, клонирует репозиторий, соберёт образ и покажет логин/пароль.

---

## Reverse Proxy

Панель слушает `127.0.0.1:8888` — нужен reverse proxy для доступа по домену с SSL.

### Caddy (рекомендуется)

Caddy автоматически получает и продлевает SSL-сертификаты (Let's Encrypt).

```bash
sudo apt update && sudo apt install -y caddy
```

`/etc/caddy/Caddyfile`:

```caddy
# Панель управления
admin.example.com {
    reverse_proxy localhost:8888
}

# Личный кабинет (опционально, если нужен отдельный домен)
lk.example.com {
    reverse_proxy localhost:8888
}
```

```bash
sudo systemctl reload caddy
```

Панель доступна: `https://admin.example.com/webpanel/`

### Nginx

```bash
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx
```

Создайте файл `/etc/nginx/sites-available/adminpanel`:

```nginx
server {
    listen 80;
    server_name admin.example.com;

    location / {
        proxy_pass http://127.0.0.1:8888;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket (чат поддержки, мониторинг)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }

    client_max_body_size 50M;
}

# Личный кабинет (опционально)
server {
    listen 80;
    server_name lk.example.com;

    location / {
        proxy_pass http://127.0.0.1:8888;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }

    client_max_body_size 50M;
}
```

```bash
# Активировать конфиг
sudo ln -sf /etc/nginx/sites-available/adminpanel /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# SSL-сертификат (Let's Encrypt)
sudo certbot --nginx -d admin.example.com -d lk.example.com --non-interactive --agree-tos -m your@email.com
```

Certbot автоматически обновит конфиг Nginx для HTTPS и настроит автопродление.

Панель доступна: `https://admin.example.com/webpanel/`

---

## Обновление

**Через панель:** Настройки → Обновления → Обновить из GitHub

**Через CLI:**

```bash
cd /root/adminpanel
bash scripts/update-docker.sh
```

При обновлении сохраняются:

| Файл | Что внутри |
|------|-----------|
| `bot_profiles.json` | Профили ботов (токены, API URL) |
| `remnawave_profiles.json` | Профили Remnawave |
| `auth_credentials.json` | Логин и пароль панели |
| `panel_users.sqlite` | Пользователи, роли, 2FA |
| `ui_settings.json` | Название панели, темы |
| `monitoring_settings.json` | Мониторинг и уведомления |
| `uploads/` | Загруженные файлы |

---

## Быстрые команды

| Действие | Команда |
|----------|---------|
| Запуск | `docker compose up -d` |
| Остановка | `docker compose down` |
| Логи | `docker logs adminpanel -f` |
| Пересборка | `docker compose up -d --build` |
| Смена пароля | `docker exec -it adminpanel python3 admin_cli.py password` |

---

## Бэкап и восстановление

Все данные хранятся в `data/` — достаточно бэкапить только эту папку.

```bash
# Бэкап
cd /root/adminpanel
tar -czf ~/adminpanel_backup_$(date +%Y%m%d_%H%M%S).tar.gz -C data .

# Восстановление
tar -xzf ~/adminpanel_backup_YYYYMMDD_HHMMSS.tar.gz -C /root/adminpanel/data/
docker compose restart
```

---

## Удаление

### Полное удаление (панель + данные)

```bash
cd /root/adminpanel
docker compose down --rmi local    # остановить и удалить образ
cd ~
rm -rf /root/adminpanel            # удалить все файлы и данные
```

### Удаление с сохранением данных

```bash
cd /root/adminpanel

# Сначала сделать бэкап
tar -czf ~/adminpanel_backup_$(date +%Y%m%d_%H%M%S).tar.gz -C data .

# Удалить
docker compose down --rmi local
cd ~
rm -rf /root/adminpanel
```

Бэкап `data/` можно восстановить при повторной установке.

### Удаление reverse proxy

**Caddy:**

```bash
# Убрать блоки из Caddyfile и перезагрузить
sudo systemctl reload caddy
```

**Nginx:**

```bash
sudo rm -f /etc/nginx/sites-enabled/adminpanel
sudo rm -f /etc/nginx/sites-available/adminpanel
sudo nginx -t && sudo systemctl reload nginx
```

---

## Лицензия

MIT
