import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import HTTPException

from json_store import _read_json, _write_json

_notifications_state_lock = threading.Lock()


DEFAULT_STATE: Dict[str, Any] = {
    "read_ids": [],
    "dismissed_before": 0,
    "status_notifications": [],
    "updated_at": 0,
}


def _parse_iso(dt: Any) -> Optional[float]:
    try:
        s = str(dt or "").strip()
        if not s:
            return None
        from datetime import datetime
        # normalize trailing Z -> +00:00 for Python fromisoformat
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        return datetime.fromisoformat(s).timestamp()
    except Exception:
        return None


def _format_downtime(seconds: int) -> str:
    if seconds < 0:
        seconds = 0
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    return f"{h}ч {m}м {s}с"


def _normalize_status_notifications(items: list[dict]) -> list[dict]:
    """
    Normalize legacy status notifications in storage:
    - recovery events -> type=success (green)
    - down/offline events -> type=error (red)
    - recompute downtime for node_up using matching node_down timestamps (so it's not stuck at refresh interval)
    """
    out: list[dict] = [dict(x) for x in items if isinstance(x, dict)]

    # Sort by date asc for pairing down->up
    tmp: list[tuple[float, dict]] = []
    for it in out:
        ts = _parse_iso(it.get("date"))
        if ts is None:
            continue
        tmp.append((ts, it))
    tmp.sort(key=lambda x: x[0])

    last_down_by_key: dict[str, float] = {}
    for ts, it in tmp:
        data = it.get("data") if isinstance(it.get("data"), dict) else {}
        kind = str(data.get("kind") or it.get("kind") or "").strip()
        profile_id = str(data.get("profile_id") or "")
        node_id = str(data.get("node_id") or "")

        # Type by kind
        if kind.endswith("_up") or kind in ("node_up", "bot_api_up", "rem_api_up"):
            it["type"] = "success"
        elif kind.endswith("_down") or "offline" in kind or kind in ("node_down", "node_stable_offline", "bot_api_down", "rem_api_down"):
            it["type"] = "error"

        # Downtime recompute for node up
        if kind == "node_down" and profile_id and node_id:
            last_down_by_key[f"node|{profile_id}|{node_id}"] = ts
        elif kind == "node_up" and profile_id and node_id:
            k = f"node|{profile_id}|{node_id}"
            down_ts = last_down_by_key.get(k)
            if down_ts is not None and ts >= down_ts:
                dt_s = int(ts - down_ts)
                msg = str(it.get("message") or "")
                parts = msg.split(" • ") if msg else []
                replaced = False
                for i, p in enumerate(parts):
                    if p.strip().lower().startswith("простой:"):
                        parts[i] = f"Простой: {_format_downtime(dt_s)}"
                        replaced = True
                        break
                if parts and not replaced:
                    parts.append(f"Простой: {_format_downtime(dt_s)}")
                if parts:
                    it["message"] = " • ".join(parts)

    return out


def _sanitize_state(raw: Any) -> Dict[str, Any]:
    data = raw if isinstance(raw, dict) else dict(DEFAULT_STATE)

    read_ids = data.get("read_ids")
    if not isinstance(read_ids, list):
        read_ids = []
    read_ids = [x for x in read_ids if isinstance(x, str)]

    dismissed_before = data.get("dismissed_before")
    if not isinstance(dismissed_before, (int, float)):
        dismissed_before = 0

    status_notifications = data.get("status_notifications")
    if not isinstance(status_notifications, list):
        status_notifications = []
    status_notifications = [x for x in status_notifications if isinstance(x, dict)]
    status_notifications = _normalize_status_notifications(status_notifications[:200])

    return {
        "read_ids": read_ids,
        "dismissed_before": int(dismissed_before),
        "status_notifications": status_notifications[:200],
        "updated_at": int(data.get("updated_at") or 0),
    }


def get_notifications_state(file_path: Path) -> Dict[str, Any]:
    data = _read_json(file_path, dict(DEFAULT_STATE))
    return _sanitize_state(data)


def save_notifications_state(file_path: Path, payload: Any) -> Dict[str, Any]:
    """
    Persist read_ids on server.

    Supported payload shapes:
      - { mode: "merge"|"replace", read_ids: string[] }
      - dismissed_before: number (ms)
      - status_notifications: dict[]
      - clear_status_notifications: boolean
      - append_status_notification: dict
    """
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")

    mode = str(payload.get("mode") or "merge").lower()
    incoming = payload.get("read_ids") or payload.get("readIds") or payload.get("ids")
    if incoming is not None and not isinstance(incoming, list):
        raise HTTPException(status_code=400, detail="read_ids must be a list")
    incoming_ids = [x for x in (incoming or []) if isinstance(x, str)]

    dismissed_before = payload.get("dismissed_before")
    if dismissed_before is None:
        dismissed_before = payload.get("dismissedBefore")
    if dismissed_before is None:
        dismissed_before = payload.get("dismissed_before_ms")
    if dismissed_before is not None and not isinstance(dismissed_before, (int, float)):
        raise HTTPException(status_code=400, detail="dismissed_before must be a number")

    status_notifications_in = payload.get("status_notifications")
    clear_status = bool(payload.get("clear_status_notifications") or payload.get("clearStatusNotifications") or False)
    append_status = payload.get("append_status_notification") or payload.get("appendStatusNotification")

    if status_notifications_in is not None and not isinstance(status_notifications_in, list):
        raise HTTPException(status_code=400, detail="status_notifications must be a list")
    if append_status is not None and not isinstance(append_status, dict):
        raise HTTPException(status_code=400, detail="append_status_notification must be an object")

    with _notifications_state_lock:
        current = _read_json(file_path, dict(DEFAULT_STATE))
        current = _sanitize_state(current)

        cur_ids = current.get("read_ids") if isinstance(current.get("read_ids"), list) else []
        cur_ids = [x for x in cur_ids if isinstance(x, str)]
        cur_dismissed = int(current.get("dismissed_before") or 0)
        cur_status = current.get("status_notifications") if isinstance(current.get("status_notifications"), list) else []
        cur_status = [x for x in cur_status if isinstance(x, dict)]

        if mode == "replace":
            next_ids = list(dict.fromkeys(incoming_ids))
        else:
            # merge (default)
            next_ids = list(dict.fromkeys(cur_ids + incoming_ids))

        next_dismissed = int(dismissed_before) if dismissed_before is not None else int(cur_dismissed)
        next_status = [] if clear_status else list(cur_status)

        if status_notifications_in is not None:
            next_status = [x for x in status_notifications_in if isinstance(x, dict)]
        if append_status is not None:
            next_status.append(append_status)

        next_status = next_status[-200:]

        next_state: Dict[str, Any] = {
            "read_ids": next_ids,
            "dismissed_before": next_dismissed,
            "status_notifications": next_status,
            "updated_at": int(time.time()),
            "ok": True,
            "count": len(next_ids),
        }

        _write_json(file_path, next_state)
        return next_state

