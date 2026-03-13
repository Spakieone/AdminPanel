from __future__ import annotations

from typing import Any, Dict, Optional

import httpx


def _extract_online_users_count(payload: Any) -> Optional[int]:
    """
    Пытаемся вытащить количество пользователей онлайн из разных форматов ответа Remnawave.
    Формат не фиксируем жёстко: ищем подходящие числовые поля по ключам.
    """
    if payload is None:
        return None

    # Нормализация "плоских" кейсов
    if isinstance(payload, bool):
        return None
    if isinstance(payload, (int, float)) and payload >= 0:
        return int(payload)

    if isinstance(payload, dict):
        # Частые варианты ключей
        candidates = [
            "online_users",
            "users_online",
            "onlineUsers",
            "usersOnline",
            "online_users_count",
            "onlineCount",
            "online_count",
            "online",
            "usersOnlineCount",
        ]
        for k in candidates:
            if k in payload:
                raw = payload.get(k)
                if isinstance(raw, bool):
                    continue
                if isinstance(raw, (int, float)):
                    v = int(raw)
                    if v >= 0:
                        return v
                if isinstance(raw, str):
                    try:
                        v = int(raw)
                        if v >= 0:
                            return v
                    except Exception:
                        pass

        # Вложенные варианты
        for k in ("users", "user", "stats", "system", "data", "result", "response"):
            v = payload.get(k)
            if v is not None:
                found = _extract_online_users_count(v)
                if found is not None:
                    return found

        # Фолбэк: рекурсивно ищем поля где key содержит online + user
        for key, val in payload.items():
            if not isinstance(key, str):
                continue
            key_l = key.lower()
            if ("online" in key_l and "user" in key_l) or ("users" in key_l and "online" in key_l):
                if isinstance(val, (int, float)) and int(val) >= 0:
                    return int(val)
                found = _extract_online_users_count(val)
                if found is not None:
                    return found

        # Последний шанс: пройдёмся по значениям, но избегаем boolean
        for val in payload.values():
            if isinstance(val, bool):
                continue
            found = _extract_online_users_count(val)
            if found is not None:
                return found

    if isinstance(payload, list):
        for item in payload:
            found = _extract_online_users_count(item)
            if found is not None:
                return found

    return None


def _extract_nodes_list(payload: Any) -> list[Dict[str, Any]]:
    """Достаёт список узлов Remnawave из разных форматов ответа."""
    if payload is None:
        return []
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    if isinstance(payload, dict):
        # Частые оболочки
        for k in ("nodes", "data", "result", "response"):
            v = payload.get(k)
            if isinstance(v, list):
                return [x for x in v if isinstance(x, dict)]
            if isinstance(v, dict) and "nodes" in v and isinstance(v.get("nodes"), list):
                return [x for x in v.get("nodes") if isinstance(x, dict)]
    return []


def _sum_online_from_nodes(payload: Any) -> Optional[int]:
    """
    Считает онлайн пользователей как сумму по узлам (это то же число, что видно в таблице узлов).
    Важно: поле `online` может быть boolean в некоторых форматах — такие значения игнорируем.
    """
    nodes = _extract_nodes_list(payload)
    if not nodes:
        return None

    keys = (
        "onlineUsers",
        "usersOnline",
        "online_users",
        "users_online",
        "onlineCount",
        "online_count",
        "usersOnlineCount",
        "online",  # бывает и числом, и boolean
    )

    total = 0
    seen_numeric = False
    for node in nodes:
        val: Any = None
        for k in keys:
            if k in node:
                val = node.get(k)
                break

        if isinstance(val, bool):
            continue
        if isinstance(val, (int, float)):
            n = int(val)
            if n >= 0:
                total += n
                seen_numeric = True
            continue
        if isinstance(val, str):
            try:
                n = int(val)
                if n >= 0:
                    total += n
                    seen_numeric = True
            except Exception:
                pass

    return total if seen_numeric else None


async def _remnawave_get_json(base_url: str, token: str, upstream_path: str) -> Optional[Any]:
    """GET JSON из Remnawave, используется фоновой задачей (без Request)."""
    url = base_url.rstrip("/") + "/" + upstream_path.lstrip("/")
    headers: Dict[str, str] = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    timeout = httpx.Timeout(connect=10.0, read=30.0, write=30.0, pool=10.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        try:
            resp = await client.get(url, headers=headers)
            if resp.status_code >= 400:
                return None
            return resp.json()
        except Exception:
            return None

