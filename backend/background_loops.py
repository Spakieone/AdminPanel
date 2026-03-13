from __future__ import annotations

import logging
import os
import time
from typing import Any, Awaitable, Callable, Dict, Optional

import httpx
from notifications_store import save_notifications_state as _save_notifications_state
from bot_api_base import get_bot_api_base_url

logger = logging.getLogger(__name__)

ReadJsonFn = Callable[[Any, Any], Any]
WriteJsonFn = Callable[[Any, Any], None]
LoadRemnawaveProfilesFn = Callable[[], list]
CheckNodesStatusFn = Callable[[str, str, str], Awaitable[Dict[str, Any]]]
GetNodeStateKeyFn = Callable[[str, str], str]
GetNodeStatusFn = Callable[[Dict[str, Any]], str]
FormatNotificationFn = Callable[[str, Dict[str, Any], bool, Optional[str], Optional[str]], str]
SendNotificationsFn = Callable[[str, list, list, str], Awaitable[None]]
CleanupSessionsFn = Callable[[], None]
RemnawaveGetJsonFn = Callable[[str, str, str], Awaitable[Optional[Any]]]
ExtractOnlineUsersCountFn = Callable[[Any], Optional[int]]
SumOnlineFromNodesFn = Callable[[Any], Optional[int]]
AppendOnlineHistoryFn = Callable[[list[str], int, int], None]

def _format_downtime_seconds(total_seconds: int) -> str:
    """Format seconds into Xч Yм Zс."""
    if total_seconds < 0:
        total_seconds = 0
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    seconds = total_seconds % 60
    return f"{hours}ч {minutes}м {seconds}с"


def _stable_hash(input: str) -> str:
    # Deterministic djb2 hash (same as frontend) for stable IDs.
    h = 5381
    for ch in input:
        h = ((h << 5) + h) ^ ord(ch)
    return format(h & 0xFFFFFFFF, "x")


