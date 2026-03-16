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

Панель слушает `127.0.0.1:8888` — нужен reverse proxy для доступа по домену.

### Caddy (рекомендуется)

```bash
sudo apt update && sudo apt install -y caddy
```

`/etc/caddy/Caddyfile`:

```caddy
admin.example.com {
    reverse_proxy localhost:8888
}

# ЛК (опционально)
lk.example.com {
    reverse_proxy localhost:8888
}
```

```bash
sudo systemctl reload caddy
```

> SSL получается автоматически.

После этого панель доступна: `https://admin.example.com/webpanel/`

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

## Лицензия

MIT
