import logging
import os
import secrets
import time
from pathlib import Path
from typing import Any, Dict

from fastapi import HTTPException, Request

from json_store import _cached_read_json, _write_json

logger = logging.getLogger(__name__)

def _load_credentials(auth_credentials_file: Path) -> Dict[str, Any]:
    # Short TTL so password changes take effect almost immediately.
    data = _cached_read_json(auth_credentials_file, {}, ttl_seconds=5)
    if not isinstance(data, dict):
        data = {}
    return data


# Время жизни сессии: 7 дней
SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60


def _load_sessions(auth_tokens_file: Path) -> Dict[str, Any]:
    data = _cached_read_json(auth_tokens_file, {}, ttl_seconds=60)  # 1 минута кеша
    if not isinstance(data, dict):
        data = {}
    return data


def _save_sessions(auth_tokens_file: Path, data: Dict[str, Any]) -> None:
    _write_json(auth_tokens_file, data)
    try:
        os.chmod(auth_tokens_file, 0o600)
    except Exception:
        pass


def _cleanup_expired_sessions(auth_tokens_file: Path) -> None:
    """Удаляет истёкшие сессии (старше SESSION_MAX_AGE_SECONDS)."""
    sessions = _load_sessions(auth_tokens_file)
    if not sessions:
        return

    now = time.time()
    expired_tokens = []

    for token, session_data in sessions.items():
        if not isinstance(session_data, dict):
            expired_tokens.append(token)
            continue
        created_at = session_data.get("created_at", 0)
        if now - created_at > SESSION_MAX_AGE_SECONDS:
            expired_tokens.append(token)

    if expired_tokens:
        for token in expired_tokens:
            sessions.pop(token, None)
        _save_sessions(auth_tokens_file, sessions)
        logger.info("[AUTH] Cleaned %s expired sessions", len(expired_tokens))


def _new_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def _require_auth(request: Request, cookie_name: str, auth_tokens_file: Path) -> Dict[str, Any]:
    token = request.cookies.get(cookie_name)
    if not token:
        raise HTTPException(status_code=401, detail="Требуется авторизация")
    sessions = _load_sessions(auth_tokens_file)
    session = sessions.get(token)
    if not isinstance(session, dict):
        raise HTTPException(status_code=401, detail="Сессия истекла. Войдите заново.")

    # Проверяем, не истекла ли сессия
    created_at = session.get("created_at", 0)
    if time.time() - created_at > SESSION_MAX_AGE_SECONDS:
        # Удаляем истёкшую сессию
        sessions.pop(token, None)
        _save_sessions(auth_tokens_file, sessions)
        raise HTTPException(status_code=401, detail="Сессия истекла. Войдите заново.")

    return {"token": token, **session}


def _require_csrf(request: Request, session: Dict[str, Any]) -> None:
    header = request.headers.get("X-CSRF-Token") or request.headers.get("x-csrf-token")
    expected = session.get("csrf_token")
    if not header or not expected or header != expected:
        raise HTTPException(status_code=403, detail="CSRF token missing or invalid")