def _append_status_notification(
    notifications_state_file: Any,
    *,
    title: str,
    message: str,
    kind: str,
    profile_id: str,
    node_id: Optional[str] = None,
    country_code: Optional[str] = None,
) -> None:
    """
    Persist a status notification to server-side notifications state so it appears in the web UI,
    even if the admin panel wasn't open when the incident happened.
    """
    try:
        notif_type = "error"
        if kind in ("node_up", "bot_api_up", "rem_api_up"):
            notif_type = "success"
        elif kind in ("node_down", "node_stable_offline", "bot_api_down", "rem_api_down"):
            notif_type = "error"

        bucket = int(time.time() // 60)  # 1-minute bucket to avoid duplicates on quick loop iterations
        raw = f"{kind}|{profile_id}|{node_id or ''}|{title}|{message}|{bucket}"
        notif_id = f"mon-{_stable_hash(raw)}"
        data: dict = {"kind": kind, "profile_id": profile_id}
        if node_id:
            data["node_id"] = node_id
        if country_code:
            data["country_code"] = str(country_code).strip().upper()
        payload = {
            "append_status_notification": {
                "id": notif_id,
                "type": notif_type,
                "title": str(title),
                "message": str(message),
                # Always store time in MSK with explicit timezone offset (+03:00),
                # so frontend displays correct MSK time regardless of server timezone.
                "date": time.strftime("%Y-%m-%dT%H:%M:%S+03:00", time.gmtime(time.time() + 3 * 60 * 60)),
                "data": data,
            }
        }
        _save_notifications_state(notifications_state_file, payload)
    except Exception:
        # non-fatal
        return


async def monitor_nodes_loop_impl(
    *,
    read_json: ReadJsonFn,
    write_json: WriteJsonFn,
    load_remnawave_profiles: LoadRemnawaveProfilesFn,
    check_nodes_status: CheckNodesStatusFn,
    get_node_state_key: GetNodeStateKeyFn,
    get_node_status: GetNodeStatusFn,
    format_notification: FormatNotificationFn,
    send_notifications_to_recipients: SendNotificationsFn,
    monitoring_settings_file: Any,
    monitoring_state_file: Any,
    bot_profiles_file: Any,
    notifications_state_file: Any,
    decrypt_token: Optional[Callable[[str], str]] = None,
) -> None:
    """Основной цикл мониторинга узлов (вынесен из main.py, чтобы уменьшить размер файла)."""
    import asyncio
    from datetime import datetime

    logger.info("[MONITORING] loop started")
    last_state: Dict[str, Any] = {}

    def _extract_reason(obj: Any) -> str:
        """
        Best-effort extract a human-readable error/reason string.
        Some exceptions stringify to empty, and some APIs provide multiple reason fields.
        """
        if obj is None:
            return ""
        try:
            s = str(obj).strip()
            if s:
                return s
        except Exception:
            pass
        return ""

    def _extract_node_reason(node: Dict[str, Any]) -> str:
        for k in (
            "lastStatusMessage",
            "last_status_message",
            "statusMessage",
            "status_message",
            "message",
            "error",
            "reason",
        ):
            if not isinstance(node, dict):
                break
            v = node.get(k)
            s = _extract_reason(v)
            if s:
                return s
        # If node is administratively disabled, make it explicit.
        try:
            if isinstance(node, dict) and node.get("isDisabled") is True:
                return "Отключена (isDisabled)"
        except Exception:
            pass
        return ""

    def _extract_node_online_users(node: Any) -> Optional[int]:
        """
        Best-effort extract "online users" count per node from Remnawave node payload.
        We intentionally avoid treating booleans as ints (since `online` can be boolean).
        """
        if node is None:
            return None
        if isinstance(node, bool):
            return None
        if isinstance(node, (int, float)):
            n = int(node)
            return n if n >= 0 else None

        if isinstance(node, dict):
            candidates = (
                "onlineUsers",
                "usersOnline",
                "online_users",
                "users_online",
                "onlineCount",
                "online_count",
                "usersOnlineCount",
                "online_users_count",
            )
            for k in candidates:
                if k not in node:
                    continue
                v = node.get(k)
                if isinstance(v, bool):
                    continue
                if isinstance(v, (int, float)):
                    n = int(v)
                    return n if n >= 0 else None
                if isinstance(v, str):
                    try:
                        n = int(v)
                        return n if n >= 0 else None
                    except Exception:
                        pass

            # Nested variants
            for k in ("stats", "usage", "users", "system", "data", "result", "response"):
                if k in node:
                    found = _extract_node_online_users(node.get(k))
                    if found is not None:
                        return found

        return None

    def _extract_node_country_code(node: Any) -> Optional[str]:
        """
        Extract ISO-like 2-letter country code from Remnawave node payload if present.
        Falls back to best-effort mapping from country name strings.
        """
        try:
            if not isinstance(node, dict):
                return None
            raw = (
                node.get("countryCode")
                or node.get("country_code")
                or node.get("country")
                or node.get("countryName")
                or node.get("country_name")
            )
            if raw is None:
                return None
            if isinstance(raw, str):
                s = raw.strip()
                if len(s) == 2 and s.isalpha():
                    return s.upper()
                l = s.lower()
                # common names -> codes
                if "russia" in l or "росси" in l:
                    return "RU"
                if "germany" in l or "deutsch" in l or "герман" in l or "немец" in l:
                    return "DE"
                if "poland" in l or "polska" in l or "польш" in l:
                    return "PL"
                if "kazakh" in l or "казах" in l:
                    return "KZ"
                if "united states" in l or l in ("usa", "us") or "america" in l or "америк" in l or "сша" in l:
                    return "US"
                if l in ("uk",) or "united kingdom" in l or "brit" in l or "англи" in l:
                    return "GB"
                if "nether" in l or "holland" in l or "нидер" in l or "голлан" in l:
                    return "NL"
            return None
        except Exception:
            return None
    while True:
        try:
            # Читаем настройки мониторинга
            settings = read_json(monitoring_settings_file, {})
            # Split notifications:
            # - telegramNotificationsEnabled: controls Telegram sending
            # - panelNotificationsEnabled: controls in-panel status_notifications persistence
            telegram_enabled = bool(settings.get("telegramNotificationsEnabled", settings.get("notificationsEnabled", False)))
            panel_enabled = bool(settings.get("panelNotificationsEnabled", True))
            tg_down = bool(settings.get("telegramNotifyOnDown", settings.get("notifyOnDown", True)))
            tg_up = bool(settings.get("telegramNotifyOnRecovery", settings.get("notifyOnRecovery", True)))
            panel_down = bool(settings.get("panelNotifyOnDown", settings.get("notifyOnDown", True)))
            panel_up = bool(settings.get("panelNotifyOnRecovery", settings.get("notifyOnRecovery", True)))
            # What to monitor
            monitor_bot_api = bool(settings.get("monitorBotApi", True))
            monitor_rem_api = bool(settings.get("monitorRemnawaveApi", True))
            monitor_rem_nodes = bool(settings.get("monitorRemnawaveNodes", True)) and monitor_rem_api
            # Даже если уведомления отключены, мы всё равно обновляем статусы для UI

            logger.info(
                "[MONITORING] checking nodes (interval=%sms, notifications=%s)",
                settings.get("refreshInterval", 30000),
                "on" if telegram_enabled else "off",
            )

            refresh_interval = max(20000, settings.get("refreshInterval", 30000)) / 1000  # В секундах
            # Bot API check interval - check every cycle (same as nodes) for responsive status updates
            bot_api_check_interval_sec = max(20, int(settings.get("botApiCheckIntervalSec") or 20))

            # Читаем предыдущее состояние узлов/АПИ
            previous_state = read_json(monitoring_state_file, {})
            if not isinstance(previous_state, dict):
                previous_state = {}
            last_state = previous_state

            # Получаем профили бота.
            # Важно: UI работает с activeProfileId, поэтому минимум его нужно мониторить.
            bot_profiles_data = read_json(bot_profiles_file, {"profiles": [], "activeProfileId": None})
            bot_profiles = bot_profiles_data.get("profiles") or []
            if not isinstance(bot_profiles, list):
                bot_profiles = []
            active_bot_profile_id = str(bot_profiles_data.get("activeProfileId") or "").strip()
            # Fallback: first profile
            if not active_bot_profile_id and bot_profiles and isinstance(bot_profiles[0], dict) and bot_profiles[0].get("id"):
                active_bot_profile_id = str(bot_profiles[0].get("id"))

            # Monitor ALL bot profiles (otherwise statuses are only correct for the active/first profiles).
            # Keep unique by id.
            monitored_bot_profiles: list[dict] = []
            seen_ids: set[str] = set()
            for p in bot_profiles:
                if not isinstance(p, dict):
                    continue
                pid = str(p.get("id") or "")
                if not pid or pid in seen_ids:
                    continue
                monitored_bot_profiles.append(p)
                seen_ids.add(pid)

            monitored_bot_profile_ids = [str(p.get("id")) for p in monitored_bot_profiles if p.get("id")]

            # Получаем профили Remnawave (фильтруем по мониторимым botProfileIds)
            remnawave_profiles = load_remnawave_profiles()
            recipients = settings.get("recipients", [])

            # Даже если получателей нет, мы всё равно обновим state (это полезно для UI),
            # но Telegram отправлять не будем.

            # Шаблоны уведомлений (как в Settings). Custom templates removed: only presets allowed.
            tpl_key = str(settings.get("notificationTemplate") or "template2").strip() or "template2"
            if tpl_key in ("custom", "template3"):
                tpl_key = "template2"

            presets: Dict[str, Dict[str, str]] = {
                "template1": {
                    "down": "🔴 DOWN: {name} ({profile}) • {time}{error}",
                    "recovery": "🟢 UP: {name} ({profile}) • {time} • {downtime}",
                    "node_down": "🔴 NODE DOWN: {name} ({profile}) • {time}{error}",
                    "node_recovery": "🟢 NODE UP: {name} ({profile}) • {time} • {downtime}",
                },
                "template2": {
                    "down": "🔴 {name} недоступен\n━━━━━━━━━━━━━━━━━━\n📊 Профиль: {profile}\n🔗 {url}\n🕐 {time}{error}",
                    "recovery": "🟢 {name} восстановлен\n━━━━━━━━━━━━━━━━━━\n📊 Профиль: {profile}\n🔗 {url}\n🕐 {time}\n⏱ Время простоя: {downtime}",
                    "node_down": "🔴 Нода ({name}) недоступна\n━━━━━━━━━━━━━━━━━━\n📊 Профиль: {profile}\n🔗 {url}\n🕐 {time}{error}",
                    "node_recovery": "🟢 Нода ({name}) восстановлена\n━━━━━━━━━━━━━━━━━━\n📊 Профиль: {profile}\n🔗 {url}\n🕐 {time}\n⏱ Время простоя: {downtime}",
                },
            }

            tpl = presets.get(tpl_key) or presets["template2"]
            down_template = tpl["down"]
            recovery_template = tpl["recovery"]
            node_down_template = tpl["node_down"]
            node_recovery_template = tpl["node_recovery"]

            # ---- BOT API monitoring for all bot profiles ----
            now_ts = time.time()
            if not monitor_bot_api:
                now = datetime.now()
                for bp in monitored_bot_profiles:
                    bot_profile_id = str(bp.get("id") or "")
                    bot_profile_name = str(bp.get("name") or bot_profile_id)
                    bot_url = get_bot_api_base_url(bp)
                    if not bot_profile_id:
                        continue
                    bot_status_key = f"bot_api_status:{bot_profile_id}"
                    previous_state[bot_status_key] = {
                        "status": "disabled",
                        "timestamp": now.isoformat(),
                        "error": "Отключено в настройках мониторинга",
                        "profile_name": bot_profile_name,
                        "url": bot_url,
                        "ping_ms": None,
                        "checked_at_ts": float(now_ts),
                    }
            else:
                for bp in monitored_bot_profiles:
                    bot_profile_id = str(bp.get("id") or "")
                    bot_profile_name = str(bp.get("name") or bot_profile_id)
                    bot_url = get_bot_api_base_url(bp)
                    bot_token = str(bp.get("token") or "").strip()
                    if decrypt_token and bot_token:
                        bot_token = decrypt_token(bot_token)
                    bot_admin_id = str(bp.get("adminId") or "").strip()
                    if not bot_profile_id or not bot_url:
                        continue

                    bot_status_key = f"bot_api_status:{bot_profile_id}"
                    try:
                        prev_bot_state = previous_state.get(bot_status_key, {}) if isinstance(previous_state, dict) else {}
                        prev_bot_status = (prev_bot_state or {}).get("status", "unknown")

                        now = datetime.now()
                        current_bot_status = "offline"
                        err = ""
                        ping_ms: Optional[int] = None

                        # Throttle checks (avoid spamming bot logs): reuse previous state if too soon.
                        last_check_ts = 0.0
                        try:
                            last_check_ts = float((prev_bot_state or {}).get("checked_at_ts") or 0)
                        except Exception:
                            last_check_ts = 0.0

                        if last_check_ts and (now_ts - last_check_ts) < float(bot_api_check_interval_sec):
                            current_bot_status = str((prev_bot_state or {}).get("status") or "unknown")
                            err = str((prev_bot_state or {}).get("error") or "").strip()
                            ping_ms = (prev_bot_state or {}).get("ping_ms")
                        else:
                            last_status: Optional[int] = None
                            try:
                                # Hard stop even if http client hangs (DNS/SSL edge cases etc)
                                async with asyncio.timeout(15):
                                    t0 = time.time()
                                    timeout = httpx.Timeout(connect=5.0, read=10.0, write=10.0, pool=5.0)
                                    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                                        headers = {"Accept": "application/json"}
                                        if bot_token:
                                            headers["X-Token"] = bot_token
                                        params: Dict[str, Any] = {}
                                        if bot_admin_id:
                                            params["tg_id"] = bot_admin_id
                                        r = await client.get(f"{bot_url}/status", headers=headers, params=params)
                                        last_status = r.status_code
                                    ping_ms = int((time.time() - t0) * 1000)
                                if last_status is None:
                                    current_bot_status = "offline"
                                    err = "BOT API недоступен"
                                elif last_status >= 500:
                                    current_bot_status = "offline"
                                    err = f"BOT API недоступен (HTTP {last_status})"
                                elif last_status >= 400:
                                    current_bot_status = "warning"
                                    err = f"Проблема авторизации/доступа (HTTP {last_status})"
                                else:
                                    current_bot_status = "online"
                                    err = ""
                            except TimeoutError:
                                current_bot_status = "offline"
                                err = "BOT API timeout"
                            except Exception as e:
                                current_bot_status = "offline"
                                err = str(e).strip() or type(e).__name__

                        # If BOT API is offline but we have an empty error string,
                        # show a generic reason so the "Простой" template always includes the cause.
                        if current_bot_status == "offline" and not str(err or "").strip():
                            err = "BOT API недоступен"

                        offline_since = (prev_bot_state or {}).get("offline_since")
                        if current_bot_status == "offline":
                            if prev_bot_status != "offline":
                                offline_since = now.isoformat()
                            if not offline_since:
                                offline_since = now.isoformat()

                        next_bot_state: Dict[str, Any] = {
                            "status": current_bot_status,
                            "timestamp": now.isoformat(),  # last check
                            "error": err,
                            "profile_name": bot_profile_name,
                            "url": bot_url,
                            "ping_ms": ping_ms,
                            "checked_at_ts": float(now_ts),
                        }
                        if current_bot_status == "offline":
                            next_bot_state["offline_since"] = offline_since
                        previous_state[bot_status_key] = next_bot_state

                        # Web-panel notifications: persist incidents only when enabled.
                        if panel_enabled and panel_down and current_bot_status == "offline" and prev_bot_status != "offline":
                            _append_status_notification(
                                notifications_state_file,
                                title="BOT API недоступен",
                                message=f"Профиль: {bot_profile_name} • BOT API перестал отвечать{f' • {err}' if err else ''}",
                                kind="bot_api_down",
                                profile_id=bot_profile_id,
                            )
                        elif panel_enabled and panel_up and current_bot_status == "online" and prev_bot_status == "offline":
                            downtime_str = "Неизвестно"
                            offline_since_ts = (prev_bot_state or {}).get("offline_since") or (prev_bot_state or {}).get("timestamp")
                            if offline_since_ts:
                                try:
                                    prev_time = datetime.fromisoformat(str(offline_since_ts))
                                    downtime = now - prev_time
                                    total_seconds = int(downtime.total_seconds())
                                    hours = total_seconds // 3600
                                    minutes = (total_seconds % 3600) // 60
                                    seconds = total_seconds % 60
                                    downtime_str = f"{hours}ч {minutes}м {seconds}с"
                                except Exception:
                                    pass
                            _append_status_notification(
                                notifications_state_file,
                                title="BOT API восстановлен",
                                message=f"Профиль: {bot_profile_name} • BOT API снова работает • Простой: {downtime_str}",
                                kind="bot_api_up",
                                profile_id=bot_profile_id,
                            )

                        # Telegram notifications: only when enabled and configured.
                        if telegram_enabled and recipients:
                            if tg_down and current_bot_status == "offline" and prev_bot_status != "offline":
                                node_like = {"name": "Api bot", "ip": bot_url, "error": err}
                                message = format_notification(down_template, node_like, True, None, bot_profile_name)
                                try:
                                    async with asyncio.timeout(45):
                                        await send_notifications_to_recipients(
                                            message,
                                            recipients,
                                            [bot_profile_id],
                                            f"Уведомление о недоступности BOT API профиля {bot_profile_name}",
                                        )
                                except TimeoutError:
                                    logger.warning("[MONITORING] telegram send timeout (bot api down) profile=%s", bot_profile_id)
                            elif tg_up and current_bot_status == "online" and prev_bot_status == "offline":
                                downtime_str = "Неизвестно"
                                offline_since_ts = (prev_bot_state or {}).get("offline_since") or (prev_bot_state or {}).get("timestamp")
                                if offline_since_ts:
                                    try:
                                        prev_time = datetime.fromisoformat(str(offline_since_ts))
                                        downtime = now - prev_time
                                        total_seconds = int(downtime.total_seconds())
                                        hours = total_seconds // 3600
                                        minutes = (total_seconds % 3600) // 60
                                        seconds = total_seconds % 60
                                        downtime_str = f"{hours}ч {minutes}м {seconds}с"
                                    except Exception:
                                        pass
                                node_like = {"name": "Api bot", "ip": bot_url, "error": ""}
                                message = format_notification(recovery_template, node_like, False, downtime_str, bot_profile_name)
                                try:
                                    async with asyncio.timeout(45):
                                        await send_notifications_to_recipients(
                                            message,
                                            recipients,
                                            [bot_profile_id],
                                            f"Уведомление о восстановлении BOT API профиля {bot_profile_name}",
                                        )
                                except TimeoutError:
                                    logger.warning("[MONITORING] telegram send timeout (bot api up) profile=%s", bot_profile_id)
                    except Exception as e:
                        # One broken profile must not stop the entire monitoring loop.
                        previous_state[bot_status_key] = {
                            "status": "offline",
                            "timestamp": datetime.now().isoformat(),
                            "error": f"profile error: {type(e).__name__}: {e}",
                            "profile_name": bot_profile_name,
                            "url": bot_url,
                            "ping_ms": None,
                            "checked_at_ts": float(time.time()),
                        }
                        logger.exception("[MONITORING] bot profile loop error profile=%s", bot_profile_id)
                        continue

            # Проходим по профилям Remnawave, которые привязаны к мониторимым botProfileIds
            for profile in remnawave_profiles:
              try:
                if not isinstance(profile, dict):
                    continue
                bot_profile_ids = profile.get("botProfileIds", [])
                if not bot_profile_ids:
                    continue
                if monitored_bot_profile_ids and not any(pid in monitored_bot_profile_ids for pid in bot_profile_ids):
                    continue

                settings_data = profile.get("settings", {})
                base_url = settings_data.get("base_url", "").strip()
                token = settings_data.get("token", "").strip()

                if not base_url:
                    continue

                profile_id = profile.get("id", "unknown")
                profile_name = profile.get("name", profile_id)

                # Ключ для отслеживания статуса API профиля
                api_status_key = f"api_status:{profile_id}"
                previous_api_state = previous_state.get(api_status_key, {}) if isinstance(previous_state, dict) else {}
                previous_api_status = (previous_api_state or {}).get("status", "unknown")

                if not monitor_rem_api:
                    now = datetime.now()
                    disabled_state: Dict[str, Any] = {
                        "status": "disabled",
                        "timestamp": now.isoformat(),
                        "error": "Отключено в настройках мониторинга",
                        "profile_name": profile_name,
                        "url": base_url,
                        "ping_ms": None,
                    }
                    previous_state[api_status_key] = disabled_state
                    for bpid in bot_profile_ids:
                        previous_state[f"api_status:{bpid}"] = dict(disabled_state)
                    continue

                # Проверяем узлы (hard timeout to avoid stuck await)
                try:
                    async with asyncio.timeout(60):
                        result = await check_nodes_status(profile_id, base_url, token)
                except TimeoutError:
                    result = {"nodes": [], "error": "Timeout (60s)", "responseTime": None}
                except Exception as exc:
                    _msg = str(exc).strip() or type(exc).__name__
                    result = {"nodes": [], "error": _msg, "responseTime": None}

                nodes = result.get("nodes", [])
                api_error = result.get("error")
                api_error = _extract_reason(api_error) or None
                api_ping_ms = result.get("responseTime")

                # Определяем текущий статус API
                current_api_status = "offline" if api_error else "online"
                now = datetime.now()

                offline_since = (previous_api_state or {}).get("offline_since")
                if current_api_status == "offline":
                    if previous_api_status != "offline":
                        offline_since = now.isoformat()
                    if not offline_since:
                        offline_since = now.isoformat()

                # Сохраняем текущий статус API
                next_api_state: Dict[str, Any] = {
                    "status": current_api_status,
                    "timestamp": now.isoformat(),
                    "error": api_error or "",
                    "profile_name": profile_name,
                    "url": base_url,
                    "ping_ms": api_ping_ms,
                }
                if current_api_status == "offline":
                    next_api_state["offline_since"] = offline_since
                previous_state[api_status_key] = next_api_state

                # Также сохраняем статус API по ID профилей бота (для фронтенда)
                for bpid in bot_profile_ids:
                    previous_state[f"api_status:{bpid}"] = dict(next_api_state)

                # --- Уведомления об изменении статуса API ---
                if current_api_status == "offline" and previous_api_status != "offline":
                    if panel_down or tg_down:
                        error_msg = api_error or "Неизвестная ошибка"
                        logger.warning("[MONITORING] Remnawave API down profile=%s (%s): %s", profile_name, profile_id, error_msg)
                        if panel_enabled and panel_down:
                            _append_status_notification(
                                notifications_state_file, title="Remnawave API недоступен",
                                message=f"Профиль: {profile_name} • Remnawave API перестал отвечать • {error_msg}",
                                kind="rem_api_down", profile_id=str(profile_id),
                            )
                        if telegram_enabled and tg_down and recipients:
                            node_like = {"name": "Remnawave API", "ip": base_url, "error": error_msg}
                            msg = format_notification(down_template, node_like, True, None, profile_name)
                            try:
                                async with asyncio.timeout(45):
                                    await send_notifications_to_recipients(msg, recipients, bot_profile_ids, f"Remnawave API down: {profile_name}")
                            except TimeoutError:
                                logger.warning("[MONITORING] telegram send timeout (rem api down) profile=%s", profile_id)

                elif current_api_status == "online" and previous_api_status == "offline":
                    downtime_str = "Неизвестно"
                    offline_since_ts = (previous_api_state or {}).get("offline_since") or (previous_api_state or {}).get("timestamp")
                    if offline_since_ts:
                        try:
                            prev_time = datetime.fromisoformat(str(offline_since_ts))
                            downtime_str = _format_downtime_seconds(int((now - prev_time).total_seconds()))
                        except Exception:
                            pass
                    logger.info("[MONITORING] Remnawave API recovered profile=%s (%s). downtime=%s", profile_name, profile_id, downtime_str)
                    if panel_up or tg_up:
                        if panel_enabled and panel_up:
                            _append_status_notification(
                                notifications_state_file, title="Remnawave API восстановлен",
                                message=f"Профиль: {profile_name} • Remnawave API снова работает • Простой: {downtime_str}",
                                kind="rem_api_up", profile_id=str(profile_id),
                            )
                        if telegram_enabled and tg_up and recipients:
                            node_like = {"name": "Remnawave API", "ip": base_url, "error": ""}
                            msg = format_notification(recovery_template, node_like, False, downtime_str, profile_name)
                            try:
                                async with asyncio.timeout(45):
                                    await send_notifications_to_recipients(msg, recipients, bot_profile_ids, f"Remnawave API up: {profile_name}")
                            except TimeoutError:
                                logger.warning("[MONITORING] telegram send timeout (rem api up) profile=%s", profile_id)

                if api_error:
                    logger.debug("[MONITORING] API unavailable for profile=%s; skip nodes check", profile_id)
                    continue

                if not monitor_rem_nodes:
                    # Do not persist per-node state/notifications when nodes monitoring is disabled.
                    continue

                logger.debug("[MONITORING] profile=%s nodes=%s", profile_id, len(nodes))

                # --- Обрабатываем каждый узел ---
                for node in nodes:
                    node_id = str(node.get("id", node.get("name", "unknown")))
                    state_key = get_node_state_key(profile_id, node_id)
                    node_name = node.get("name", node_id)

                    current_status = get_node_status(node)
                    previous_node_state = previous_state.get(state_key, {})
                    previous_status = previous_node_state.get("status", "unknown")
                    previous_timestamp = previous_node_state.get("timestamp")
                    previous_offline_since = previous_node_state.get("offline_since")

                    now = datetime.now()

                    # Offline since
                    offline_since = None
                    if current_status == "offline":
                        offline_since = previous_offline_since
                        if previous_status != "offline":
                            offline_since = now.isoformat()
                        if not offline_since:
                            offline_since = now.isoformat()

                    next_node_state: Dict[str, Any] = {
                        "status": current_status,
                        "timestamp": now.isoformat(),
                        "node_name": node_name,
                    }
                    online_users = _extract_node_online_users(node if isinstance(node, dict) else None)
                    if online_users is not None:
                        next_node_state["online_users"] = int(online_users)
                    country_code = _extract_node_country_code(node if isinstance(node, dict) else None)
                    if country_code:
                        next_node_state["country_code"] = str(country_code)
                    if current_status == "offline":
                        next_node_state["offline_since"] = offline_since
                    previous_state[state_key] = next_node_state

                    # Дублируем под botProfileIds для фронтенда
                    for bpid in bot_profile_ids:
                        previous_state[get_node_state_key(str(bpid), node_id)] = dict(next_node_state)

                    is_first_check = previous_status == "unknown" or not previous_node_state

                    # Первая проверка offline -> ставим флаг
                    if is_first_check and current_status == "offline":
                        previous_state[state_key]["first_check_offline"] = True
                        for bpid in bot_profile_ids:
                            bk = get_node_state_key(str(bpid), node_id)
                            if bk in previous_state and isinstance(previous_state[bk], dict):
                                previous_state[bk]["first_check_offline"] = True

                    # --- Уведомления о смене статуса узла ---
                    if previous_status != current_status:
                        if current_status == "offline" and previous_status == "online" and (panel_down or tg_down):
                            logger.info("[MONITORING] node down: %s (%s -> %s)", node_name, previous_status, current_status)
                            reason = _extract_node_reason(node if isinstance(node, dict) else {}) or "Причина неизвестна"
                            reason_text = f" • Причина: {reason}"
                            if panel_enabled and panel_down:
                                _append_status_notification(
                                    notifications_state_file, title="Нода недоступна",
                                    message=f"Профиль: {profile_name} • Нода: {node_name} • Статус: offline{reason_text}",
                                    kind="node_down", profile_id=str(profile_id), node_id=str(node_id),
                                    country_code=country_code,
                                )
                            if telegram_enabled and tg_down and recipients and node_down_template:
                                node_for_tpl = dict(node or {})
                                node_for_tpl["name"] = str(node_name)
                                node_for_tpl["error"] = reason or "Причина неизвестна"
                                msg = format_notification(node_down_template, node_for_tpl, True, None, profile_name)
                                try:
                                    async with asyncio.timeout(45):
                                        await send_notifications_to_recipients(msg, recipients, bot_profile_ids, f"Node down: {node_name}")
                                except TimeoutError:
                                    logger.warning("[MONITORING] telegram send timeout (node down) profile=%s node=%s", profile_id, node_id)

                        elif current_status == "online" and previous_status == "offline" and (panel_up or tg_up):
                            logger.info("[MONITORING] node recovered: %s (%s -> %s)", node_name, previous_status, current_status)
                            downtime_str = "Неизвестно"
                            offline_since_ts = previous_offline_since or previous_timestamp
                            if offline_since_ts:
                                try:
                                    prev_time = datetime.fromisoformat(str(offline_since_ts))
                                    downtime_str = _format_downtime_seconds(int((now - prev_time).total_seconds()))
                                except Exception:
                                    pass
                            if panel_enabled and panel_up:
                                _append_status_notification(
                                    notifications_state_file, title="Нода восстановлена",
                                    message=f"Профиль: {profile_name} • Нода: {node_name} • Простой: {downtime_str}",
                                    kind="node_up", profile_id=str(profile_id), node_id=str(node_id),
                                    country_code=country_code,
                                )
                            if telegram_enabled and tg_up and recipients and node_recovery_template:
                                node_for_tpl = dict(node or {})
                                node_for_tpl["name"] = str(node_name)
                                msg = format_notification(node_recovery_template, node_for_tpl, False, downtime_str, profile_name)
                                try:
                                    async with asyncio.timeout(45):
                                        await send_notifications_to_recipients(msg, recipients, bot_profile_ids, f"Node up: {node_name}")
                                except TimeoutError:
                                    logger.warning("[MONITORING] telegram send timeout (node up) profile=%s node=%s", profile_id, node_id)

                    # Стабильный offline (2 проверки подряд)
                    if current_status == "offline" and previous_status == "offline" and (panel_down or tg_down):
                        first_check_offline = previous_node_state.get("first_check_offline", False)
                        if first_check_offline:
                            logger.info("[MONITORING] node stable offline: %s (still %s)", node_name, current_status)
                            previous_state[state_key]["first_check_offline"] = False

                            # Stable offline: use selected node template (no custom templates).
                            stable_tpl = node_down_template
                            reason = _extract_node_reason(node if isinstance(node, dict) else {}) or "Причина неизвестна"
                            reason_text = f" • Причина: {reason}"
                            if panel_enabled and panel_down:
                                _append_status_notification(
                                    notifications_state_file, title="Нода стабильно offline",
                                    message=f"Профиль: {profile_name} • Нода: {node_name} • Offline 2 проверки подряд{reason_text}",
                                    kind="node_stable_offline", profile_id=str(profile_id), node_id=str(node_id),
                                    country_code=country_code,
                                )
                            if telegram_enabled and tg_down and recipients and stable_tpl:
                                node_for_tpl = dict(node or {})
                                node_for_tpl["name"] = str(node_name)
                                node_for_tpl["error"] = reason or "Причина неизвестна"
                                msg = format_notification(stable_tpl, node_for_tpl, True, None, profile_name)
                                try:
                                    async with asyncio.timeout(45):
                                        await send_notifications_to_recipients(msg, recipients, bot_profile_ids, f"Stable offline: {node_name}")
                                except TimeoutError:
                                    logger.warning("[MONITORING] telegram send timeout (stable offline) profile=%s", profile_id)
              except Exception:
                logger.exception("[MONITORING] remnawave profile loop error profile=%s", profile.get("id", "?") if isinstance(profile, dict) else "?")
                continue

            # Всегда сохраняем текущее состояние (даже если Remnawave профилей нет).
            write_json(monitoring_state_file, previous_state)

            await asyncio.sleep(refresh_interval)
        except Exception:
            logger.exception("[MONITORING] error in monitoring loop")
            # Try to persist last error into state so UI doesn't look frozen with no clues.
            try:
                st = last_state if isinstance(last_state, dict) else {}
                st["__monitoring_error__"] = {
                    "ts": time.time(),
                    "pid": os.getpid(),
                    "error": "monitoring loop crashed; see backend logs for stacktrace",
                }
                write_json(monitoring_state_file, st)
            except Exception:
                pass
            await asyncio.sleep(30)  # При ошибке ждем 30 секунд перед повтором


async def collect_online_history_loop_impl(
    *,
    read_json: ReadJsonFn,
    load_remnawave_profiles: LoadRemnawaveProfilesFn,
    remnawave_get_json: RemnawaveGetJsonFn,
    sum_online_from_nodes: SumOnlineFromNodesFn,
    extract_online_users_count: ExtractOnlineUsersCountFn,
    append_online_history: AppendOnlineHistoryFn,
    monitoring_settings_file: Any,
) -> None:
    """
    Фоновый сбор онлайна пользователей Remnawave для графика на дашборте.
    """
    import asyncio
    import time as _time

    logger.info("[ONLINE] starting remnawave online collection loop...")
    while True:
        try:
            settings = read_json(monitoring_settings_file, {})
            interval_ms = int(max(45_000, (settings or {}).get("refreshInterval", 45_000)))

            remnawave_profiles = load_remnawave_profiles()
            if not remnawave_profiles:
                await asyncio.sleep(60)
                continue

            now_ms = int(_time.time() * 1000)

            for profile in remnawave_profiles:
                if not isinstance(profile, dict):
                    continue
                bot_profile_ids = profile.get("botProfileIds") or []
                if not bot_profile_ids:
                    continue

                settings_data = profile.get("settings") or {}
                base_url = str(settings_data.get("base_url") or "").strip()
                token = str(settings_data.get("token") or "").strip()
                if not base_url:
                    continue

                # 1) Самый точный вариант: суммируем онлайн по узлам
                try:
                    async with asyncio.timeout(45):
                        nodes_payload = await remnawave_get_json(base_url, token, "api/nodes")
                except (TimeoutError, Exception):
                    nodes_payload = None
                count = sum_online_from_nodes(nodes_payload)

                # 2) Fallback: system stats
                if count is None:
                    try:
                        async with asyncio.timeout(30):
                            payload = await remnawave_get_json(base_url, token, "api/system/stats")
                    except (TimeoutError, Exception):
                        payload = None
                    count = extract_online_users_count(payload)

                # 3) Fallback: realtime usage по узлам
                if count is None:
                    try:
                        async with asyncio.timeout(30):
                            payload2 = await remnawave_get_json(base_url, token, "api/nodes/usage/realtime")
                    except (TimeoutError, Exception):
                        payload2 = None
                    count = extract_online_users_count(payload2)

                if count is None:
                    continue

                append_online_history([str(x) for x in bot_profile_ids], now_ms, int(count))

            await asyncio.sleep(interval_ms / 1000)
        except Exception:
            logger.exception("[ONLINE] error in online collection loop")
            await asyncio.sleep(30)


async def session_cleanup_loop_impl(*, cleanup_expired_sessions: CleanupSessionsFn) -> None:
    """Периодическая очистка истёкших сессий"""
    import asyncio

    while True:
        try:
            cleanup_expired_sessions()
        except Exception:
            logger.exception("[AUTH] error during session cleanup")
        await asyncio.sleep(3600)  # Каждый час

