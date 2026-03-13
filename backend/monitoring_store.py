import logging
import threading
from pathlib import Path
from typing import Any, Dict

from json_store import _read_json, _write_json

logger = logging.getLogger(__name__)

_online_history_lock = threading.Lock()


def _remove_online_history_for_bot_profiles(online_history_file: Path, bot_profile_ids: list[str]) -> None:
    """Удаляет историю онлайна для указанных bot-profile ids."""
    if not bot_profile_ids:
        return

    with _online_history_lock:
        history = _read_json(online_history_file, [])
        if not isinstance(history, list):
            return

        bot_profile_ids_str = {str(pid) for pid in bot_profile_ids}
        original_count = len(history)
        history = [h for h in history if isinstance(h, dict) and str(h.get("profile_id") or "") not in bot_profile_ids_str]
        removed_count = original_count - len(history)

        if removed_count > 0:
            _write_json(online_history_file, history)
            logger.info("[ONLINE] Удалено %d записей истории для профилей: %s", removed_count, ', '.join(bot_profile_ids_str))


def _remove_telegram_sessions_for_bot_profiles(telegram_sessions_dir: Path, bot_profile_ids: list[str]) -> None:
    """Удаляет файлы сессий Telegram для указанных bot-profile ids."""
    if not telegram_sessions_dir.exists():
        return

    removed_count = 0
    try:
        # Удаляем все файлы .session, так как они могут быть связаны с удаляемыми профилями
        # Файлы .session не используются в текущей версии (уведомления через Bot API)
        for session_file in telegram_sessions_dir.glob("*.session"):
            try:
                session_file.unlink()
                removed_count += 1
            except Exception as e:
                logger.warning("[CLEANUP] Не удалось удалить сессию %s: %s", session_file.name, e)

        if removed_count > 0:
            logger.info("[CLEANUP] Удалено %d файлов сессий Telegram", removed_count)
    except Exception as e:
        logger.warning("[CLEANUP] Ошибка при удалении сессий Telegram: %s", e)


def _remove_monitoring_state_for_profile(monitoring_state_file: Path, remnawave_profile_id: str, bot_profile_ids: list[str]) -> None:
    """Удаляет данные мониторинга для профиля Remnawave и связанных bot-profile ids."""
    state = _read_json(monitoring_state_file, {})
    if not isinstance(state, dict):
        return

    profile_id_str = str(remnawave_profile_id)
    bot_profile_ids_str = {str(pid) for pid in bot_profile_ids}

    keys_to_remove: list[str] = []
    # Ищем все ключи для удаления
    for key in list(state.keys()):
        # Ключи узлов: {remnawave_profile_id}:{node_id}
        if key.startswith(f"{profile_id_str}:"):
            keys_to_remove.append(key)
        # Статус API: api_status:{remnawave_profile_id}
        elif key == f"api_status:{profile_id_str}":
            keys_to_remove.append(key)
        # Статус BOT API: bot_api_status:{bot_profile_id}
        elif key.startswith("bot_api_status:"):
            key_suffix = key.split(":", 1)[1] if ":" in key else ""
            if key_suffix in bot_profile_ids_str:
                keys_to_remove.append(key)
        # Статус API по bot_profile_id: api_status:{bot_profile_id}
        elif key.startswith("api_status:"):
            key_suffix = key.split(":", 1)[1] if ":" in key else ""
            if key_suffix in bot_profile_ids_str:
                keys_to_remove.append(key)
        # Дублирование узлов под bot_profile_id: {bot_profile_id}:{node_id}
        elif ":" in key:
            prefix = key.split(":")[0]
            if prefix in bot_profile_ids_str:
                keys_to_remove.append(key)

    for key in keys_to_remove:
        state.pop(key, None)

    if keys_to_remove:
        _write_json(monitoring_state_file, state)
        logger.info("[MONITORING] Удалено %d записей состояния мониторинга для профиля %s", len(keys_to_remove), profile_id_str)


def _append_online_history(online_history_file: Path, bot_profile_ids: list[str], timestamp_ms: int, count: int) -> None:
    """Добавляет точки онлайна в JSON историю для одного/нескольких bot-profile ids."""
    if not bot_profile_ids:
        return
    if timestamp_ms <= 0 or count < 0:
        return

    with _online_history_lock:
        history = _read_json(online_history_file, [])
        if not isinstance(history, list):
            history = []

        recent_cutoff = timestamp_ms - 20_000
        last_by_profile: Dict[str, Dict[str, Any]] = {}
        for item in reversed(history[-500:]):
            if not isinstance(item, dict):
                continue
            pid = str(item.get("profile_id") or "")
            if not pid or pid in last_by_profile:
                continue
            last_by_profile[pid] = item
            if len(last_by_profile) >= 50:
                break

        for pid in bot_profile_ids:
            pid_str = str(pid)
            last = last_by_profile.get(pid_str)
            if last:
                try:
                    last_ts = int(last.get("timestamp") or 0)
                    last_count = int(last.get("count") or -1)
                    if last_ts >= recent_cutoff and last_count == int(count):
                        continue
                except Exception:
                    pass

            history.append({"timestamp": int(timestamp_ms), "count": int(count), "profile_id": pid_str})

        # Keep only the last 7 days to avoid unbounded growth and UI lag on week view.
        week_cutoff = timestamp_ms - 7 * 24 * 60 * 60 * 1000
        history = [h for h in history if isinstance(h, dict) and int(h.get("timestamp") or 0) >= week_cutoff]

        # Safety cap for pathological cases with too many writes.
        max_records = 30_000
        if len(history) > max_records:
            history = history[-max_records:]

        _write_json(online_history_file, history)

