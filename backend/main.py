import json
import os
import logging
import asyncio
import time
import urllib.parse
import secrets
import sqlite3
from pathlib import Path
from typing import Any, Dict, Optional, Tuple, List
from functools import lru_cache
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
import hashlib
import hmac
import re
import base64
from urllib.parse import parse_qsl

import bcrypt
import httpx
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, Response, UploadFile, File, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from starlette.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from json_store import _cached_read_json, _read_json, _write_json
from remnawave_helpers import _extract_online_users_count, _extract_nodes_list, _sum_online_from_nodes, _remnawave_get_json
from auth_utils import (
    _load_credentials as _load_credentials_impl,
    _load_sessions as _load_sessions_impl,
    _save_sessions as _save_sessions_impl,
    _cleanup_expired_sessions as _cleanup_expired_sessions_impl,
    _new_token,
    _require_auth as _require_auth_impl,
    _require_csrf as _require_csrf_impl,
    SESSION_MAX_AGE_SECONDS,
)
from panel_users_store import (
    bootstrap_owner_from_credentials_file,
    create_user as panel_create_user,
    delete_user as panel_delete_user,
    get_user_by_id as panel_get_user_by_id,
    init_panel_users_db,
    list_users as panel_list_users,
    update_user as panel_update_user,
    verify_login as panel_verify_login,
    generate_totp_secret,
    get_totp_info,
    enable_totp,
    disable_totp,
    verify_totp_code,
    is_totp_enabled,
)
from jwt_handler import (
    create_access_token,
    create_refresh_token,
    create_2fa_pending_token,
    verify_token as jwt_verify_token,
    init_jwt_blacklist,
    revoke_jti,
    is_jti_revoked,
    cleanup_expired_blacklist,
    new_csrf_token,
    ACCESS_EXP,
    REFRESH_EXP,
)
from panel_roles_store import (
    RBAC_ACTIONS,
    RBAC_RESOURCES,
    get_role as panel_get_role,
    init_panel_roles_db,
    list_roles as panel_list_roles,
    role_exists as panel_role_exists,
    update_role_permissions as panel_update_role_permissions,
)
from panel_audit_store import (
    init_panel_audit_db as init_panel_audit_db,
    append_audit as panel_append_audit,
    list_audit as panel_list_audit,
)
from nodes_store import (
    init_nodes_db,
    list_nodes,
    get_node,
    get_node_by_token,
    ensure_node,
    regenerate_token,
    revoke_token,
    update_heartbeat as node_update_heartbeat,
    increment_connections as node_increment_connections,
)
import agent_manager as _agent_manager
from violations_store import (
    init_violations_db,
    list_violations,
    get_violation,
    get_violations_stats,
    get_top_violators,
    resolve_violation,
    annul_violation,
    list_whitelist,
    add_to_whitelist,
    remove_from_whitelist,
    add_connections as vio_add_connections,
    get_violations_trend,
    get_connection_stats,
    is_whitelisted as vio_is_whitelisted,
    cleanup_old_data as vio_cleanup_old_data,
)
import violation_detector as _vio_detector
from github_update_service import GitHubUpdateManager, default_update_config
from notifications_store import get_notifications_state as _get_notifications_state, save_notifications_state as _save_notifications_state
from monitoring_store import (
    _remove_online_history_for_bot_profiles as _remove_online_history_for_bot_profiles_impl,
    _remove_telegram_sessions_for_bot_profiles as _remove_telegram_sessions_for_bot_profiles_impl,
    _remove_monitoring_state_for_profile as _remove_monitoring_state_for_profile_impl,
    _append_online_history as _append_online_history_impl,
)
from bot_proxy import proxy_to_bot_impl as _proxy_to_bot_request_impl
from bot_api_base import get_bot_api_base_url
from remnawave_proxy import proxy_to_remnawave_impl as _proxy_to_remnawave_request_impl
from status_refresh import (
    refresh_bot_api_status_now_impl as _refresh_bot_api_status_now_impl,
    refresh_remnawave_status_now_impl as _refresh_remnawave_status_now_impl,
)
from background_loops import (
    monitor_nodes_loop_impl as _monitor_nodes_loop_impl,
    collect_online_history_loop_impl as _collect_online_history_loop_impl,
    session_cleanup_loop_impl as _session_cleanup_loop_impl,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]

# Persistent data directory (Docker-friendly). In non-docker installs it defaults to PROJECT_ROOT.
DATA_DIR = Path(os.environ.get("ADMINPANEL_DATA_DIR") or str(PROJECT_ROOT)).resolve()

FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"
FRONTEND_LK_DIST = PROJECT_ROOT / "frontend" / "dist-lk"

AUTH_CREDENTIALS_FILE = DATA_DIR / "auth_credentials.json"
AUTH_TOKENS_FILE = DATA_DIR / ".auth_tokens.json"
PANEL_USERS_DB_FILE = DATA_DIR / "panel_users.sqlite"
NODES_DB_FILE = DATA_DIR / "nodes.sqlite"
VIOLATIONS_DB_FILE = DATA_DIR / "violations.sqlite"
_AGENT_SECRET_KEY = os.environ.get("AGENT_SECRET_KEY", "")

BOT_PROFILES_FILE = DATA_DIR / "bot_profiles.json"
MONITORING_SETTINGS_FILE = DATA_DIR / "monitoring_settings.json"
MONITORING_STATE_FILE = DATA_DIR / "monitoring_state.json"

REMNAWAVE_PROFILES_FILE = DATA_DIR / "remnawave_profiles.json"
REMNAWAVE_ONLINE_HISTORY_FILE = DATA_DIR / "remnawave_online_history.json"
UI_SETTINGS_FILE = DATA_DIR / "ui_settings.json"
TELEGRAM_SESSIONS_DIR = DATA_DIR / "telegram_sessions"
NOTIFICATIONS_STATE_FILE = DATA_DIR / "notifications_state.json"
SENDER_MESSAGES_FILE = DATA_DIR / "sender_saved_messages.json"
SENDER_UPLOADS_DIR = DATA_DIR / "uploads" / "sender"
LK_SUPPORT_UPLOADS_DIR = DATA_DIR / "uploads" / "lk-support"

# ---------------------------------------------------------------------------
# Token encryption for bot_profiles / remnawave_profiles on disk.
# Uses HMAC-SHA256 keystream (ChaCha-like XOR) + HMAC-SHA256 MAC — no deps.
# Key derived from ADMINPANEL_JWT_SECRET via SHA-256 (32 bytes).
# Format: "enc:v1:<base64(16-byte-nonce + 32-byte-mac + ciphertext)>"
# Plain tokens (legacy) are used as-is and re-encrypted on next save.
# ---------------------------------------------------------------------------

def _enc_key() -> bytes:
    from jwt_handler import _SECRET as _jwt_secret
    return hashlib.sha256(_jwt_secret.encode()).digest()  # 32 bytes

def _token_encrypt(plain: str) -> str:
    """Encrypt a plain-text token. Returns "enc:v1:<b64>" string."""
    if not plain or plain.startswith("enc:v1:"):
        return plain
    key = _enc_key()
    nonce = secrets.token_bytes(16)
    # keystream: HMAC-SHA256 counter blocks
    pt = plain.encode()
    keystream = b""
    i = 0
    while len(keystream) < len(pt):
        keystream += hmac.new(key, nonce + i.to_bytes(4, "big"), hashlib.sha256).digest()
        i += 1
    ct = bytes(a ^ b for a, b in zip(pt, keystream))
    mac = hmac.new(key, nonce + ct, hashlib.sha256).digest()
    return "enc:v1:" + base64.b64encode(nonce + mac + ct).decode()

def _token_decrypt(raw: str) -> str:
    """Decrypt a token. Handles both encrypted and legacy plain-text tokens."""
    if not raw:
        return raw
    if not raw.startswith("enc:v1:"):
        return raw  # legacy plain-text — used as-is
    try:
        key = _enc_key()
        data = base64.b64decode(raw[7:])
        nonce, mac, ct = data[:16], data[16:48], data[48:]
        expected_mac = hmac.new(key, nonce + ct, hashlib.sha256).digest()
        if not hmac.compare_digest(mac, expected_mac):
            logger.error("Token MAC verification failed — token may be tampered")
            return ""
        keystream = b""
        i = 0
        while len(keystream) < len(ct):
            keystream += hmac.new(key, nonce + i.to_bytes(4, "big"), hashlib.sha256).digest()
            i += 1
        return bytes(a ^ b for a, b in zip(ct, keystream)).decode()
    except Exception:
        logger.error("Token decryption failed — token may be corrupted", exc_info=True)
        return ""

def _profile_encrypt_token(profile: Dict[str, Any]) -> Dict[str, Any]:
    """Return a copy of profile with token encrypted (if not already)."""
    if not isinstance(profile, dict):
        return profile
    raw = str(profile.get("token") or "")
    if raw and not raw.startswith("enc:v1:"):
        profile = dict(profile)
        profile["token"] = _token_encrypt(raw)
    return profile

_IMAGE_MAGIC: list[tuple[bytes, str]] = [
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"\xff\xd8\xff", "jpg"),
    (b"GIF87a", "gif"),
    (b"GIF89a", "gif"),
    (b"RIFF", "webp"),  # RIFF????WEBP — further check below
]

def _check_image_magic(header: bytes, ext: str) -> bool:
    """Return True if the first bytes match a known image format for the given ext."""
    if ext in (".png",) and header[:8] == b"\x89PNG\r\n\x1a\n":
        return True
    if ext in (".jpg", ".jpeg") and header[:3] == b"\xff\xd8\xff":
        return True
    if ext == ".gif" and header[:6] in (b"GIF87a", b"GIF89a"):
        return True
    if ext == ".webp" and header[:4] == b"RIFF" and header[8:12] == b"WEBP":
        return True
    return False
GITHUB_UPDATE_CONFIG_FILE = DATA_DIR / "github_update_config.json"
GITHUB_UPDATE_STATE_FILE = DATA_DIR / "github_update_state.json"
GITHUB_UPDATE_LOG_FILE = DATA_DIR / "github_update.log"

COOKIE_NAME = "admin_session"  # legacy, kept for backward compat
JWT_ACCESS_COOKIE = "access_token"
JWT_REFRESH_COOKIE = "refresh_token"
JWT_PENDING_COOKIE = "totp_pending"
JWT_CSRF_COOKIE = "csrf_token"

# LK (user cabinet) auth (Telegram only for now)
LK_COOKIE_NAME = "lk_session"
LK_TOKENS_FILE = DATA_DIR / ".lk_tokens.json"
LK_DATA_FILE = DATA_DIR / "lk_data.json"
LK_MODULE_API_FILE = DATA_DIR / "lk_module_api.json"
LK_BINDING_FILE = DATA_DIR / "lk_binding.json"
LK_PROFILES_FILE = DATA_DIR / "lk_profiles.json"
LK_SUPPORT_DB_FILE = DATA_DIR / "lk_support.db"
LK_SITE_CONFIGS_DIR = DATA_DIR / "lk_site_configs"
LK_BOT_PROFILE_ID_ENV = "LK_BOT_PROFILE_ID"
LK_SMTP_FILE = DATA_DIR / "lk_smtp.json"

# Telegram auth freshness window (seconds). Telegram sends auth_date; accept within 24h.
LK_TG_AUTH_MAX_AGE_SECONDS = 24 * 60 * 60

# --- Ensure data dir exists (Docker-friendly bootstrap) ---
try:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    TELEGRAM_SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    SENDER_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    LK_SUPPORT_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    LK_SITE_CONFIGS_DIR.mkdir(parents=True, exist_ok=True)
except Exception:
    pass

# If credentials file is missing (fresh Docker volume), create default admin with random password.
# The password is printed to stdout/logs once on first boot.
try:
    if not AUTH_CREDENTIALS_FILE.exists():
        import logging as _init_logging
        _init_pwd = secrets.token_urlsafe(16)
        default_hash = bcrypt.hashpw(_init_pwd.encode(), bcrypt.gensalt(rounds=12)).decode("utf-8")
        _write_json(AUTH_CREDENTIALS_FILE, {"username": "admin", "password_hash": default_hash, "force_password_change": True})
        try:
            os.chmod(AUTH_CREDENTIALS_FILE, 0o600)
        except Exception:
            pass
        _init_logging.getLogger("adminpanel").warning(
            "\n" + "=" * 60 + "\n"
            "  FIRST RUN — default credentials created:\n"
            "  Username: admin\n"
            f"  Password: {_init_pwd}\n"
            "  CHANGE THIS PASSWORD IMMEDIATELY!\n"
            + "=" * 60
        )
except Exception:
    pass

# Pagination hard caps (protect panel on large DBs)
_PAGINATION_MAX_PER_PAGE = 200


def _validate_password_strength(password: str) -> None:
    """Raise HTTPException if password doesn't meet security requirements."""
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Пароль должен быть не менее 8 символов")
    if not re.search(r"[A-Za-z]", password):
        raise HTTPException(status_code=400, detail="Пароль должен содержать буквы")
    if not re.search(r"\d", password):
        raise HTTPException(status_code=400, detail="Пароль должен содержать цифры")
    if not re.search(r"[!@#$%^&*()_+\-=\[\]{}|;:,.<>?/~`]", password):
        raise HTTPException(status_code=400, detail="Пароль должен содержать спецсимвол (!@#$%^&*...)")


class _LoginGuard:
    """Thread-safe login rate limiter with lockout. Auto-cleans stale entries."""

    _MAX_ATTEMPTS = 10
    _WINDOW_SECONDS = 10 * 60   # 10 min sliding window
    _LOCKOUT_SECONDS = 15 * 60  # 15 min lockout after max attempts
    _CLEANUP_INTERVAL = 5 * 60  # cleanup every 5 min

    def __init__(self) -> None:
        self._lock = threading.Lock()
        # key → {"attempts": [ts, ...], "locked_until": float | None}
        self._state: Dict[str, Dict] = {}
        self._last_cleanup = time.time()

    def _cleanup(self) -> None:
        now = time.time()
        if now - self._last_cleanup < self._CLEANUP_INTERVAL:
            return
        self._last_cleanup = now
        stale = [
            k for k, v in self._state.items()
            if (not v.get("locked_until") or v["locked_until"] < now)
            and all(now - ts > self._WINDOW_SECONDS for ts in v.get("attempts", []))
        ]
        for k in stale:
            del self._state[k]

    def check(self, key: str) -> None:
        """Raises 429 if locked out, otherwise allows the attempt."""
        now = time.time()
        with self._lock:
            self._cleanup()
            entry = self._state.get(key)
            if entry and entry.get("locked_until") and entry["locked_until"] > now:
                remaining = int(entry["locked_until"] - now)
                raise HTTPException(
                    status_code=429,
                    detail=f"Слишком много попыток. Повторите через {remaining // 60 + 1} мин.",
                )

    def failure(self, key: str) -> None:
        """Record a failed attempt; lock if threshold reached."""
        now = time.time()
        with self._lock:
            entry = self._state.setdefault(key, {"attempts": [], "locked_until": None})
            entry["attempts"] = [ts for ts in entry["attempts"] if now - ts < self._WINDOW_SECONDS]
            entry["attempts"].append(now)
            if len(entry["attempts"]) >= self._MAX_ATTEMPTS:
                entry["locked_until"] = now + self._LOCKOUT_SECONDS

    def success(self, key: str) -> None:
        """Clear attempts on successful login."""
        with self._lock:
            self._state.pop(key, None)


_login_guard = _LoginGuard()
# OTP IP rate limiter: max 5 requests per 10 min per IP, 15 min lockout
_otp_ip_guard = _LoginGuard()
_otp_ip_guard._MAX_ATTEMPTS = 5  # type: ignore[attr-defined]
# LK rate limiter: max 60 requests per min per IP (for public LK endpoints)
_lk_guard = _LoginGuard()
_lk_guard._MAX_ATTEMPTS = 60       # type: ignore[attr-defined]
_lk_guard._WINDOW_SECONDS = 60     # type: ignore[attr-defined]
_lk_guard._LOCKOUT_SECONDS = 60    # type: ignore[attr-defined]


# Token blacklist for session revocation (logout).
class _TokenBlacklist:
    """Thread-safe in-memory token blacklist. Expired entries are auto-purged."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        # token → expires_at (unix timestamp)
        self._tokens: Dict[str, float] = {}
        self._last_cleanup = time.time()

    def _cleanup(self) -> None:
        now = time.time()
        if now - self._last_cleanup < 60:
            return
        self._last_cleanup = now
        expired = [t for t, exp in self._tokens.items() if exp < now]
        for t in expired:
            del self._tokens[t]

    def revoke(self, token: str, expires_at: float) -> None:
        with self._lock:
            self._cleanup()
            self._tokens[token] = expires_at

    def is_revoked(self, token: str) -> bool:
        with self._lock:
            self._cleanup()
            exp = self._tokens.get(token)
            if exp is None:
                return False
            if exp < time.time():
                del self._tokens[token]
                return False
            return True


_token_blacklist = _TokenBlacklist()

# -----------------------
# Remnawave bulk lookup cache (in-memory)
# -----------------------
_RMW_USER_CACHE_TTL_SEC = 60.0
_rmw_user_cache: Dict[Tuple[str, str], Tuple[float, Any]] = {}


def _rmw_cache_get(cache_key: Tuple[str, str]) -> Optional[Any]:
    v = _rmw_user_cache.get(cache_key)
    if not v:
        return None
    ts, payload = v
    if (time.time() - ts) > _RMW_USER_CACHE_TTL_SEC:
        _rmw_user_cache.pop(cache_key, None)
        return None
    return payload


def _rmw_cache_set(cache_key: Tuple[str, str], payload: Any) -> None:
    _rmw_user_cache[cache_key] = (time.time(), payload)
    # Best-effort pruning to avoid unbounded growth
    if len(_rmw_user_cache) > 5000:
        cutoff = time.time() - _RMW_USER_CACHE_TTL_SEC
        for k, (ts, _) in list(_rmw_user_cache.items()):
            if ts < cutoff:
                _rmw_user_cache.pop(k, None)

# -----------------------
# Bot API Data Cache (for fast dashboard)
# -----------------------
_BOT_API_CACHE_TTL_SEC = 300.0  # 5 minutes
_bot_api_cache: Dict[str, Tuple[float, Any]] = {}
_bot_api_cache_lock = threading.Lock()

def _get_moscow_day_key() -> str:
    """Get current Moscow day as YYYY-MM-DD for cache invalidation on day change."""
    now_utc = datetime.now(timezone.utc)
    moscow_ts = now_utc.timestamp() + 3 * 60 * 60  # UTC+3
    moscow_dt = datetime.fromtimestamp(moscow_ts, tz=timezone.utc)
    return moscow_dt.strftime("%Y-%m-%d")

def _bot_cache_get(profile_id: str, data_type: str, include_day: bool = False) -> Optional[Any]:
    """Get cached Bot API data if not expired.
    
    Args:
        include_day: If True, include Moscow day in cache key (for day-sensitive data like dashboard stats)
    """
    day_suffix = f":{_get_moscow_day_key()}" if include_day else ""
    key = f"{profile_id}:{data_type}{day_suffix}"
    with _bot_api_cache_lock:
        v = _bot_api_cache.get(key)
        if not v:
            return None
        ts, payload = v
        if (time.time() - ts) > _BOT_API_CACHE_TTL_SEC:
            _bot_api_cache.pop(key, None)
            return None
        return payload

def _bot_cache_set(profile_id: str, data_type: str, payload: Any, include_day: bool = False) -> None:
    """Set cached Bot API data.
    
    Args:
        include_day: If True, include Moscow day in cache key (for day-sensitive data like dashboard stats)
    """
    day_suffix = f":{_get_moscow_day_key()}" if include_day else ""
    key = f"{profile_id}:{data_type}{day_suffix}"
    with _bot_api_cache_lock:
        _bot_api_cache[key] = (time.time(), payload)

def _remove_online_history_for_bot_profiles(bot_profile_ids: list[str]) -> None:
    return _remove_online_history_for_bot_profiles_impl(REMNAWAVE_ONLINE_HISTORY_FILE, bot_profile_ids)


def _remove_telegram_sessions_for_bot_profiles(bot_profile_ids: list[str]) -> None:
    return _remove_telegram_sessions_for_bot_profiles_impl(TELEGRAM_SESSIONS_DIR, bot_profile_ids)


def _remove_monitoring_state_for_profile(remnawave_profile_id: str, bot_profile_ids: list[str]) -> None:
    return _remove_monitoring_state_for_profile_impl(MONITORING_STATE_FILE, remnawave_profile_id, bot_profile_ids)


def _append_online_history(bot_profile_ids: list[str], timestamp_ms: int, count: int) -> None:
    return _append_online_history_impl(REMNAWAVE_ONLINE_HISTORY_FILE, bot_profile_ids, timestamp_ms, count)


def _error(status_code: int, message: str) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"detail": message})


def _load_credentials() -> Dict[str, Any]:
    return _load_credentials_impl(AUTH_CREDENTIALS_FILE)


def _load_sessions() -> Dict[str, Any]:
    return _load_sessions_impl(AUTH_TOKENS_FILE)


def _save_sessions(data: Dict[str, Any]) -> None:
    return _save_sessions_impl(AUTH_TOKENS_FILE, data)


def _cleanup_expired_sessions() -> None:
    return _cleanup_expired_sessions_impl(AUTH_TOKENS_FILE)


def _lk_load_sessions() -> Dict[str, Any]:
    return _load_sessions_impl(LK_TOKENS_FILE)


def _lk_save_sessions(data: Dict[str, Any]) -> None:
    return _save_sessions_impl(LK_TOKENS_FILE, data)


def _lk_cleanup_expired_sessions() -> None:
    return _cleanup_expired_sessions_impl(LK_TOKENS_FILE)


def _lk_require_auth(request: Request) -> Dict[str, Any]:
    # Keep sessions store tidy (best-effort).
    try:
        _lk_cleanup_expired_sessions()
    except Exception:
        logger.debug("[LK] Session cleanup failed", exc_info=True)
    return _require_auth_impl(request, LK_COOKIE_NAME, LK_TOKENS_FILE)


def _lk_load_module_api_config() -> Dict[str, Any]:
    data = _read_json(LK_MODULE_API_FILE, {})
    if not isinstance(data, dict):
        data = {}
    base_url = str(data.get("base_url") or data.get("baseUrl") or "").strip()
    if not base_url:
        # Default: local module API server (same host).
        base_url = "http://127.0.0.1:7777/adminpanel/api"
    return {"base_url": base_url}


def _lk_save_module_api_config(data: Dict[str, Any]) -> None:
    base_url = str((data or {}).get("base_url") or (data or {}).get("baseUrl") or "").strip()
    if not base_url:
        raise HTTPException(status_code=400, detail="base_url is required")
    _write_json(LK_MODULE_API_FILE, {"base_url": base_url})
    try:
        os.chmod(LK_MODULE_API_FILE, 0o600)
    except Exception:
        pass


def _lk_load_binding() -> Dict[str, Any]:
    data = _read_json(LK_BINDING_FILE, {})
    if not isinstance(data, dict):
        data = {}
    bot_profile_id = str(data.get("bot_profile_id") or data.get("botProfileId") or "").strip()
    return {"bot_profile_id": bot_profile_id}


def _lk_save_binding(data: Dict[str, Any]) -> Dict[str, Any]:
    bot_profile_id = str((data or {}).get("bot_profile_id") or (data or {}).get("botProfileId") or "").strip()
    # Allow clearing binding
    if bot_profile_id:
        p = _lk_get_bot_profile_by_id(bot_profile_id)
        if not p:
            raise HTTPException(status_code=400, detail="Некорректный bot_profile_id")
    _write_json(LK_BINDING_FILE, {"bot_profile_id": bot_profile_id})
    try:
        os.chmod(LK_BINDING_FILE, 0o600)
    except Exception:
        pass
    return {"bot_profile_id": bot_profile_id}


def _load_lk_profiles_data() -> Dict[str, Any]:
    data = _read_json(LK_PROFILES_FILE, {"profiles": [], "activeProfileId": None})
    if not isinstance(data, dict):
        data = {"profiles": [], "activeProfileId": None}
    if not isinstance(data.get("profiles"), list):
        data["profiles"] = []
    return data


def _save_lk_profiles_data(data: Dict[str, Any]) -> None:
    _write_json(LK_PROFILES_FILE, data)
    try:
        os.chmod(LK_PROFILES_FILE, 0o600)
    except Exception:
        pass


def _enforce_unique_lk_binding(profiles: list[Dict[str, Any]], *, owner_profile_id: str, bot_profile_id: str) -> None:
    """
    Ensure a bot-profile id is bound to at most ONE LK profile.
    Normalize every profile's botProfileIds to contain at most 1 id.
    """
    bot_profile_id = str(bot_profile_id or "").strip()
    owner_profile_id = str(owner_profile_id or "").strip()
    for p in profiles:
        if not isinstance(p, dict):
            continue
        pid = str(p.get("id") or "").strip()
        current = _normalize_single_bot_profile_id(p.get("botProfileIds"))
        # Remove binding from other profiles
        if bot_profile_id and pid and pid != owner_profile_id and current == bot_profile_id:
            p["botProfileIds"] = []
            continue
        # Normalize to single-entry list (or empty)
        p["botProfileIds"] = [current] if current else []


def _normalize_lk_domain(value: Any) -> str:
    """
    Normalize a SINGLE LK domain (1 LK profile = 1 domain).
    Accept list / csv / scalar, but always keep only the first entry.
    Example: "lk.example.com"
    """
    v = value
    if v is None:
        return ""
    if isinstance(v, (list, tuple)):
        if not v:
            return ""
        v = v[0]
    s = str(v or "")
    if "," in s:
        s = s.split(",", 1)[0]
    d = s.strip().lower()
    if not d:
        return ""
    # strip scheme/path if accidentally pasted
    d = d.replace("https://", "").replace("http://", "")
    d = d.split("/")[0].strip()
    # strip port
    if ":" in d:
        d = d.split(":", 1)[0].strip()
    return d


def _lk_get_profile_domain(p: Dict[str, Any]) -> str:
    if not isinstance(p, dict):
        return ""
    s = p.get("settings") or {}
    if not isinstance(s, dict):
        s = {}
    return _normalize_lk_domain(s.get("domain") or s.get("domains") or p.get("domain") or p.get("domains"))


def _lk_profile_settings_out(p: Dict[str, Any]) -> Dict[str, Any]:
    """Return all LK settings fields from a profile dict (for API responses)."""
    s = p.get("settings") or {}
    if not isinstance(s, dict):
        s = {}
    return {
        "brand_title": str(s.get("brand_title") or ""),
        "domain": _lk_get_profile_domain(p),
        "support_url": str(s.get("support_url") or ""),
        "news_url": str(s.get("news_url") or ""),
        "terms_url": str(s.get("terms_url") or ""),
        "enabled_tariff_group_codes": s.get("enabled_tariff_group_codes") or [],
        "enabled_payment_providers": s.get("enabled_payment_providers") or [],
        "invite_tab_mode": str(s.get("invite_tab_mode") or "auto"),
    }


def _enforce_unique_lk_domain(profiles: list[Dict[str, Any]], *, owner_profile_id: str, domain: Any) -> None:
    """
    Ensure a domain is assigned to at most ONE LK profile.
    Also migrates legacy settings.domains -> settings.domain (taking the first).
    """
    owner_profile_id = str(owner_profile_id or "").strip()
    desired = _normalize_lk_domain(domain)
    for p in profiles:
        if not isinstance(p, dict):
            continue
        pid = str(p.get("id") or "").strip()
        s = p.get("settings") or {}
        if not isinstance(s, dict):
            s = {}
        current = _normalize_lk_domain(s.get("domain") or s.get("domains"))

        # Migrate legacy "domains" list/csv to single "domain"
        if ("domains" in s) or (s.get("domain") != current):
            s["domain"] = current
            if "domains" in s:
                try:
                    s.pop("domains", None)
                except Exception:
                    pass
            p["settings"] = s

        # Remove domain from other profiles
        if desired and pid and pid != owner_profile_id and current == desired:
            s["domain"] = ""
            p["settings"] = s

        # Set/normalize owner
        if pid == owner_profile_id:
            s["domain"] = desired
            if "domains" in s:
                try:
                    s.pop("domains", None)
                except Exception:
                    pass
            p["settings"] = s


def _lk_extract_request_host(request: Request) -> str:
    host = str(request.headers.get("x-forwarded-host") or request.headers.get("host") or "").strip()
    if "," in host:
        host = host.split(",", 1)[0].strip()
    host = host.lower()
    # strip port
    if ":" in host:
        host = host.split(":", 1)[0].strip()
    return host


def _lk_pick_lk_profile_for_host(host: str) -> Optional[Dict[str, Any]]:
    h = str(host or "").strip().lower()
    if not h:
        return None
    profiles, _active = _lk_list_lk_profiles()
    for p in profiles:
        if h == _lk_get_profile_domain(p):
            return p
    return None


def _lk_list_lk_profiles() -> Tuple[List[Dict[str, Any]], Optional[str]]:
    data = _load_lk_profiles_data()
    profiles = data.get("profiles") if isinstance(data.get("profiles"), list) else []
    profiles = [p for p in profiles if isinstance(p, dict)]
    active_id = str(data.get("activeProfileId") or "").strip() or None
    return profiles, active_id


def _lk_get_lk_profile_by_id(profile_id: str) -> Optional[Dict[str, Any]]:
    pid = str(profile_id or "").strip()
    if not pid:
        return None
    profiles, _active = _lk_list_lk_profiles()
    for p in profiles:
        if str(p.get("id") or "").strip() == pid:
            return p
    return None


def _lk_get_active_lk_profile() -> Optional[Dict[str, Any]]:
    profiles, active_id = _lk_list_lk_profiles()
    if active_id:
        for p in profiles:
            if str(p.get("id") or "").strip() == active_id:
                return p
    return profiles[0] if profiles else None


def _lk_get_active_lk_bot_profile_id() -> str:
    p = _lk_get_active_lk_profile()
    if not p:
        return ""
    return _normalize_single_bot_profile_id(p.get("botProfileIds"))


def _lk_get_lk_profile_for_request(request: Request) -> Optional[Dict[str, Any]]:
    host = _lk_extract_request_host(request)
    picked = _lk_pick_lk_profile_for_host(host)
    if picked:
        return picked
    return _lk_get_active_lk_profile()


def _lk_get_bot_profile_id_for_request(request: Request) -> str:
    p = _lk_get_lk_profile_for_request(request)
    if not p:
        return ""
    return _normalize_single_bot_profile_id(p.get("botProfileIds"))


def _lk_resolve_module_api_base_url() -> Dict[str, Any]:
    """
    Resolve effective LK module API upstream.
    Priority:
    1) Active LK profile -> its binding to a bot-profile id (multi-bot, multi-server)
    2) Manual override base_url in lk_module_api.json
    3) Default local 127.0.0.1:7777
    """
    bot_profile_id = _lk_get_active_lk_bot_profile_id()
    if bot_profile_id:
        prof = _lk_get_bot_profile_by_id(bot_profile_id)
        if prof:
            base = get_bot_api_base_url(prof)
            if base:
                active_lk = _lk_get_active_lk_profile()
                return {
                    "base_url": base,
                    "bot_profile_id": bot_profile_id,
                    "lk_profile_id": str((active_lk or {}).get("id") or "").strip(),
                    "mode": "lk_profile",
                }
    cfg = _lk_load_module_api_config()
    return {"base_url": str(cfg.get("base_url") or ""), "bot_profile_id": "", "lk_profile_id": "", "mode": "manual"}


def _lk_resolve_module_api_base_url_for_request(request: Request) -> Dict[str, Any]:
    """
    Same as _lk_resolve_module_api_base_url, but prefers LK profile selected by request Host/domain.
    """
    host = _lk_extract_request_host(request)
    if host:
        # Strict runtime behavior: if a domain is used for LK, it MUST be configured in LK profiles.
        lk_p = _lk_pick_lk_profile_for_host(host)
        if not lk_p:
            return {"base_url": "", "bot_profile_id": "", "lk_profile_id": "", "mode": "lk_profile_missing"}
        bot_profile_id = _normalize_single_bot_profile_id(lk_p.get("botProfileIds"))
        if not bot_profile_id:
            return {"base_url": "", "bot_profile_id": "", "lk_profile_id": str(lk_p.get("id") or "").strip(), "mode": "lk_profile_unbound"}
        prof = _lk_get_bot_profile_by_id(bot_profile_id)
        if prof:
            base = get_bot_api_base_url(prof)
            if base:
                return {
                    "base_url": base,
                    "bot_profile_id": bot_profile_id,
                    "lk_profile_id": str(lk_p.get("id") or "").strip(),
                    "mode": "lk_profile_domain",
                }
        return {"base_url": "", "bot_profile_id": bot_profile_id, "lk_profile_id": str(lk_p.get("id") or "").strip(), "mode": "bot_base_url_missing"}
    return _lk_resolve_module_api_base_url()


async def _proxy_to_lk_module_api(request: Request, upstream_path: str) -> Response:
    """
    Proxy LK request to configured module API upstream.
    Keeps cookies/SameSite working even if module API is on another server.
    """
    resolved = _lk_resolve_module_api_base_url_for_request(request)
    base_url = str(resolved.get("base_url") or "").strip().rstrip("/")
    if not base_url:
        mode = str(resolved.get("mode") or "")
        if mode == "lk_profile_missing":
            return _error(404, "ЛК для этого домена не настроен")
        if mode == "lk_profile_unbound":
            return _error(409, "Профиль ЛК не привязан к профилю бота")
        if mode == "bot_base_url_missing":
            return _error(502, "Bot API base URL не настроен для выбранного профиля")
        return _error(400, "LK Module API base_url не настроен")

    url = base_url + "/" + upstream_path.lstrip("/")
    params: Dict[str, Any] = dict(request.query_params)

    headers: Dict[str, str] = {"Accept": request.headers.get("accept", "application/json")}
    ct = request.headers.get("content-type")
    if ct:
        headers["Content-Type"] = ct
    cookie = request.headers.get("cookie")
    if cookie:
        headers["Cookie"] = cookie
    # Forward proto/host so upstream can set secure cookies correctly.
    headers["X-Forwarded-Proto"] = request.headers.get("x-forwarded-proto") or request.url.scheme or "http"
    xf_host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    if xf_host:
        headers["X-Forwarded-Host"] = xf_host
    csrf = request.headers.get("x-csrf-token") or request.headers.get("x-csrf")
    if csrf:
        headers["X-CSRF-Token"] = csrf
    body = await request.body()
    method = request.method.upper()

    timeout = httpx.Timeout(connect=10.0, read=60.0, write=60.0, pool=10.0)
    limits = httpx.Limits(max_connections=200, max_keepalive_connections=40, keepalive_expiry=30.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False, limits=limits) as client:
        try:
            upstream = await client.request(method, url, params=params, content=body, headers=headers)
        except httpx.RequestError as e:
            return _error(502, f"LK Module API недоступен: {e.__class__.__name__}")

    content_type = upstream.headers.get("content-type", "")
    resp = Response(status_code=upstream.status_code, content=upstream.content, media_type=content_type or None)
    for v in upstream.headers.get_list("set-cookie"):
        resp.headers.append("set-cookie", v)
    loc = upstream.headers.get("location")
    if loc:
        resp.headers["location"] = loc
    return resp


async def _proxy_to_lk_module_api_with_body(request: Request, upstream_path: str, *, body: bytes, method: str = "POST") -> Response:
    """Like _proxy_to_lk_module_api but with a custom body and method (for internal server-to-server calls)."""
    resolved = _lk_resolve_module_api_base_url_for_request(request)
    base_url = str(resolved.get("base_url") or "").strip().rstrip("/")
    if not base_url:
        return _error(502, "LK Module API base_url не настроен")
    url = base_url + "/" + upstream_path.lstrip("/")
    # Get bot token + admin_id for require_admin auth
    lk_profile = _lk_get_lk_profile_for_request(request)
    token = ""
    admin_id = ""
    if lk_profile:
        bot_profile_id = str((lk_profile.get("botProfileIds") or [None])[0] or "")
        bp = _get_bot_profile_by_id_full(bot_profile_id) if bot_profile_id else None
        if bp:
            token = str(bp.get("token") or "")
            admin_id = str(bp.get("adminId") or "")
    headers: Dict[str, str] = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if token:
        headers["X-Token"] = token
    params: Dict[str, Any] = {}
    if admin_id:
        params["tg_id"] = admin_id
    timeout = httpx.Timeout(connect=5.0, read=10.0, write=10.0, pool=5.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            upstream = await client.request(method, url, params=params, content=body, headers=headers)
        except httpx.RequestError as e:
            return _error(502, f"LK Module API недоступен: {e.__class__.__name__}")
    content_type = upstream.headers.get("content-type", "")
    return Response(status_code=upstream.status_code, content=upstream.content, media_type=content_type or None)


def _safe_redirect_path(path: str, default: str = "/subscriptions") -> str:
    p = str(path or "").strip()
    if not p:
        return default
    # Disallow absolute URLs / protocol-relative
    if "://" in p or p.startswith("//"):
        return default
    if not p.startswith("/"):
        return default
    # Only allow redirects inside LK routes (avoid open redirect).
    # LK (separate domain) uses a small set of known SPA routes.
    if p in ("/", "/me", "/subscriptions", "/payments", "/support"):
        return p
    # Backward compat (when LK is hosted under /webpanel/lk/*)
    if p.startswith("/webpanel/lk") or p.startswith("/lk"):
        return p
    return default


@lru_cache(maxsize=1)
async def _lk_tg_call_bot(path: str, method: str = "GET", body: Optional[bytes] = None) -> Dict[str, Any]:
    """
    Call bot API lk/auth/tg-* endpoints using the first available bot profile.
    Returns parsed JSON or raises HTTPException.
    """
    profiles_data = _load_lk_profiles_data()
    profiles = profiles_data.get("profiles") if isinstance(profiles_data.get("profiles"), list) else []
    bp = None
    for p in profiles:
        bid = str(((p.get("botProfileIds") or [None])[0]) or "").strip()
        if bid:
            bp = _get_bot_profile_by_id_full(bid)
            if bp:
                break
    if not bp:
        raise HTTPException(status_code=503, detail="Бот не настроен")
    base_url = str(bp.get("baseUrl") or "").strip().rstrip("/")
    token = str(bp.get("token") or "").strip()
    admin_id = str(bp.get("adminId") or "").strip()
    if not base_url:
        raise HTTPException(status_code=503, detail="Бот не настроен")
    url = base_url + "/" + path.lstrip("/")
    headers: Dict[str, str] = {"Accept": "application/json"}
    if token:
        headers["X-Token"] = token
    if body:
        headers["Content-Type"] = "application/json"
    params: Dict[str, Any] = {}
    if admin_id:
        params["tg_id"] = admin_id
    timeout = httpx.Timeout(connect=5.0, read=10.0, write=10.0, pool=5.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            resp = await client.request(method, url, params=params, content=body, headers=headers)
        except httpx.RequestError as e:
            raise HTTPException(status_code=502, detail=f"Бот недоступен: {e.__class__.__name__}")
    if resp.status_code >= 400:
        try:
            detail = resp.json().get("detail", "Ошибка бота")
        except Exception:
            detail = "Ошибка бота"
        raise HTTPException(status_code=resp.status_code, detail=detail)
    try:
        return resp.json()
    except Exception:
        raise HTTPException(status_code=502, detail="Некорректный ответ бота")


async def _lk_verify_telegram_login(params: Dict[str, str]) -> Dict[str, Any]:
    """
    Verify Telegram Login Widget params via bot API.
    Bot holds the token — adminpanel never sees it.
    """
    body = json.dumps({"params": params}).encode()
    data = await _lk_tg_call_bot("lk/auth/tg-verify", method="POST", body=body)
    user = data.get("user")
    if not isinstance(user, dict) or not user.get("tg_id"):
        raise HTTPException(status_code=401, detail="Invalid Telegram signature")
    return user


def _lk_decode_tg_auth_result(raw: str) -> Dict[str, str]:
    """
    Telegram OAuth flow can return auth payload in URL fragment as tgAuthResult (base64url).
    We decode it and return a flat dict compatible with _lk_verify_telegram_login.
    """
    s = str(raw or "").strip()
    if not s:
        raise HTTPException(status_code=400, detail="Missing tgAuthResult")

    # base64url decode with padding
    try:
        pad = "=" * (-len(s) % 4)
        decoded = base64.urlsafe_b64decode((s + pad).encode("utf-8")).decode("utf-8", errors="replace").strip()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid tgAuthResult")

    if decoded.lower() == "false":
        raise HTTPException(status_code=401, detail="Telegram auth cancelled")

    # 1) Try JSON payload
    try:
        obj = json.loads(decoded)
        if isinstance(obj, dict):
            out: Dict[str, str] = {}
            # Some flows might nest fields under {"user": {...}}
            if "user" in obj and isinstance(obj.get("user"), dict):
                for k, v in obj.get("user", {}).items():
                    if v is None:
                        continue
                    if isinstance(v, (dict, list)):
                        continue
                    out[str(k)] = str(v)
            for k, v in obj.items():
                if v is None:
                    continue
                # Only flat scalar fields are relevant for signature check.
                if isinstance(v, (dict, list)):
                    continue
                out[str(k)] = str(v)
            if out:
                return out
        if isinstance(obj, str):
            decoded = obj.strip()
    except Exception:
        pass

    # 2) Fallback: treat decoded string as querystring "k=v&k2=v2"
    try:
        pairs = parse_qsl(decoded.lstrip("?"), keep_blank_values=True)
        out2: Dict[str, str] = {str(k): str(v) for (k, v) in pairs if str(k)}
        if out2:
            return out2
    except Exception:
        pass

    raise HTTPException(status_code=400, detail="Invalid tgAuthResult payload")

async def _refresh_bot_api_status_now(profile: Dict[str, Any]) -> None:
    """
    Immediate BOT API status refresh for a single bot profile.
    This is used after create/update/set-active so UI doesn't wait for the background loop.
    """
    return await _refresh_bot_api_status_now_impl(
        profile,
        read_json=_read_json,
        write_json=_write_json,
        monitoring_state_file=MONITORING_STATE_FILE,
    )

async def _refresh_remnawave_status_now(profile: Dict[str, Any]) -> None:
    """
    Immediate Remnawave API + nodes refresh for a single Remnawave profile.
    Writes api_status:<remProfileId> and api_status:<botProfileId>, plus node keys, to monitoring_state.json.
    """
    return await _refresh_remnawave_status_now_impl(
        profile,
        check_nodes_status=_check_nodes_status,
        get_node_state_key=_get_node_state_key,
        get_node_status=_get_node_status,
        read_json=_read_json,
        write_json=_write_json,
        monitoring_state_file=MONITORING_STATE_FILE,
    )


@lru_cache(maxsize=1)
def _get_active_bot_profile_cached() -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Кешированная версия получения активного профиля бота"""
    data = _cached_read_json(BOT_PROFILES_FILE, {"profiles": [], "activeProfileId": None}, ttl_seconds=60)
    if not isinstance(data, dict):
        data = {"profiles": [], "activeProfileId": None}
    profiles = data.get("profiles") or []
    active_id = data.get("activeProfileId")
    if isinstance(profiles, list):
        for p in profiles:
            if isinstance(p, dict) and p.get("id") == active_id:
                p = dict(p)
                p["token"] = _token_decrypt(str(p.get("token") or ""))
                return data, p
    # fallback: first profile
    if isinstance(profiles, list) and profiles and isinstance(profiles[0], dict):
        p = dict(profiles[0])
        p["token"] = _token_decrypt(str(p.get("token") or ""))
        return data, p
    raise HTTPException(status_code=400, detail="Нет активного bot-профиля. Настройте его в Settings.")

def _get_active_bot_profile() -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Обертка с очисткой LRU кеша при изменениях"""
    return _get_active_bot_profile_cached()

def _invalidate_bot_profiles_cache():
    """Инвалидация кеша профилей бота"""
    _get_active_bot_profile_cached.cache_clear()


def _require_auth(request: Request) -> Dict[str, Any]:
    token = request.cookies.get(JWT_ACCESS_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="Требуется авторизация")
    try:
        payload = jwt_verify_token(token, "access")
    except ValueError:
        raise HTTPException(status_code=401, detail="Недействительный токен")
    if is_jti_revoked(payload.get("jti", "")):
        raise HTTPException(status_code=401, detail="Токен отозван. Войдите заново.")
    # Normalize role
    payload["role"] = _normalize_role_name(payload.get("role"))
    _enforce_rbac(request, payload)
    return payload


def _require_csrf(request: Request, session: Dict[str, Any]) -> None:
    header = request.headers.get("X-CSRF-Token") or request.headers.get("x-csrf-token")
    expected = request.cookies.get(JWT_CSRF_COOKIE)
    if not header or not expected or header != expected:
        raise HTTPException(status_code=403, detail="CSRF token missing or invalid")


def _normalize_role_name(role: Any) -> str:
    r = str(role or "").strip().lower()
    if r == "owner":
        return "super_admin"
    if r == "admin":
        return "manager"
    # Backward-compatible default: old sessions had no role => treat as super_admin.
    return r or "super_admin"


def _maybe_migrate_session_role(session: Dict[str, Any]) -> Dict[str, Any]:
    """
    Old sessions (created before RBAC) may not have 'role', or may have legacy 'owner'/'admin'.
    Normalize and persist to tokens store so RBAC works consistently.
    """
    try:
        token = str((session or {}).get("token") or "")
        if not token:
            return session
        raw = (session or {}).get("role")
        normalized = _normalize_role_name(raw)
        raw_str = str(raw or "").strip().lower()
        if raw_str == normalized:
            return session
        sessions = _load_sessions()
        s = sessions.get(token)
        if isinstance(s, dict):
            s["role"] = normalized
            sessions[token] = s
            _save_sessions(sessions)
        session["role"] = normalized
    except Exception:
        logger.warning("[AUTH] Failed to migrate session role", exc_info=True)
    return session


_RBAC_CACHE: Dict[str, Any] = {"ts": 0.0, "roles": {}}
_RBAC_CACHE_TTL_SEC = 2.0
_github_update_manager = GitHubUpdateManager(
    project_root=PROJECT_ROOT,
    config_file=GITHUB_UPDATE_CONFIG_FILE,
    state_file=GITHUB_UPDATE_STATE_FILE,
    log_file=GITHUB_UPDATE_LOG_FILE,
    service_name="admin-panel",
)


def _get_roles_map_cached() -> Dict[str, Dict[str, Any]]:
    now = time.time()
    ts = float(_RBAC_CACHE.get("ts") or 0.0)
    roles = _RBAC_CACHE.get("roles")
    if isinstance(roles, dict) and (now - ts) < _RBAC_CACHE_TTL_SEC:
        return roles
    try:
        items = panel_list_roles(PANEL_USERS_DB_FILE)
        m: Dict[str, Dict[str, Any]] = {}
        for it in items or []:
            name = _normalize_role_name(it.get("name"))
            m[name] = it
        _RBAC_CACHE["ts"] = now
        _RBAC_CACHE["roles"] = m
        return m
    except Exception:
        # If roles DB is unavailable, do not block the panel.
        logger.warning("[RBAC] Failed to load roles map, returning empty", exc_info=True)
        return {}


def _infer_required_permission(request: Request) -> Optional[str]:
    method = str(request.method or "GET").upper()
    action = {
        "GET": "view",
        "HEAD": "view",
        "OPTIONS": "view",
        "POST": "create",
        "PUT": "edit",
        "PATCH": "edit",
        "DELETE": "delete",
    }.get(method)
    if not action:
        return None

    path = str(request.url.path or "")
    # Support both deployments: "/api/..." and "/webpanel/api/..."
    if path.startswith("/webpanel"):
        path = path[len("/webpanel") :]

    # Explicit panel endpoints
    if path.startswith("/api/dashboard-stats"):
        return f"analytics:{action if action == 'view' else 'edit'}"
    if path.startswith("/api/bot-profiles") or path.startswith("/api/ui-settings") or path.startswith("/api/monitoring-settings"):
        return f"settings:{action}"
    if path.startswith("/api/sender"):
        return f"sender:{action}"
    if path.startswith("/api/panel-users"):
        return f"administrators:{action}"
    if path.startswith("/api/panel-roles"):
        return f"roles:{action}"
    if path.startswith("/api/github-update"):
        return f"settings:{action}"

    # Remnawave
    if path.startswith("/api/remnawave/nodes"):
        return f"nodes:{action}"
    if path.startswith("/api/remnawave/hosts"):
        return f"hosts:{action}"
    if path.startswith("/api/remnawave/users"):
        return f"users:{action}"
    if path.startswith("/api/remnawave/settings") or path.startswith("/api/remnawave/profiles") or path.startswith("/api/remnawave/system"):
        return f"settings:{action}"

    # Bot proxy
    if path.startswith("/api/bot-proxy/") or path == "/api/bot-proxy":
        # /api/bot-proxy/{path:path}
        rest = path[len("/api/bot-proxy/") :] if path.startswith("/api/bot-proxy/") else ""
        first = rest.split("/", 1)[0].strip().lower()
        resource = {
            "users": "users",
            "keys": "subscriptions",
            "payments": "payments",
            "tariffs": "tariffs",
            "servers": "servers",
            "referrals": "analytics",
            "coupons": "settings",
            "gifts": "settings",
            "utm": "analytics",
            "partner-stats": "analytics",
        }.get(first)
        if resource:
            return f"{resource}:{action}"
        # Unknown bot-proxy subpath -> do not block by default.
        return None

    return None


def _enforce_rbac(request: Request, session: Dict[str, Any]) -> None:
    role = _normalize_role_name((session or {}).get("role") or "viewer")
    if role == "super_admin":
        return

    required = _infer_required_permission(request)
    if not required:
        return

    roles_map = _get_roles_map_cached()
    role_obj = roles_map.get(role) or roles_map.get("viewer") or {}
    perms = set(role_obj.get("permissions") or [])
    if required not in perms:
        raise HTTPException(status_code=403, detail="Недостаточно прав")


# --- Panel users bootstrap ---
try:
    init_panel_roles_db(PANEL_USERS_DB_FILE)
    init_panel_users_db(PANEL_USERS_DB_FILE)
    init_panel_audit_db(PANEL_USERS_DB_FILE)
    init_jwt_blacklist(PANEL_USERS_DB_FILE)
    init_nodes_db(NODES_DB_FILE)
    init_violations_db(VIOLATIONS_DB_FILE)
    # Backward-compatible: on first run, import old single-credentials as super_admin.
    bootstrap_owner_from_credentials_file(PANEL_USERS_DB_FILE, credentials=_load_credentials())
except Exception as _e:
    # If DB init fails, keep legacy single-user auth working.
    try:
        logging.getLogger("adminpanel").error("[AUTH] panel_users DB init failed: %s", _e)
    except Exception:
        pass


async def _proxy_to_bot(
    request: Request,
    upstream_path: str,
    *,
    add_admin_tg_id: bool = False,
    method_override: Optional[str] = None,
) -> Response:
    _, profile = _get_active_bot_profile()
    base_url = get_bot_api_base_url(profile)
    token = str(profile.get("token") or "").strip()
    admin_id = str(profile.get("adminId") or "").strip()
    return await _proxy_to_bot_request_impl(
        request,
        upstream_path,
        base_url=base_url,
        token=token,
        admin_id=admin_id,
        add_admin_tg_id=add_admin_tg_id,
        method_override=method_override,
        error_fn=_error,
    )


app = FastAPI(
    title="AdminPanel API",
    version="2.0",
    redirect_slashes=False,
    lifespan=None,  # set below after function definition
)

logger = logging.getLogger("adminpanel")

# CORS: по умолчанию wildcard без credentials (безопасно).
# Для production укажи ADMIN_PANEL_CORS_ORIGIN=https://yourdomain.com
_cors_origins: list[str] = ["*"]
_allow_credentials = False

_custom_origin = os.environ.get("ADMIN_PANEL_CORS_ORIGIN", "").strip()
if _custom_origin:
    _cors_origins = [o.strip() for o in _custom_origin.split(",") if o.strip()]
    _cors_origins.extend([
        "http://localhost:8888",
        "http://127.0.0.1:8888",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ])
    _allow_credentials = True

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=_allow_credentials,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-CSRF-Token", "Authorization"],
)

# IP whitelist: ADMIN_PANEL_ALLOWED_IPS=1.2.3.4,10.0.0.0/24
# Если не задан — доступ с любого IP.
import ipaddress as _ipaddress

_ALLOWED_IPS_RAW = os.environ.get("ADMIN_PANEL_ALLOWED_IPS", "").strip()
_ALLOWED_NETWORKS: list[_ipaddress.IPv4Network | _ipaddress.IPv6Network] = []
if _ALLOWED_IPS_RAW:
    for _entry in _ALLOWED_IPS_RAW.split(","):
        _entry = _entry.strip()
        if not _entry:
            continue
        try:
            _ALLOWED_NETWORKS.append(_ipaddress.ip_network(_entry, strict=False))
        except ValueError:
            pass


def _ip_is_allowed(ip_str: str) -> bool:
    if not _ALLOWED_NETWORKS:
        return True
    try:
        addr = _ipaddress.ip_address(ip_str)
        return any(addr in net for net in _ALLOWED_NETWORKS)
    except ValueError:
        return False


@app.middleware("http")
async def _security_middleware(request: Request, call_next):
    # IP whitelist check (skip health + static assets)
    path = request.url.path or ""
    skip_whitelist = path in ("/webpanel/api/health",) or path.startswith("/webpanel/assets/")
    if _ALLOWED_NETWORKS and not skip_whitelist:
        # Respect X-Forwarded-For from trusted reverse proxy
        forwarded = request.headers.get("x-forwarded-for", "")
        client_ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "")
        if client_ip and not _ip_is_allowed(client_ip):
            return JSONResponse(status_code=403, content={"detail": "Access denied"})

    response = await call_next(request)

    # Security headers (non-asset responses)
    if not path.startswith("/webpanel/assets/"):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("X-XSS-Protection", "1; mode=block")
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' https://telegram.org; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: https:; "
            "connect-src 'self' wss: ws:; "
            "frame-ancestors 'none';"
        )

    # Cache headers for webpanel
    if path.startswith("/webpanel"):
        if path == "/webpanel/" or path.endswith(".html") or path == "/webpanel":
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
        elif "/webpanel/assets/" in path or path.endswith((".js", ".css", ".woff", ".woff2", ".ttf", ".eot", ".map", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico")):
            response.headers.setdefault("Cache-Control", "public, max-age=31536000, immutable")

    return response

api = APIRouter()


VERSION_FILE = DATA_DIR / "version.json"
VERSION_CHECK_URL = os.environ.get("ADMINPANEL_VERSION_CHECK_URL", "https://pocomacho.ru/solonetbot/modules/")


def _get_current_version() -> Dict[str, Any]:
    """Получить текущую версию панели из version.json"""
    # Keep TTL short: admins may adjust version/channel during dev/testing.
    return _cached_read_json(VERSION_FILE, {"version": "0.0.0", "channel": "release"}, ttl_seconds=10)


@api.get("/health")
def health() -> Dict[str, Any]:
    return {"status": "ok", "time_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}


@api.get("/readiness-check")
def readiness_check() -> Dict[str, Any]:
    # Минимальный readiness: есть креды и хотя бы один профиль
    creds = _load_credentials()
    profiles = _read_json(BOT_PROFILES_FILE, {}).get("profiles", [])
    return {
        "ready": bool(creds.get("username") and creds.get("password_hash")) and isinstance(profiles, list),
        "profiles_count": len(profiles) if isinstance(profiles, list) else 0,
    }


@api.get("/version")
def get_version() -> Dict[str, Any]:
    """Получить текущую версию панели"""
    version_data = _get_current_version()
    return {
        "version": version_data.get("version", "0.0.0"),
        "channel": version_data.get("channel", "release"),
        "release_date": version_data.get("release_date", ""),
        "update_url": version_data.get("update_url", VERSION_CHECK_URL),
    }


@api.get("/version/check")
async def check_version_update() -> Dict[str, Any]:
    """Проверить наличие обновлений на сайте"""
    current_version_data = _get_current_version()
    channel = str(current_version_data.get("channel") or "release").strip().lower()
    if channel not in ("release", "dev"):
        channel = "release"
    current_version = current_version_data.get("version", "0.0.0")
    
    result = {
        "current_version": current_version,
        "channel": channel,
        "latest_version": None,
        "update_available": False,
        "update_type": None,  # 'major' = важное (x.y.z), 'minor' = исправление (x.y.z.w)
        "update_url": VERSION_CHECK_URL,
        "error": None,
    }
    if not VERSION_CHECK_URL:
        return result

    try:
        timeout = httpx.Timeout(connect=10.0, read=15.0, write=10.0, pool=10.0)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            resp = await client.get(VERSION_CHECK_URL)
            if resp.status_code != 200:
                result["error"] = f"HTTP {resp.status_code}"
                return result
            
            html = resp.text

            # Parse versions strictly from AdminPanel modal to avoid false matches (dates like 19.10.2025, other modules).
            # The page contains both Release and Dev lists inside: id="moduleModal-AdminPanel".
            modal_match = re.search(
                r'id="moduleModal-AdminPanel"[\s\S]{0,80000}?</div>\s*</div>\s*</div>',
                html,
                re.IGNORECASE,
            )
            if not modal_match:
                result["error"] = "Не найден блок AdminPanel (moduleModal-AdminPanel) на странице"
                return result

            modal_html = modal_match.group(0)

            def _parse_versions_from_section(section: str) -> list[str]:
                # Find section header: >Release< or >Dev<
                m = re.search(rf'>\s*{re.escape(section)}\s*<', modal_html, re.IGNORECASE)
                if not m:
                    return []
                tail = modal_html[m.end():]
                # Stop at next section header (Release/Dev) to avoid mixing lists.
                stop = re.search(r'>\s*(Release|Dev)\s*<', tail, re.IGNORECASE)
                if stop:
                    tail = tail[: stop.start()]
                # Versions in this UI are rendered with a visible "v" prefix (badge like "v0.1.0").
                return re.findall(r'v(\d+\.\d+\.\d+(?:\.\d+)?)', tail, re.IGNORECASE)

            versions = _parse_versions_from_section("Dev" if channel == "dev" else "Release")
            if not versions:
                result["error"] = f"Не удалось найти версии в секции {channel.upper()} для AdminPanel"
                return result

            def parse_version(v: str) -> tuple:
                parts = v.lstrip('v').split('.')
                # Дополняем до 4 частей нулями: major.minor.patch.fix
                while len(parts) < 4:
                    parts.append('0')
                return tuple(int(p) for p in parts[:4])

            # Pick highest version from the selected section (Release/Dev).
            latest_version = sorted(versions, key=parse_version)[-1]
            result["latest_version"] = latest_version

            # Сравниваем версии
            try:
                current_tuple = parse_version(current_version)
                latest_tuple = parse_version(latest_version)
                result["update_available"] = latest_tuple > current_tuple

                # Определяем тип обновления
                if latest_tuple > current_tuple:
                    # Сравниваем первые 3 части (major.minor.patch)
                    current_base = current_tuple[:3]
                    latest_base = latest_tuple[:3]
                    if latest_base > current_base:
                        result["update_type"] = "major"  # Важное обновление (0.9.7 -> 0.9.8)
                    else:
                        result["update_type"] = "minor"  # Исправление (0.9.7 -> 0.9.7.6)
            except Exception:
                pass
                
    except httpx.TimeoutException:
        result["error"] = "Таймаут при проверке обновлений"
    except Exception as e:
        result["error"] = str(e)

    return result


GITHUB_PANEL_REPO = os.environ.get("ADMINPANEL_GITHUB_REPO", "Spakieone/AdminPanel")
BOT_API_MODULE_CHECK_URL = os.environ.get("ADMINPANEL_BOT_API_CHECK_URL", "https://pocomacho.ru/solonetbot/modules/")
BOT_API_VERSION_FILE = Path("/root/bot/modules/api/version.json")


def _get_bot_api_current_version() -> str:
    try:
        if BOT_API_VERSION_FILE.exists():
            data = json.loads(BOT_API_VERSION_FILE.read_text())
            return str(data.get("version", "0.0.0"))
    except Exception:
        pass
    return "0.0.0"


@api.get("/version/panel")
async def check_panel_version() -> Dict[str, Any]:
    """Проверить версию панели (adminpanel + ЛК) через GitHub releases."""
    current = _get_current_version()
    current_version = current.get("version", "0.0.0")
    result: Dict[str, Any] = {
        "current_version": current_version,
        "latest_version": None,
        "update_available": False,
        "release_date": current.get("release_date", ""),
        "latest_release_date": None,
        "error": None,
    }
    try:
        timeout = httpx.Timeout(connect=10.0, read=15.0, write=10.0, pool=10.0)
        url = f"https://api.github.com/repos/{GITHUB_PANEL_REPO}/releases/latest"
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            resp = await client.get(url, headers={"Accept": "application/vnd.github+json"})
            if resp.status_code == 404:
                result["error"] = "Репозиторий недоступен или релизов нет"
                return result
            if resp.status_code != 200:
                result["error"] = f"GitHub API: HTTP {resp.status_code}"
                return result
            data = resp.json()
            tag = str(data.get("tag_name", "")).lstrip("v")
            published = str(data.get("published_at", ""))[:10]
            result["latest_version"] = tag
            result["latest_release_date"] = published

            def _ver_tuple(v: str) -> tuple:
                parts = v.lstrip("v").split(".")
                while len(parts) < 4:
                    parts.append("0")
                return tuple(int(p) for p in parts[:4])

            try:
                result["update_available"] = _ver_tuple(tag) > _ver_tuple(current_version)
            except Exception:
                pass
    except httpx.TimeoutException:
        result["error"] = "Таймаут при проверке GitHub"
    except Exception as e:
        result["error"] = str(e)
    return result


@api.get("/version/bot-api")
async def check_bot_api_version() -> Dict[str, Any]:
    """Проверить версию API модуля бота."""
    current_version = _get_bot_api_current_version()
    result: Dict[str, Any] = {
        "current_version": current_version,
        "latest_version": None,
        "update_available": False,
        "error": None,
    }
    if not BOT_API_MODULE_CHECK_URL:
        return result
    try:
        timeout = httpx.Timeout(connect=10.0, read=15.0, write=10.0, pool=10.0)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            resp = await client.get(BOT_API_MODULE_CHECK_URL)
            if resp.status_code != 200:
                result["error"] = f"HTTP {resp.status_code}"
                return result
            html = resp.text
            modal_match = re.search(
                r'id="moduleModal-AdminPanel"[\s\S]{0,80000}?</div>\s*</div>\s*</div>',
                html, re.IGNORECASE,
            )
            if not modal_match:
                result["error"] = "Не найден блок версий на странице"
                return result
            modal_html = modal_match.group(0)
            # Parse only Release section (skip Dev)
            release_match = re.search(
                r'<div\s+class="versions-title">\s*Release\s*</div>\s*<ul\s+class="list-versions">([\s\S]*?)</ul>',
                modal_html, re.IGNORECASE,
            )
            release_html = release_match.group(1) if release_match else modal_html
            versions = re.findall(r'v(\d+\.\d+\.\d+(?:\.\d+)?)', release_html, re.IGNORECASE)
            if not versions:
                result["error"] = "Версии не найдены на странице"
                return result

            def _ver_tuple(v: str) -> tuple:
                parts = v.lstrip("v").split(".")
                while len(parts) < 4:
                    parts.append("0")
                return tuple(int(p) for p in parts[:4])

            # First version in the list is the newest (site sorts newest-first)
            latest = versions[0]
            result["latest_version"] = latest
            try:
                result["update_available"] = _ver_tuple(latest) > _ver_tuple(current_version)
            except Exception:
                pass
    except httpx.TimeoutException:
        result["error"] = "Таймаут при проверке обновлений"
    except Exception as e:
        result["error"] = str(e)
    return result


# -----------------------
# Auth
# -----------------------
@api.get("/auth/check")
def auth_check(request: Request) -> Dict[str, Any]:
    token = request.cookies.get(JWT_ACCESS_COOKIE)
    if not token:
        # backward compat: try legacy session cookie
        token = request.cookies.get(COOKIE_NAME)
        if token:
            sessions = _load_sessions()
            session = sessions.get(token)
            if isinstance(session, dict):
                role = _normalize_role_name(session.get("role"))
                return {
                    "authenticated": True,
                    "csrf_token": session.get("csrf_token"),
                    "username": session.get("username"),
                    "role": role,
                    "user_id": session.get("user_id"),
                }
        return {"authenticated": False}
    try:
        payload = jwt_verify_token(token, "access")
    except ValueError:
        return {"authenticated": False}
    if is_jti_revoked(payload.get("jti", "")):
        return {"authenticated": False}
    user_id = str(payload.get("sub") or "")
    tg_id: Optional[int] = None
    totp_enabled = False
    if user_id:
        try:
            u = panel_get_user_by_id(PANEL_USERS_DB_FILE, user_id)
            if u and isinstance(u, dict):
                tg_id = u.get("tg_id") or None
            totp_enabled = bool(is_totp_enabled(PANEL_USERS_DB_FILE, user_id))
        except Exception:
            pass
    return {
        "authenticated": True,
        "csrf_token": request.cookies.get(JWT_CSRF_COOKIE),
        "username": payload.get("username"),
        "role": _normalize_role_name(payload.get("role")),
        "user_id": user_id,
        "id": user_id,
        "tg_id": tg_id,
        "totp_enabled": totp_enabled,
    }


@api.get("/rbac/me")
def rbac_me(session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    role = _normalize_role_name((session or {}).get("role") or "viewer")
    roles_map = _get_roles_map_cached()
    role_obj = roles_map.get(role) or roles_map.get("viewer") or {}
    perms = role_obj.get("permissions") or []
    if not isinstance(perms, list):
        perms = []
    perms = [str(p) for p in perms if isinstance(p, str) and p.strip()]
    return {"ok": True, "role": role, "permissions": perms}


def _set_auth_cookies(resp: Response, user: Dict[str, Any], is_https: bool, csrf: Optional[str] = None) -> str:
    """Установить JWT cookies. Возвращает csrf_token."""
    user_id = str(user.get("id") or "")
    username = str(user.get("username") or "")
    role = _normalize_role_name(user.get("role"))
    access = create_access_token(user_id, username, role)
    refresh = create_refresh_token(user_id)
    if csrf is None:
        csrf = new_csrf_token()
    resp.set_cookie(JWT_ACCESS_COOKIE, access, httponly=True, samesite="lax", secure=is_https, path="/", max_age=ACCESS_EXP)
    resp.set_cookie(JWT_REFRESH_COOKIE, refresh, httponly=True, samesite="lax", secure=is_https, path="/", max_age=REFRESH_EXP)
    # csrf_token НЕ httpOnly — фронт читает его для заголовка
    resp.set_cookie(JWT_CSRF_COOKIE, csrf, httponly=False, samesite="lax", secure=is_https, path="/", max_age=ACCESS_EXP)
    return csrf


@api.post("/auth/login")
async def auth_login(request: Request) -> Response:
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")
    username = str(body.get("username") or "")
    password = str(body.get("password") or "")

    client_ip = request.client.host if request.client else "unknown"
    rate_key = f"{client_ip}:{username}".lower().strip()
    _login_guard.check(rate_key)

    # Primary auth: panel users DB
    user: Optional[Dict[str, Any]] = None
    try:
        user = panel_verify_login(PANEL_USERS_DB_FILE, username=username, password=password)
    except Exception:
        user = None

    # Fallback: legacy single-user credentials
    if not user:
        creds = _load_credentials()
        expected_user = str(creds.get("username") or "")
        password_hash = str(creds.get("password_hash") or "")
        if expected_user and password_hash:
            ok = username == expected_user and bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
            if ok:
                user = {"id": None, "username": expected_user, "role": "super_admin"}

    if not user:
        _login_guard.failure(rate_key)
        panel_append_audit(
            PANEL_USERS_DB_FILE, actor=username, action="login_failed",
            ip_address=client_ip,
            user_agent=request.headers.get("user-agent", "")[:256],
            status="failure",
        )
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")

    _login_guard.success(rate_key)
    is_https = request.headers.get("x-forwarded-proto", "").lower() == "https"

    # Проверяем TOTP
    user_id = str(user.get("id") or "")
    if user_id and is_totp_enabled(PANEL_USERS_DB_FILE, user_id):
        pending = create_2fa_pending_token(user_id, str(user.get("username") or ""), str(user.get("role") or "super_admin"))
        resp = JSONResponse({"authenticated": False, "2fa_required": True})
        resp.set_cookie(JWT_PENDING_COOKIE, pending, httponly=True, samesite="lax", secure=is_https, path="/", max_age=300)
        return resp

    csrf = new_csrf_token()
    resp = JSONResponse({"authenticated": True, "csrf_token": csrf})
    _set_auth_cookies(resp, user, is_https, csrf=csrf)
    panel_append_audit(
        PANEL_USERS_DB_FILE, actor=str(user.get("username") or username), action="login",
        ip_address=client_ip,
        user_agent=request.headers.get("user-agent", "")[:256],
    )
    return resp


@api.get("/auth/telegram/meta")
async def auth_telegram_meta(request: Request) -> Response:
    """Return Telegram bot_id and bot_username for Login Widget (fetched from bot API)."""
    try:
        data = await _lk_tg_call_bot("lk/auth/tg-meta", method="GET")
        if not data.get("ok") or not data.get("bot_id"):
            return JSONResponse({"ok": False})
        return JSONResponse({"ok": True, "bot_id": data["bot_id"], "bot_username": data.get("bot_username", "")})
    except Exception:
        return JSONResponse({"ok": False})


@api.post("/auth/telegram/login")
async def auth_telegram_login(request: Request) -> Response:
    """Verify Telegram OAuth result and log in panel user by tg_id."""
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")

    tg_auth_result = str(body.get("tgAuthResult") or "").strip()
    if not tg_auth_result:
        raise HTTPException(status_code=400, detail="Missing tgAuthResult")

    # Decode and verify the Telegram auth payload
    params = _lk_decode_tg_auth_result(tg_auth_result)
    tg_info = await _lk_verify_telegram_login(params)
    tg_id = int(tg_info["tg_id"])

    # Find panel user with this tg_id
    import sqlite3 as _sqlite3
    user: Optional[Dict[str, Any]] = None
    try:
        from panel_users_store import _LOCK as _pu_lock, _connect as _pu_connect
        with _pu_lock:
            conn = _pu_connect(PANEL_USERS_DB_FILE)
            try:
                row = conn.execute(
                    "SELECT id, username, role, tg_id, is_active FROM panel_users WHERE tg_id = ? AND is_active = 1 LIMIT 1;",
                    (tg_id,),
                ).fetchone()
                if row:
                    user = {"id": str(row["id"]), "username": str(row["username"]), "role": str(row["role"]), "tg_id": tg_id, "is_active": True}
            finally:
                conn.close()
    except Exception as e:
        logger.error("Telegram login DB error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Внутренняя ошибка сервера")

    if not user:
        raise HTTPException(status_code=401, detail="Telegram аккаунт не привязан к панели")

    is_https = request.headers.get("x-forwarded-proto", "").lower() == "https"
    csrf = new_csrf_token()
    resp = JSONResponse({"authenticated": True, "csrf_token": csrf})
    _set_auth_cookies(resp, user, is_https, csrf=csrf)
    client_ip = request.client.host if request.client else "unknown"
    panel_append_audit(
        PANEL_USERS_DB_FILE, actor=str(user.get("username") or ""), action="login_telegram",
        ip_address=client_ip,
        user_agent=request.headers.get("user-agent", "")[:256],
    )
    return resp


@api.post("/auth/logout")
def auth_logout(request: Request) -> Response:
    resp = JSONResponse({"ok": True})
    # Отзываем refresh токен (если есть)
    refresh_tok = request.cookies.get(JWT_REFRESH_COOKIE)
    if refresh_tok:
        try:
            payload = jwt_verify_token(refresh_tok, "refresh")
            revoke_jti(payload["jti"], float(payload.get("exp", time.time())))
        except Exception:
            pass
    # Удаляем все auth cookies
    resp.delete_cookie(JWT_ACCESS_COOKIE, path="/")
    resp.delete_cookie(JWT_REFRESH_COOKIE, path="/")
    resp.delete_cookie(JWT_CSRF_COOKIE, path="/")
    resp.delete_cookie(JWT_PENDING_COOKIE, path="/")
    resp.delete_cookie(COOKIE_NAME, path="/")  # legacy
    return resp


@api.post("/auth/refresh")
async def auth_refresh(request: Request) -> Response:
    refresh_tok = request.cookies.get(JWT_REFRESH_COOKIE)
    if not refresh_tok:
        raise HTTPException(status_code=401, detail="No refresh token")
    try:
        payload = jwt_verify_token(refresh_tok, "refresh")
    except ValueError:
        raise HTTPException(status_code=401, detail="Недействительный токен")
    if is_jti_revoked(payload.get("jti", "")):
        raise HTTPException(status_code=401, detail="Refresh token revoked")
    # Получаем актуальные данные пользователя
    user_id = payload.get("sub", "")
    user = panel_get_user_by_id(PANEL_USERS_DB_FILE, user_id) if user_id else None
    if not user or not user.get("is_active"):
        raise HTTPException(status_code=401, detail="User not found or inactive")
    is_https = request.headers.get("x-forwarded-proto", "").lower() == "https"
    csrf = new_csrf_token()
    resp = JSONResponse({"ok": True, "csrf_token": csrf})
    _set_auth_cookies(resp, user, is_https, csrf=csrf)
    return resp


@api.post("/auth/2fa/verify")
async def auth_2fa_verify(request: Request) -> Response:
    pending_tok = request.cookies.get(JWT_PENDING_COOKIE)
    if not pending_tok:
        raise HTTPException(status_code=401, detail="No pending 2FA session")
    try:
        payload = jwt_verify_token(pending_tok, "2fa_pending")
    except ValueError:
        raise HTTPException(status_code=401, detail="Недействительный токен")
    body = await request.json()
    code = str((body or {}).get("code") or "")
    user_id = payload.get("sub", "")
    if not verify_totp_code(PANEL_USERS_DB_FILE, user_id, code):
        raise HTTPException(status_code=401, detail="Неверный код 2FA")
    user = panel_get_user_by_id(PANEL_USERS_DB_FILE, user_id)
    if not user or not user.get("is_active"):
        raise HTTPException(status_code=401, detail="User not found")
    is_https = request.headers.get("x-forwarded-proto", "").lower() == "https"
    csrf = new_csrf_token()
    resp = JSONResponse({"authenticated": True, "csrf_token": csrf})
    _set_auth_cookies(resp, user, is_https, csrf=csrf)
    resp.delete_cookie(JWT_PENDING_COOKIE, path="/")
    panel_append_audit(
        PANEL_USERS_DB_FILE, actor=str(user.get("username") or ""), action="login_2fa",
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent", "")[:256],
    )
    return resp


@api.get("/auth/2fa/setup")
def auth_2fa_setup(request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    user_id = session.get("sub") or session.get("user_id") or ""
    username = session.get("username") or ""
    if not user_id:
        raise HTTPException(status_code=400, detail="Cannot setup 2FA for legacy user")
    secret = generate_totp_secret(PANEL_USERS_DB_FILE, user_id)
    try:
        import pyotp
        totp = pyotp.TOTP(secret)
        uri = totp.provisioning_uri(name=username, issuer_name="AdminPanel")
    except ImportError:
        uri = f"otpauth://totp/AdminPanel:{username}?secret={secret}&issuer=AdminPanel"
    return {"secret": secret, "otpauth_uri": uri}


@api.post("/auth/2fa/setup/confirm")
async def auth_2fa_setup_confirm(request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    _require_csrf(request, session)
    user_id = session.get("sub") or session.get("user_id") or ""
    if not user_id:
        raise HTTPException(status_code=400, detail="Cannot setup 2FA for legacy user")
    body = await request.json()
    code = str((body or {}).get("code") or "")
    try:
        backup_codes = enable_totp(PANEL_USERS_DB_FILE, user_id, code)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))  # validation msg, safe to show
    panel_append_audit(
        PANEL_USERS_DB_FILE, actor=session.get("username", ""), action="2fa_enabled",
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent", "")[:256],
    )
    return {"ok": True, "backup_codes": backup_codes}


@api.delete("/auth/2fa")
async def auth_2fa_disable(request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    _require_csrf(request, session)
    user_id = session.get("sub") or session.get("user_id") or ""
    if not user_id:
        raise HTTPException(status_code=400, detail="Cannot manage 2FA for legacy user")
    body = await request.json()
    password = str((body or {}).get("password") or "")
    user = panel_get_user_by_id(PANEL_USERS_DB_FILE, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    # Verify password
    verified = panel_verify_login(PANEL_USERS_DB_FILE, username=user["username"], password=password)
    if not verified:
        raise HTTPException(status_code=401, detail="Неверный пароль")
    disable_totp(PANEL_USERS_DB_FILE, user_id)
    panel_append_audit(
        PANEL_USERS_DB_FILE, actor=session.get("username", ""), action="2fa_disabled",
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent", "")[:256],
    )
    return {"ok": True}


@api.get("/auth/2fa/status")
def auth_2fa_status(session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    user_id = session.get("sub") or session.get("user_id") or ""
    if not user_id:
        return {"enabled": False}
    info = get_totp_info(PANEL_USERS_DB_FILE, user_id)
    return {"enabled": bool(info and info["enabled"]), "has_backup_codes": bool(info and info.get("has_backup_codes"))}


# -----------------------
# LK (user cabinet) auth: Telegram Login Widget (MVP)
# -----------------------
@api.get("/lk-module-api")
def lk_module_api_get(_session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    # Keep legacy manual override endpoint.
    resolved = _lk_resolve_module_api_base_url()
    cfg = _lk_load_module_api_config()
    active_lk = _lk_get_active_lk_profile()
    bot_profile_id = _lk_get_active_lk_bot_profile_id()
    return {
        "ok": True,
        "effective_base_url": resolved.get("base_url"),
        "mode": resolved.get("mode"),
        "lk_profile_id": str((active_lk or {}).get("id") or "").strip(),
        "bot_profile_id": bot_profile_id,
        "manual_base_url": cfg.get("base_url"),
    }


@api.patch("/lk-module-api")
async def lk_module_api_patch(request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    _require_csrf(request, session)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")
    _lk_save_module_api_config(payload)
    resolved = _lk_resolve_module_api_base_url()
    cfg = _lk_load_module_api_config()
    active_lk = _lk_get_active_lk_profile()
    bot_profile_id = _lk_get_active_lk_bot_profile_id()
    return {
        "ok": True,
        "effective_base_url": resolved.get("base_url"),
        "mode": resolved.get("mode"),
        "lk_profile_id": str((active_lk or {}).get("id") or "").strip(),
        "bot_profile_id": bot_profile_id,
        "manual_base_url": cfg.get("base_url"),
    }


def _lk_load_smtp_config() -> Dict[str, Any]:
    data = _read_json(LK_SMTP_FILE, {})
    if not isinstance(data, dict):
        data = {}
    raw_pass = str(data.get("pass") or "").strip()
    return {
        "host": str(data.get("host") or "").strip(),
        "port": int(data.get("port") or 587),
        "user": str(data.get("user") or "").strip(),
        "pass": _token_decrypt(raw_pass) if raw_pass else "",
        "from": str(data.get("from") or "").strip(),
    }


def _lk_save_smtp_config(data: Dict[str, Any]) -> None:
    raw_pass = str((data or {}).get("pass") or "").strip()
    cfg = {
        "host": str((data or {}).get("host") or "").strip(),
        "port": int((data or {}).get("port") or 587),
        "user": str((data or {}).get("user") or "").strip(),
        "pass": _token_encrypt(raw_pass) if raw_pass else "",
        "from": str((data or {}).get("from") or "").strip(),
    }
    _write_json(LK_SMTP_FILE, cfg)
    try:
        os.chmod(LK_SMTP_FILE, 0o600)
    except Exception:
        pass


@api.get("/lk-smtp")
def lk_smtp_get(_session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    cfg = _lk_load_smtp_config()
    # Never return password in plaintext — return masked version
    return {
        "ok": True,
        "host": cfg["host"],
        "port": cfg["port"],
        "user": cfg["user"],
        "pass_set": bool(cfg["pass"]),
        "from": cfg["from"],
    }


@api.patch("/lk-smtp")
async def lk_smtp_patch(request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    _require_csrf(request, session)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")
    # If password is empty string, keep existing one
    existing = _lk_load_smtp_config()
    new_pass = str(payload.get("pass") or "").strip()
    if not new_pass:
        payload["pass"] = existing["pass"]
    _lk_save_smtp_config(payload)
    cfg = _lk_load_smtp_config()
    return {
        "ok": True,
        "host": cfg["host"],
        "port": cfg["port"],
        "user": cfg["user"],
        "pass_set": bool(cfg["pass"]),
        "from": cfg["from"],
    }


@api.post("/lk-smtp/test")
async def lk_smtp_test(request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    _require_csrf(request, session)
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText as _MIMEText
    payload = await request.json()
    to_email = str(payload.get("email") or "").strip()
    if not to_email:
        raise HTTPException(status_code=400, detail="Укажите email")
    cfg = _lk_load_smtp_config()
    smtp_host = str(cfg.get("host") or "").strip()
    smtp_port = int(cfg.get("port") or 587)
    smtp_user = str(cfg.get("user") or "").strip()
    smtp_pass = str(cfg.get("pass") or "").strip()
    smtp_from = str(cfg.get("from") or smtp_user).strip()
    if not smtp_host or not smtp_user or not smtp_pass:
        raise HTTPException(status_code=400, detail="SMTP не настроен")
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = "Тест SMTP — всё работает"
        msg["From"] = smtp_from
        msg["To"] = to_email
        msg.attach(_MIMEText("Это тестовое письмо. SMTP настроен корректно.", "plain", "utf-8"))
        if smtp_port == 465:
            import ssl as _ssl
            with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=10, context=_ssl.create_default_context()) as s:
                s.login(smtp_user, smtp_pass)
                s.sendmail(smtp_from, [to_email], msg.as_string())
        else:
            with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as s:
                s.starttls()
                s.login(smtp_user, smtp_pass)
                s.sendmail(smtp_from, [to_email], msg.as_string())
        return {"ok": True}
    except Exception as exc:
        logger.error("SMTP send error: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Ошибка отправки письма")


def _lk_site_config_path(lk_profile_id: str) -> Path:
    safe = re.sub(r"[^a-zA-Z0-9_-]+", "", str(lk_profile_id or ""))
    return (LK_SITE_CONFIGS_DIR / f"{safe}.json").resolve()


def _lk_default_site_config(lk_profile: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    s = (lk_profile or {}).get("settings") or {}
    if not isinstance(s, dict):
        s = {}
    brand_title = str(s.get("brand_title") or "Личный кабинет").strip() or "Личный кабинет"
    return {
        "schema_version": 2,
        "brand_title": brand_title,
        "hero": {
            "title": "Вход в систему",
            "subtitle": "Введите логин и пароль для доступа",
        },
        "colors": {
            "primary": "#c8ff00",
            "background": "#0a0a0a",
            "text": "rgba(255,255,255,0.90)",
        },
        "links": {
            "support": "/support",
            "terms": "",
            "privacy": "",
        },
        "flags": {
            "show_support": True,
            "show_tariffs": True,
        },
        # Visual constructor pages config (zones/regions).
        # NOTE: LK frontend uses this for block rendering and drag&drop.
        "pages": {
            # Root page "/" (login/landing)
            "root": {
                "layout": "single",
                "regions": {
                    "main": [
                        {
                            "id": "root_auth",
                            "type": "auth",
                            "props": {
                                "title": "Добро пожаловать",
                                "subtitle": "Вход по email и паролю",
                            },
                        }
                    ]
                },
            },
            # Profile page "/me"
            "me": {
                "layout": "two_col",
                "regions": {
                    "left": [
                        {"id": "me_header", "type": "me_header", "props": {}},
                        {"id": "me_subscriptions", "type": "me_subscriptions", "props": {}},
                        {"id": "me_payments", "type": "me_payments", "props": {}},
                    ],
                    "right": [
                        {"id": "me_partner", "type": "me_partner", "props": {}},
                    ],
                },
            },
            # Tariffs page "/tariffs"
            "tariffs": {
                "layout": "single",
                "regions": {
                    "main": [
                        {"id": "tariffs_header", "type": "tariffs_header", "props": {}},
                        {"id": "tariffs_list", "type": "tariffs_list", "props": {}},
                    ]
                },
            },
            # Support page "/support"
            "support": {
                "layout": "single",
                "regions": {
                    "main": [
                        {"id": "support_header", "type": "support_header", "props": {}},
                        {"id": "support_chat", "type": "support_chat", "props": {}},
                    ]
                },
            },
            # Checkout page "/checkout"
            "checkout": {
                "layout": "single",
                "regions": {
                    "main": [
                        {"id": "checkout_header", "type": "checkout_header", "props": {}},
                        {"id": "checkout_flow", "type": "checkout_flow", "props": {}},
                    ]
                },
            },
        },
    }


def _deep_merge(base: Dict[str, Any], patch: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(base or {})
    for k, v in (patch or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out.get(k) or {}, v)
        else:
            out[k] = v
    return out


def _lk_normalize_site_config(cfg: Dict[str, Any], lk_profile: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Normalize LK site config:
    - ensure pages schema exists
    - ensure blocks have ids
    - keep backward-compat hero.title/subtitle in sync with root auth block
    """
    if not isinstance(cfg, dict):
        cfg = {}
    defaults = _lk_default_site_config(lk_profile)
    out = _deep_merge(defaults, cfg)

    pages = out.get("pages")
    if not isinstance(pages, dict):
        pages = {}
    # ensure known pages exist (from defaults)
    for k, v in (defaults.get("pages") or {}).items():
        if k not in pages:
            pages[k] = v
    out["pages"] = pages

    def _ensure_block_ids(page_obj: Any) -> None:
        if not isinstance(page_obj, dict):
            return
        regs = page_obj.get("regions")
        if not isinstance(regs, dict):
            return
        for rname, arr in list(regs.items()):
            if not isinstance(arr, list):
                continue
            new_arr = []
            for b in arr:
                if not isinstance(b, dict):
                    continue
                bid = str(b.get("id") or "").strip()
                if not bid:
                    bid = secrets.token_hex(8)
                    b["id"] = bid
                btype = str(b.get("type") or "").strip()
                if not btype:
                    b["type"] = "unknown"
                props = b.get("props")
                if props is None or not isinstance(props, dict):
                    b["props"] = {}
                new_arr.append(b)
            regs[rname] = new_arr
        page_obj["regions"] = regs

    for page_key, page_obj in pages.items():
        _ensure_block_ids(page_obj)

    # Backward-compat: sync hero.title/subtitle <-> root auth block props
    hero = out.get("hero")
    if not isinstance(hero, dict):
        hero = {}
    root_page = pages.get("root")
    auth_block: Optional[Dict[str, Any]] = None
    try:
        regs = (root_page or {}).get("regions") if isinstance(root_page, dict) else None
        main_blocks = (regs or {}).get("main") if isinstance(regs, dict) else None
        if isinstance(main_blocks, list):
            for b in main_blocks:
                if isinstance(b, dict) and str(b.get("type") or "") == "auth":
                    auth_block = b
                    break
    except Exception:
        auth_block = None

    # If root auth props missing -> fill from hero
    if auth_block is not None:
        props = auth_block.get("props") if isinstance(auth_block.get("props"), dict) else {}
        ht = str(props.get("title") or "").strip()
        hs = str(props.get("subtitle") or "").strip()
        hero_t = str(hero.get("title") or "").strip()
        hero_s = str(hero.get("subtitle") or "").strip()
        if not ht and hero_t:
            props["title"] = hero_t
        if not hs and hero_s:
            props["subtitle"] = hero_s
        # And always mirror back to hero (single source of truth: block props)
        hero["title"] = str(props.get("title") or "Вход в систему")
        hero["subtitle"] = str(props.get("subtitle") or "Введите логин и пароль для доступа")
        auth_block["props"] = props
        out["hero"] = hero

    return out


def _lk_load_site_config_for_profile(lk_profile: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    lk_profile_id = str((lk_profile or {}).get("id") or "").strip()
    defaults = _lk_default_site_config(lk_profile)
    if not lk_profile_id:
        return defaults
    try:
        path = _lk_site_config_path(lk_profile_id)
        if not str(path).startswith(str(LK_SITE_CONFIGS_DIR.resolve())):
            return defaults
        saved = _read_json(path, {})
        if not isinstance(saved, dict):
            saved = {}
        merged = _deep_merge(defaults, saved)
        return _lk_normalize_site_config(merged, lk_profile)
    except Exception:
        return _lk_normalize_site_config(defaults, lk_profile)


@api.get("/lk/site-config")
def lk_site_config_public(request: Request) -> Dict[str, Any]:
    """
    Public LK site config (no auth).
    Profile selection:
    - Prefer by Host/domain (LK profiles)
    - Fallback to active LK profile
    """
    lk_profile_id = str(request.query_params.get("lk_profile_id") or request.query_params.get("lkProfileId") or "").strip()
    p = _lk_get_lk_profile_by_id(lk_profile_id) if lk_profile_id else _lk_get_lk_profile_for_request(request)
    cfg = _lk_load_site_config_for_profile(p)
    return {"ok": True, "lk_profile_id": str((p or {}).get("id") or "").strip() or None, "config": cfg}


@api.get("/lk/site-config/admin")
def lk_site_config_admin(request: Request, _session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    lk_profile_id = str(request.query_params.get("lk_profile_id") or request.query_params.get("lkProfileId") or "").strip()
    p = _lk_get_lk_profile_by_id(lk_profile_id) if lk_profile_id else _lk_get_lk_profile_for_request(request)
    cfg = _lk_load_site_config_for_profile(p)
    return {"ok": True, "lk_profile_id": str((p or {}).get("id") or "").strip() or None, "config": cfg}


@api.patch("/lk/site-config")
async def lk_site_config_patch(request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    _require_csrf(request, session)
    lk_profile_id = str(request.query_params.get("lk_profile_id") or request.query_params.get("lkProfileId") or "").strip()
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")

    # Determine target profile
    target = _lk_get_lk_profile_by_id(lk_profile_id) if lk_profile_id else _lk_get_active_lk_profile()
    if not target:
        raise HTTPException(status_code=404, detail="LK профиль не найден")
    target_id = str(target.get("id") or "").strip()
    if not target_id:
        raise HTTPException(status_code=400, detail="Некорректный LK профиль")

    current = _lk_load_site_config_for_profile(target)
    merged = _deep_merge(current, payload)
    merged = _lk_normalize_site_config(merged, target)

    try:
        LK_SITE_CONFIGS_DIR.mkdir(parents=True, exist_ok=True)
        path = _lk_site_config_path(target_id)
        if not str(path).startswith(str(LK_SITE_CONFIGS_DIR.resolve())):
            raise HTTPException(status_code=400, detail="Invalid profile id")
        _write_json(path, merged)
        try:
            os.chmod(path, 0o600)
        except Exception:
            pass
    except HTTPException:
        raise
    except Exception as e:
        logger.error("lk-site-config save error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Ошибка сохранения")

    return {"ok": True, "lk_profile_id": target_id, "config": merged}


@api.get("/lk-profiles/")
def get_lk_profiles(_session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    data = _load_lk_profiles_data()
    profiles = data.get("profiles") if isinstance(data.get("profiles"), list) else []
    safe_profiles: list[Dict[str, Any]] = []
    for p in profiles:
        if not isinstance(p, dict):
            continue
        safe_profiles.append(
            {
                "id": p.get("id"),
                "name": p.get("name"),
                "botProfileIds": p.get("botProfileIds") or [],
                "settings": _lk_profile_settings_out(p),
            }
        )
    active_id = str(data.get("activeProfileId") or "").strip() or None
    return {"profiles": safe_profiles, "activeProfileId": active_id}


@api.post("/lk-profiles/")
async def create_lk_profile(request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    _require_csrf(request, session)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")
    data = _load_lk_profiles_data()
    profiles = data.get("profiles") if isinstance(data.get("profiles"), list) else []
    profiles = [p for p in profiles if isinstance(p, dict)]
    new_id = secrets.token_hex(16)
    selected_bot_profile_id = _normalize_single_bot_profile_id(payload.get("botProfileIds"))
    if not selected_bot_profile_id:
        raise HTTPException(status_code=400, detail="Укажите профиль бота для профиля ЛК")
    settings = payload.get("settings") or {}
    if not isinstance(settings, dict):
        settings = {}
    domain = _normalize_lk_domain(settings.get("domain") or settings.get("domains") or payload.get("domain") or payload.get("domains"))
    if not domain:
        raise HTTPException(status_code=400, detail="Укажите домен профиля ЛК")
    profile = {
        "id": new_id,
        "name": str(payload.get("name") or ""),
        "botProfileIds": [selected_bot_profile_id] if selected_bot_profile_id else [],
        "settings": {
            "brand_title": str(settings.get("brand_title") or settings.get("brandTitle") or ""),
            "domain": domain,
            "support_url": str(settings.get("support_url") or ""),
            "enabled_tariff_group_codes": settings.get("enabled_tariff_group_codes") or [],
            "enabled_payment_providers": settings.get("enabled_payment_providers") or [],
            "invite_tab_mode": str(settings.get("invite_tab_mode") or "auto"),
        },
    }
    profiles.append(profile)
    _enforce_unique_lk_binding(profiles, owner_profile_id=new_id, bot_profile_id=selected_bot_profile_id)
    _enforce_unique_lk_domain(profiles, owner_profile_id=new_id, domain=domain)
    data["profiles"] = profiles
    if not data.get("activeProfileId"):
        data["activeProfileId"] = new_id
    _save_lk_profiles_data(data)
    return {
        "id": new_id,
        "name": profile["name"],
        "botProfileIds": profile["botProfileIds"],
        "settings": _lk_profile_settings_out(profile),
        "activeProfileId": str(data.get("activeProfileId") or "").strip() or None,
    }


@api.put("/lk-profiles/{profile_id}")
async def update_lk_profile(profile_id: str, request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    _require_csrf(request, session)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")
    data = _load_lk_profiles_data()
    profiles = data.get("profiles") if isinstance(data.get("profiles"), list) else []
    profiles = [p for p in profiles if isinstance(p, dict)]
    updated: Optional[Dict[str, Any]] = None
    selected_bot_profile_id: Optional[str] = None
    domain_to_enforce: Optional[str] = None
    for p in profiles:
        if str(p.get("id") or "") == profile_id:
            if "name" in payload:
                p["name"] = str(payload.get("name") or "")
            if "botProfileIds" in payload:
                selected_bot_profile_id = _normalize_single_bot_profile_id(payload.get("botProfileIds"))
                p["botProfileIds"] = [selected_bot_profile_id] if selected_bot_profile_id else []
            if "settings" in payload and isinstance(payload.get("settings"), dict):
                s = payload.get("settings") or {}
                cur = p.get("settings") or {}
                if not isinstance(cur, dict):
                    cur = {}
                cur_domain = _normalize_lk_domain(cur.get("domain") or cur.get("domains"))
                incoming_domain_present = ("domain" in s) or ("domains" in s)
                incoming_domain = _normalize_lk_domain(s.get("domain") or s.get("domains"))
                resolved_domain = incoming_domain if incoming_domain_present else cur_domain
                p["settings"] = {
                    "brand_title": str(s.get("brand_title") or s.get("brandTitle") or cur.get("brand_title") or cur.get("brandTitle") or ""),
                    "domain": resolved_domain,
                    "support_url": str(s.get("support_url") if "support_url" in s else cur.get("support_url") or ""),
                    "enabled_tariff_group_codes": (s.get("enabled_tariff_group_codes") if "enabled_tariff_group_codes" in s else cur.get("enabled_tariff_group_codes")) or [],
                    "enabled_payment_providers": (s.get("enabled_payment_providers") if "enabled_payment_providers" in s else cur.get("enabled_payment_providers")) or [],
                    "invite_tab_mode": str(s.get("invite_tab_mode") if "invite_tab_mode" in s else (cur.get("invite_tab_mode") or "auto")),
                }
            if ("domain" in payload) or ("domains" in payload):
                selected = _normalize_lk_domain(payload.get("domain") or payload.get("domains"))
                cur = p.get("settings") or {}
                if not isinstance(cur, dict):
                    cur = {}
                cur["domain"] = selected
                try:
                    cur.pop("domains", None)
                except Exception:
                    pass
                p["settings"] = cur
            domain_to_enforce = _lk_get_profile_domain(p)
            updated = p
            break
    if not updated:
        raise HTTPException(status_code=404, detail="Profile not found")
    if not _normalize_single_bot_profile_id(updated.get("botProfileIds")):
        raise HTTPException(status_code=400, detail="Укажите профиль бота для профиля ЛК")
    if selected_bot_profile_id is not None:
        _enforce_unique_lk_binding(profiles, owner_profile_id=profile_id, bot_profile_id=selected_bot_profile_id)
    else:
        _enforce_unique_lk_binding(profiles, owner_profile_id=profile_id, bot_profile_id="")
    _enforce_unique_lk_domain(profiles, owner_profile_id=profile_id, domain=(domain_to_enforce or _lk_get_profile_domain(updated)))
    data["profiles"] = profiles
    _save_lk_profiles_data(data)
    return {
        "id": updated.get("id"),
        "name": updated.get("name"),
        "botProfileIds": updated.get("botProfileIds") or [],
        "settings": _lk_profile_settings_out(updated),
        "activeProfileId": str(data.get("activeProfileId") or "").strip() or None,
    }


@api.delete("/lk-profiles/{profile_id}")
def delete_lk_profile(profile_id: str, request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    _require_csrf(request, session)
    data = _load_lk_profiles_data()
    profiles = data.get("profiles") if isinstance(data.get("profiles"), list) else []
    profiles = [p for p in profiles if isinstance(p, dict) and str(p.get("id") or "") != profile_id]
    data["profiles"] = profiles
    if str(data.get("activeProfileId") or "") == profile_id:
        data["activeProfileId"] = str((profiles[0].get("id") if profiles else "") or "") or None
    _save_lk_profiles_data(data)
    return {"ok": True, "activeProfileId": str(data.get("activeProfileId") or "").strip() or None}


@api.post("/lk-profiles/{profile_id}/set-active")
def set_active_lk_profile(profile_id: str, request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    _require_csrf(request, session)
    data = _load_lk_profiles_data()
    profiles = data.get("profiles") if isinstance(data.get("profiles"), list) else []
    if not any(isinstance(p, dict) and str(p.get("id") or "") == profile_id for p in profiles):
        raise HTTPException(status_code=404, detail="Profile not found")
    data["activeProfileId"] = profile_id
    _save_lk_profiles_data(data)
    return {"ok": True, "activeProfileId": profile_id}


@api.get("/lk-binding")
def lk_binding_get(_session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    resolved = _lk_resolve_module_api_base_url()
    bot_profile_id = _lk_get_active_lk_bot_profile_id()
    active_lk = _lk_get_active_lk_profile()
    return {
        "ok": True,
        "lk_profile_id": str((active_lk or {}).get("id") or "").strip(),
        "bot_profile_id": bot_profile_id,
        "effective_base_url": resolved.get("base_url"),
        "mode": resolved.get("mode"),
    }


@api.patch("/lk-binding")
async def lk_binding_patch(request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    _require_csrf(request, session)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")
    # Legacy endpoint: set binding for ACTIVE LK profile (create one if missing).
    bot_profile_id = str(payload.get("bot_profile_id") or payload.get("botProfileId") or "").strip()
    if bot_profile_id and not _lk_get_bot_profile_by_id(bot_profile_id):
        raise HTTPException(status_code=400, detail="Некорректный bot_profile_id")
    data = _load_lk_profiles_data()
    profiles = data.get("profiles") if isinstance(data.get("profiles"), list) else []
    profiles = [p for p in profiles if isinstance(p, dict)]
    active_id = str(data.get("activeProfileId") or "").strip()
    if not active_id:
        active_id = secrets.token_hex(16)
        profiles.append({"id": active_id, "name": "LK", "botProfileIds": [], "settings": {"brand_title": ""}})
        data["activeProfileId"] = active_id
    updated = False
    for p in profiles:
        if str(p.get("id") or "").strip() == active_id:
            p["botProfileIds"] = [bot_profile_id] if bot_profile_id else []
            updated = True
            break
    if not updated:
        profiles.append({"id": active_id, "name": "LK", "botProfileIds": [bot_profile_id] if bot_profile_id else [], "settings": {"brand_title": ""}})
    _enforce_unique_lk_binding(profiles, owner_profile_id=active_id, bot_profile_id=bot_profile_id)
    data["profiles"] = profiles
    _save_lk_profiles_data(data)
    resolved = _lk_resolve_module_api_base_url()
    return {
        "ok": True,
        "lk_profile_id": active_id,
        "bot_profile_id": bot_profile_id,
        "effective_base_url": resolved.get("base_url"),
        "mode": resolved.get("mode"),
    }


@api.get("/lk/auth/telegram/meta")
async def lk_telegram_meta(request: Request) -> Response:
    return await _proxy_to_lk_module_api(request, "lk/auth/telegram/meta")


def _lk_list_bot_profiles() -> Tuple[List[Dict[str, Any]], Optional[str]]:
    data = _read_json(BOT_PROFILES_FILE, {"profiles": [], "activeProfileId": None})
    if not isinstance(data, dict):
        data = {"profiles": [], "activeProfileId": None}
    profiles = data.get("profiles") if isinstance(data.get("profiles"), list) else []
    profiles = [p for p in profiles if isinstance(p, dict)]
    active_id = str(data.get("activeProfileId") or "").strip() or None
    return profiles, active_id


def _lk_get_bot_profile_by_id(profile_id: str) -> Optional[Dict[str, Any]]:
    pid = str(profile_id or "").strip()
    if not pid:
        return None
    profiles, _active = _lk_list_bot_profiles()
    for p in profiles:
        if str(p.get("id") or "").strip() == pid:
            p = dict(p)
            p["token"] = _token_decrypt(str(p.get("token") or ""))
            return p
    return None


def _lk_choose_bot_profile_id(bot_username: Optional[str]) -> Optional[str]:
    """
    Choose which bot-profile to use for LK data.
    Important: MUST NOT depend on admin panel "active profile" switching.
    Priority:
    1) Env LK_BOT_PROFILE_ID (explicit pin)
    2) Heuristic match by Telegram bot username (ex: VPNBOTPEPEBOT -> profile name/URL contains 'pepe')
    3) Fallback: activeProfileId from bot_profiles.json (or first profile)
    """
    env_pid = str(os.environ.get(LK_BOT_PROFILE_ID_ENV) or "").strip()
    if env_pid and _lk_get_bot_profile_by_id(env_pid):
        return env_pid

    profiles, active_id = _lk_list_bot_profiles()
    if not profiles:
        return None

    def norm(s: Any) -> str:
        return "".join(ch.lower() for ch in str(s or "") if ch.isalnum())

    bn = norm(bot_username)
    best_score = -1
    best_id: Optional[str] = None
    for p in profiles:
        pid = str(p.get("id") or "").strip()
        if not pid:
            continue
        name = norm(p.get("name"))
        url = str(p.get("botApiUrl") or "").lower()
        score = 0
        if bn and name and (name in bn or bn in name):
            score += 100
        if score > best_score:
            best_score = score
            best_id = pid

    if best_id and best_score > 0:
        return best_id

    if active_id and _lk_get_bot_profile_by_id(active_id):
        return active_id

    return str(profiles[0].get("id") or "").strip() or None


def _lk_get_bot_profile_for_session(session: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    pid = str((session or {}).get("bot_profile_id") or "").strip()
    if pid:
        p = _lk_get_bot_profile_by_id(pid)
        if p:
            return p
    chosen = _lk_choose_bot_profile_id("")
    return _lk_get_bot_profile_by_id(chosen) if chosen else None


async def _lk_fetch_bot_json(profile: Dict[str, Any], path: str, params: Optional[Dict[str, Any]] = None) -> Any:
    """
    Fetch JSON from Bot AdminPanel module API using the configured bot-profile.
    """
    base_url = get_bot_api_base_url(profile)
    token = str(profile.get("token") or "").strip()
    admin_id = str(profile.get("adminId") or "").strip()
    if not base_url:
        raise HTTPException(status_code=400, detail="Bot API base URL не настроен")

    url = base_url.rstrip("/") + "/" + path.lstrip("/")
    qp: Dict[str, Any] = {}
    if admin_id:
        qp["tg_id"] = admin_id
    qp.update({k: v for k, v in (params or {}).items() if v is not None and v != ""})

    headers: Dict[str, str] = {"Accept": "application/json"}
    if token:
        headers["X-Token"] = token

    timeout = httpx.Timeout(connect=10.0, read=30.0, write=30.0, pool=10.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, headers=headers) as client:
        resp = await client.get(url, params=qp)
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail="Bot API недоступен")
        return resp.json()


def _lk_client_ip(request: Request) -> str:
    return (request.headers.get("x-forwarded-for", "").split(",")[0].strip()
            or (request.client.host if request.client else "") or "unknown")

def _lk_rate_check(request: Request) -> None:
    """Apply LK rate limit (60 req/min per IP). Raises 429 if exceeded."""
    ip = _lk_client_ip(request)
    _lk_guard.check(ip)
    _lk_guard.failure(ip)


@api.get("/lk/auth/telegram/callback")
async def lk_telegram_callback(request: Request) -> Response:
    _lk_rate_check(request)
    return await _proxy_to_lk_module_api(request, "lk/auth/telegram/callback")


@api.get("/lk/tariffs")
async def lk_public_tariffs(request: Request) -> Response:
    _lk_rate_check(request)
    return await _proxy_to_lk_module_api(request, "lk/tariffs")


@api.get("/lk/me")
async def lk_me(request: Request) -> Response:
    _lk_rate_check(request)
    return await _proxy_to_lk_module_api(request, "lk/me")


def _lk_support_db_init() -> None:
    """
    Init support chat SQLite DB (AdminPanel-side storage).
    Safe to call multiple times.
    """
    try:
        LK_SUPPORT_DB_FILE.parent.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    conn = sqlite3.connect(str(LK_SUPPORT_DB_FILE), timeout=30, check_same_thread=False)
    try:
        try:
            conn.execute("PRAGMA journal_mode=WAL;")
        except Exception:
            pass
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lk_profile_id TEXT NOT NULL,
                tg_id BIGINT NOT NULL,
                sender TEXT NOT NULL CHECK (sender IN ('user', 'admin')),
                message TEXT NOT NULL,
                attachments TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                is_read INTEGER DEFAULT 0
            );
            """
        )
        # Backward-compatible migration: add attachments column for older DBs.
        try:
            conn.execute("ALTER TABLE messages ADD COLUMN attachments TEXT;")
        except Exception:
            pass
        conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_profile_tg_id ON messages(lk_profile_id, tg_id, id);")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_profile_sender_read ON messages(lk_profile_id, tg_id, sender, is_read);")
        conn.commit()
    finally:
        try:
            conn.close()
        except Exception:
            pass
    try:
        os.chmod(LK_SUPPORT_DB_FILE, 0o600)
    except Exception:
        pass


def _lk_support_db_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(LK_SUPPORT_DB_FILE), timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def _lk_support_db_insert_message(
    lk_profile_id: str,
    tg_id: int,
    sender: str,
    message: str,
    attachments: Optional[List[str]] = None,
) -> int:
    _lk_support_db_init()
    conn = _lk_support_db_conn()
    try:
        att = attachments if isinstance(attachments, list) else []
        att_json = json.dumps([str(x) for x in att if str(x or "").strip()], ensure_ascii=False)
        cur = conn.execute(
            "INSERT INTO messages (lk_profile_id, tg_id, sender, message, attachments, is_read) VALUES (?, ?, ?, ?, ?, 0);",
            (lk_profile_id, int(tg_id), str(sender), str(message), att_json),
        )
        conn.commit()
        return int(cur.lastrowid or 0)
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _lk_support_db_mark_read(lk_profile_id: str, tg_id: int, sender: str) -> None:
    _lk_support_db_init()
    conn = _lk_support_db_conn()
    try:
        conn.execute(
            "UPDATE messages SET is_read = 1 WHERE lk_profile_id = ? AND tg_id = ? AND sender = ? AND is_read = 0;",
            (lk_profile_id, int(tg_id), str(sender)),
        )
        conn.commit()
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _lk_support_db_list_messages(lk_profile_id: str, tg_id: int, limit: int = 100) -> List[Dict[str, Any]]:
    _lk_support_db_init()
    conn = _lk_support_db_conn()
    try:
        cur = conn.execute(
            "SELECT id, tg_id, sender, message, attachments, created_at, is_read FROM messages WHERE lk_profile_id = ? AND tg_id = ? ORDER BY id DESC LIMIT ?;",
            (lk_profile_id, int(tg_id), int(limit)),
        )
        rows = [dict(r) for r in cur.fetchall()]
        rows.reverse()
        out: List[Dict[str, Any]] = []
        for r in rows:
            raw_att = r.get("attachments")
            att_list: List[str] = []
            if raw_att:
                try:
                    parsed = json.loads(str(raw_att))
                    if isinstance(parsed, list):
                        att_list = [str(x) for x in parsed if str(x or "").strip()]
                except Exception:
                    att_list = []
            out.append(
                {
                    "id": int(r.get("id") or 0),
                    "tg_id": str(r.get("tg_id") or ""),
                    "sender": str(r.get("sender") or ""),
                    "message": str(r.get("message") or ""),
                    "attachments": att_list,
                    "created_at": str(r.get("created_at") or ""),
                    "is_read": bool(int(r.get("is_read") or 0)),
                }
            )
        return out
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _lk_support_normalize_attachment_ids(v: Any) -> List[str]:
    if not isinstance(v, list):
        return []
    out: List[str] = []
    for x in v[:6]:
        s = str(x or "").strip()
        if not s:
            continue
        # Only accept filenames generated by upload endpoints.
        if "/" in s or "\\" in s or ".." in s:
            continue
        if len(s) > 200:
            continue
        out.append(s)
    # de-dup while keeping order
    uniq: List[str] = []
    seen: set[str] = set()
    for s in out:
        if s in seen:
            continue
        seen.add(s)
        uniq.append(s)
    return uniq


def _lk_support_db_list_conversations(lk_profile_id: str, limit: int = 200) -> List[Dict[str, Any]]:
    _lk_support_db_init()
    conn = _lk_support_db_conn()
    try:
        cur = conn.execute(
            """
            SELECT
                t.tg_id AS tg_id,
                t.unread_count AS unread_count,
                m.sender AS last_sender,
                m.message AS last_message,
                m.created_at AS last_created_at,
                m.id AS last_id
            FROM (
                SELECT
                    tg_id,
                    MAX(id) AS last_id,
                    SUM(CASE WHEN sender = 'user' AND is_read = 0 THEN 1 ELSE 0 END) AS unread_count
                FROM messages
                WHERE lk_profile_id = ?
                GROUP BY tg_id
            ) t
            JOIN messages m ON m.id = t.last_id
            ORDER BY t.last_id DESC
            LIMIT ?;
            """,
            (lk_profile_id, int(limit)),
        )
        out: List[Dict[str, Any]] = []
        for r in cur.fetchall():
            row = dict(r)
            out.append(
                {
                    "tg_id": str(row.get("tg_id") or ""),
                    "unread_count": int(row.get("unread_count") or 0),
                    "last_sender": str(row.get("last_sender") or ""),
                    "last_message": str(row.get("last_message") or ""),
                    "last_created_at": str(row.get("last_created_at") or ""),
                    "last_id": int(row.get("last_id") or 0),
                }
            )
        return out
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _lk_support_get_lk_profile_id_for_request_strict(request: Request) -> str:
    host = _lk_extract_request_host(request)
    if not host:
        raise HTTPException(status_code=404, detail="ЛК для этого домена не настроен")
    lk_p = _lk_pick_lk_profile_for_host(host)
    if not lk_p:
        raise HTTPException(status_code=404, detail="ЛК для этого домена не настроен")
    pid = str(lk_p.get("id") or "").strip()
    if not pid:
        raise HTTPException(status_code=404, detail="ЛК для этого домена не настроен")
    return pid


async def _lk_support_fetch_lk_me(request: Request) -> Dict[str, Any]:
    resolved = _lk_resolve_module_api_base_url_for_request(request)
    base_url = str(resolved.get("base_url") or "").strip().rstrip("/")
    if not base_url:
        mode = str(resolved.get("mode") or "")
        if mode == "lk_profile_missing":
            raise HTTPException(status_code=404, detail="ЛК для этого домена не настроен")
        if mode == "lk_profile_unbound":
            raise HTTPException(status_code=409, detail="Профиль ЛК не привязан к профилю бота")
        if mode == "bot_base_url_missing":
            raise HTTPException(status_code=502, detail="Bot API base URL не настроен для выбранного профиля")
        raise HTTPException(status_code=400, detail="LK Module API base_url не настроен")

    url = base_url + "/lk/me"
    headers: Dict[str, str] = {"Accept": "application/json"}
    cookie = request.headers.get("cookie")
    if cookie:
        headers["Cookie"] = cookie
    headers["X-Forwarded-Proto"] = request.headers.get("x-forwarded-proto") or request.url.scheme or "http"
    xf_host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    if xf_host:
        headers["X-Forwarded-Host"] = xf_host

    timeout = httpx.Timeout(connect=10.0, read=15.0, write=15.0, pool=10.0)
    limits = httpx.Limits(max_connections=50, max_keepalive_connections=10, keepalive_expiry=15.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False, limits=limits) as client:
        try:
            resp = await client.get(url, headers=headers)
        except httpx.RequestError as e:
            raise HTTPException(status_code=502, detail=f"LK Module API недоступен: {e.__class__.__name__}")

    if resp.status_code == 401:
        raise HTTPException(status_code=401, detail="Не авторизован")
    try:
        data = resp.json()
    except Exception:
        data = {}
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=str((data or {}).get("detail") or "Ошибка ЛК"))
    if not isinstance(data, dict) or not data.get("authenticated"):
        raise HTTPException(status_code=401, detail="Не авторизован")
    return data


@api.get("/lk/support/messages")
async def lk_support_messages(request: Request) -> Dict[str, Any]:
    lk_profile_id = _lk_support_get_lk_profile_id_for_request_strict(request)
    me = await _lk_support_fetch_lk_me(request)
    try:
        tg_id = int(me.get("tg_id") or 0)
    except Exception:
        tg_id = 0
    if tg_id <= 0:
        raise HTTPException(status_code=401, detail="Не авторизован")

    items = await run_in_threadpool(_lk_support_db_list_messages, lk_profile_id, tg_id, 100)
    for it in items:
        att_ids = it.get("attachments") if isinstance(it, dict) else []
        if isinstance(att_ids, list):
            it["attachments"] = [f"/api/lk/support/uploads/{aid}" for aid in _lk_support_normalize_attachment_ids(att_ids)]
    # Mark admin messages as read by user
    await run_in_threadpool(_lk_support_db_mark_read, lk_profile_id, tg_id, "admin")
    return {"ok": True, "items": items}


@api.post("/lk/support/send")
async def lk_support_send(request: Request) -> Dict[str, Any]:
    lk_profile_id = _lk_support_get_lk_profile_id_for_request_strict(request)
    me = await _lk_support_fetch_lk_me(request)
    csrf = str(me.get("csrf_token") or "")
    csrf_h = str(request.headers.get("x-csrf-token") or request.headers.get("x-csrf") or "")
    if not csrf or not csrf_h or csrf_h != csrf:
        raise HTTPException(status_code=403, detail="Некорректный CSRF токен")
    try:
        tg_id = int(me.get("tg_id") or 0)
    except Exception:
        tg_id = 0
    if tg_id <= 0:
        raise HTTPException(status_code=401, detail="Не авторизован")

    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")
    message = str(payload.get("message") or "").strip()
    attachments = _lk_support_normalize_attachment_ids(payload.get("attachments"))
    if not message and not attachments:
        raise HTTPException(status_code=400, detail="Пустое сообщение")
    if len(message) > 4000:
        raise HTTPException(status_code=400, detail="Слишком длинное сообщение")

    await run_in_threadpool(_lk_support_db_insert_message, lk_profile_id, tg_id, "user", message, attachments)
    return {"ok": True}


@api.post("/lk/support/upload")
async def lk_support_upload(request: Request, file: UploadFile = File(...)) -> Dict[str, Any]:
    lk_profile_id = _lk_support_get_lk_profile_id_for_request_strict(request)
    me = await _lk_support_fetch_lk_me(request)
    csrf = str(me.get("csrf_token") or "")
    csrf_h = str(request.headers.get("x-csrf-token") or request.headers.get("x-csrf") or "")
    if not csrf or not csrf_h or csrf_h != csrf:
        raise HTTPException(status_code=403, detail="Некорректный CSRF токен")
    # ensure user is authed (me check above) and has tg_id
    try:
        _ = int(me.get("tg_id") or 0)
    except Exception:
        raise HTTPException(status_code=401, detail="Не авторизован")

    filename = str(file.filename or "").strip()
    ext = Path(filename).suffix.lower()
    allowed = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
    if ext not in allowed:
        raise HTTPException(status_code=400, detail="Поддерживаются только: png, jpg, jpeg, webp, gif")

    header = await file.read(12)
    if not _check_image_magic(header, ext):
        raise HTTPException(status_code=400, detail="Тип файла не соответствует расширению")

    LK_SUPPORT_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    out_name = f"{int(time.time())}_{secrets.token_hex(8)}{ext}"
    out_path = (LK_SUPPORT_UPLOADS_DIR / out_name).resolve()
    if not str(out_path).startswith(str(LK_SUPPORT_UPLOADS_DIR.resolve())):
        raise HTTPException(status_code=400, detail="Invalid filename")

    max_bytes = 10 * 1024 * 1024  # 10MB
    size = len(header)
    with out_path.open("wb") as f:
        f.write(header)
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > max_bytes:
                try:
                    out_path.unlink(missing_ok=True)
                except Exception:
                    pass
                raise HTTPException(status_code=413, detail="Файл слишком большой (макс 10MB)")
            f.write(chunk)
    try:
        os.chmod(out_path, 0o644)
    except Exception:
        pass

    return {"ok": True, "id": out_name, "lk_profile_id": lk_profile_id, "url": f"/api/lk/support/uploads/{out_name}"}


@api.get("/lk/support/uploads/{file_id:path}")
async def lk_support_upload_get(file_id: str, request: Request) -> Response:
    # Require LK auth; the cookies will be sent by the browser.
    _ = await _lk_support_fetch_lk_me(request)
    fid = str(file_id or "").lstrip("/").strip()
    if not fid or "/" in fid or "\\" in fid or ".." in fid or len(fid) > 220:
        raise HTTPException(status_code=400, detail="Некорректный файл")
    path = (LK_SUPPORT_UPLOADS_DIR / fid).resolve()
    if not str(path).startswith(str(LK_SUPPORT_UPLOADS_DIR.resolve())):
        raise HTTPException(status_code=400, detail="Некорректный файл")
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Файл не найден")
    return FileResponse(str(path))


@api.get("/lk-support/conversations")
def lk_support_admin_conversations(lk_profile_id: str, session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    # session dependency ensures admin panel auth
    _ = session
    pid = str(lk_profile_id or "").strip()
    if not pid or not _lk_get_lk_profile_by_id(pid):
        raise HTTPException(status_code=404, detail="Профиль ЛК не найден")
    items = _lk_support_db_list_conversations(pid, 200)
    return {"ok": True, "items": items}


@api.get("/lk-support/messages/{tg_id}")
def lk_support_admin_messages(tg_id: int, lk_profile_id: str, session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    _ = session
    pid = str(lk_profile_id or "").strip()
    if not pid or not _lk_get_lk_profile_by_id(pid):
        raise HTTPException(status_code=404, detail="Профиль ЛК не найден")
    if tg_id <= 0:
        raise HTTPException(status_code=400, detail="Некорректный tg_id")
    items = _lk_support_db_list_messages(pid, int(tg_id), 200)
    for it in items:
        att_ids = it.get("attachments") if isinstance(it, dict) else []
        if isinstance(att_ids, list):
            it["attachments"] = [f"/webpanel/api/lk-support/uploads/{aid}" for aid in _lk_support_normalize_attachment_ids(att_ids)]
    # Mark user messages as read by admin
    _lk_support_db_mark_read(pid, int(tg_id), "user")
    return {"ok": True, "items": items}


@api.post("/lk-support/reply/{tg_id}")
async def lk_support_admin_reply(tg_id: int, lk_profile_id: str, request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    _require_csrf(request, session)
    pid = str(lk_profile_id or "").strip()
    if not pid or not _lk_get_lk_profile_by_id(pid):
        raise HTTPException(status_code=404, detail="Профиль ЛК не найден")
    if tg_id <= 0:
        raise HTTPException(status_code=400, detail="Некорректный tg_id")
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")
    message = str(payload.get("message") or "").strip()
    attachments = _lk_support_normalize_attachment_ids(payload.get("attachments"))
    if not message and not attachments:
        raise HTTPException(status_code=400, detail="Пустое сообщение")
    if len(message) > 4000:
        raise HTTPException(status_code=400, detail="Слишком длинное сообщение")
    await run_in_threadpool(_lk_support_db_insert_message, pid, int(tg_id), "admin", message, attachments)
    return {"ok": True}


@api.post("/lk-support/upload")
async def lk_support_admin_upload(request: Request, file: UploadFile = File(...), session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    _require_csrf(request, session)
    filename = str(file.filename or "").strip()
    ext = Path(filename).suffix.lower()
    allowed = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
    if ext not in allowed:
        raise HTTPException(status_code=400, detail="Поддерживаются только: png, jpg, jpeg, webp, gif")

    header = await file.read(12)
    if not _check_image_magic(header, ext):
        raise HTTPException(status_code=400, detail="Тип файла не соответствует расширению")

    LK_SUPPORT_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    out_name = f"{int(time.time())}_{secrets.token_hex(8)}{ext}"
    out_path = (LK_SUPPORT_UPLOADS_DIR / out_name).resolve()
    if not str(out_path).startswith(str(LK_SUPPORT_UPLOADS_DIR.resolve())):
        raise HTTPException(status_code=400, detail="Invalid filename")

    max_bytes = 10 * 1024 * 1024  # 10MB
    size = len(header)
    with out_path.open("wb") as f:
        f.write(header)
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > max_bytes:
                try:
                    out_path.unlink(missing_ok=True)
                except Exception:
                    pass
                raise HTTPException(status_code=413, detail="Файл слишком большой (макс 10MB)")
            f.write(chunk)
    try:
        os.chmod(out_path, 0o644)
    except Exception:
        pass
    return {"ok": True, "id": out_name, "url": f"/webpanel/api/lk-support/uploads/{out_name}"}


@api.get("/lk-support/uploads/{file_id:path}")
def lk_support_admin_upload_get(file_id: str, session: Dict[str, Any] = Depends(_require_auth)) -> Response:
    _ = session
    fid = str(file_id or "").lstrip("/").strip()
    if not fid or "/" in fid or "\\" in fid or ".." in fid or len(fid) > 220:
        raise HTTPException(status_code=400, detail="Некорректный файл")
    path = (LK_SUPPORT_UPLOADS_DIR / fid).resolve()
    if not str(path).startswith(str(LK_SUPPORT_UPLOADS_DIR.resolve())):
        raise HTTPException(status_code=400, detail="Некорректный файл")
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Файл не найден")
    return FileResponse(str(path))


def _lk_read_user_data(tg_id: int) -> Dict[str, Any]:
    data = _read_json(LK_DATA_FILE, {})
    if not isinstance(data, dict):
        data = {}
    users = data.get("users") if isinstance(data.get("users"), dict) else {}
    u = users.get(str(tg_id)) if isinstance(users, dict) else None
    return u if isinstance(u, dict) else {}


@api.get("/lk/subscriptions")
async def lk_subscriptions(request: Request) -> Response:
    _lk_rate_check(request)
    return await _proxy_to_lk_module_api(request, "lk/subscriptions")


@api.get("/lk/payments/history")
async def lk_payments_history(request: Request) -> Response:
    _lk_rate_check(request)
    return await _proxy_to_lk_module_api(request, "lk/payments/history")


@api.get("/lk/auth/logout")
async def lk_logout(request: Request) -> Response:
    return await _proxy_to_lk_module_api(request, "lk/auth/logout")


@api.post("/lk/auth/email/request-code")
async def lk_email_request_code(request: Request) -> Response:
    """
    Adminpanel генерирует OTP сам, отправляет email через SMTP,
    затем передаёт код боту через /lk/auth/email/store-code.
    Код никогда не проходит через HTTP-ответ.
    """
    import smtplib, secrets as _secrets
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart

    # Rate limit по IP (max 5 запросов за 10 мин с одного IP)
    client_ip = (request.headers.get("x-forwarded-for", "").split(",")[0].strip()
                 or (request.client.host if request.client else "") or "unknown")
    _otp_ip_guard.check(client_ip)
    _otp_ip_guard.failure(client_ip)  # считаем каждый запрос попыткой

    # Достаём email из тела
    try:
        body_bytes = await request.body()
        body_json = json.loads(body_bytes)
        email = str(body_json.get("email") or "").strip().lower()
    except Exception:
        raise HTTPException(status_code=400, detail="Неверный формат запроса")

    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Неверный email")

    # Генерируем OTP здесь — он никогда не покидает сервер через HTTP
    code = str(_secrets.randbelow(900000) + 100000)

    # Получаем brand_title из adminpanel по домену запроса
    brand_title = "VPN"
    try:
        host = request.headers.get("host", "").split(":")[0].strip()
        lk_profile = _lk_pick_lk_profile_for_host(host) or _lk_get_active_lk_profile()
        if lk_profile:
            brand_title = str(lk_profile.get("settings", {}).get("brand_title") or "VPN").strip() or "VPN"
    except Exception:
        pass

    # Отправляем email
    smtp_cfg = _lk_load_smtp_config()
    smtp_host = str(smtp_cfg.get("host") or "").strip()
    smtp_port = int(smtp_cfg.get("port") or 587)
    smtp_user = str(smtp_cfg.get("user") or "").strip()
    smtp_pass = str(smtp_cfg.get("pass") or "").strip()
    smtp_from = str(smtp_cfg.get("from") or smtp_user).strip()

    if not (smtp_host and smtp_user and smtp_pass):
        raise HTTPException(status_code=503, detail="SMTP не настроен. Обратитесь к администратору.")

    html_body = f"""<!DOCTYPE html>
<html lang="ru">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 0;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">
        <tr>
          <td align="center" style="background:#111111;padding:32px 40px;">
            <span style="color:#ffffff;font-size:24px;font-weight:700;letter-spacing:1px;">{brand_title}</span>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:40px 40px 16px;">
            <p style="margin:0 0 8px;color:#888888;font-size:14px;">Ваш код подтверждения</p>
            <div style="background:#f9f9f9;border-radius:12px;padding:24px 40px;display:inline-block;margin:8px 0;">
              <span style="font-size:40px;font-weight:700;letter-spacing:8px;color:#111111;">{code}</span>
            </div>
            <p style="margin:16px 0 0;color:#aaaaaa;font-size:13px;">Код действителен 5 минут.<br>Если вы не запрашивали код&nbsp;&mdash; проигнорируйте это письмо.</p>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:24px 40px 32px;">
            <p style="margin:0;color:#cccccc;font-size:11px;">&copy; {brand_title}</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"Код подтверждения: {code}"
        msg["From"] = smtp_from
        msg["To"] = email
        msg.attach(MIMEText(f"Ваш код для входа: {code}\n\nКод действителен 5 минут.\nЕсли вы не запрашивали код — проигнорируйте это письмо.", "plain", "utf-8"))
        msg.attach(MIMEText(html_body, "html", "utf-8"))
        if smtp_port == 465:
            import ssl as _ssl
            with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=10, context=_ssl.create_default_context()) as s:
                s.login(smtp_user, smtp_pass)
                s.sendmail(smtp_from, [email], msg.as_string())
        else:
            with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as s:
                s.starttls()
                s.login(smtp_user, smtp_pass)
                s.sendmail(smtp_from, [email], msg.as_string())
        logger.info(f"[lk_otp] sent to {email[:3]}***@{email.split('@')[-1]}")
    except Exception as exc:
        logger.error("[lk_otp] SMTP error: %s", exc, exc_info=True)
        raise HTTPException(status_code=503, detail="Ошибка отправки письма. Проверьте настройки SMTP.")

    # Передаём код боту через внутренний эндпоинт (store-code, требует токен)
    store_resp = await _proxy_to_lk_module_api_with_body(
        request,
        "lk/auth/email/store-code",
        body=json.dumps({"email": email, "code": code}).encode(),
        method="POST",
    )
    if store_resp.status_code not in (200, 201):
        logger.error(f"[lk_otp] store-code failed: {store_resp.status_code}")
        raise HTTPException(status_code=503, detail="Внутренняя ошибка. Попробуйте снова.")

    return JSONResponse({"ok": True, "detail": "Код отправлен на указанный email"})


@api.get("/lk/public/settings")
def lk_public_settings(request: Request) -> Dict[str, Any]:
    """
    Отдаём публичные настройки ЛК из adminpanel (lk_profiles.json) — без обращения к боту.
    """
    p = _lk_get_lk_profile_for_request(request)
    settings = (p or {}).get("settings", {}) if p else {}
    return {
        "ok": True,
        "brand_title": str(settings.get("brand_title") or "VPN").strip() or "VPN",
        "support_url": str(settings.get("support_url") or "").strip(),
        "news_url": str(settings.get("news_url") or "").strip(),
        "terms_url": str(settings.get("terms_url") or "").strip(),
        "enabled_tariff_group_codes": settings.get("enabled_tariff_group_codes") or [],
        "enabled_payment_providers": settings.get("enabled_payment_providers") or [],
    }


@api.api_route("/lk/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def lk_passthrough(path: str, request: Request) -> Response:
    """
    Forward any new LK endpoints to module API (e.g. /lk/auth/login, /lk/payments/init, etc).
    """
    if request.method != "OPTIONS":
        _lk_rate_check(request)
    upstream_path = "lk/" + str(path or "").lstrip("/")
    return await _proxy_to_lk_module_api(request, upstream_path)


@api.post("/auth/change-password")
async def auth_change_password(request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    _require_csrf(request, session)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")
    old_password = str(payload.get("old_password") or payload.get("oldPassword") or "")
    new_password = str(payload.get("new_password") or payload.get("newPassword") or payload.get("password") or "")
    _validate_password_strength(new_password)

    # If session has user_id -> change password for that DB user.
    user_id = session.get("user_id")
    if user_id:
        username_session = str(session.get("username") or "")
        if not panel_verify_login(PANEL_USERS_DB_FILE, username=username_session, password=old_password):
            raise HTTPException(status_code=401, detail="Неверный текущий пароль")
        try:
            panel_update_user(PANEL_USERS_DB_FILE, str(user_id), password=new_password)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except KeyError:
            raise HTTPException(status_code=404, detail="Пользователь не найден")
        # Invalidate all sessions after password change
        _save_sessions({})
        return {"ok": True}

    # Legacy fallback (single credentials).
    creds = _load_credentials()
    password_hash = str(creds.get("password_hash") or "")
    if not password_hash or not bcrypt.checkpw(old_password.encode("utf-8"), password_hash.encode("utf-8")):
        raise HTTPException(status_code=401, detail="Неверный текущий пароль")

    new_hash = bcrypt.hashpw(new_password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")
    creds["password_hash"] = new_hash
    _write_json(AUTH_CREDENTIALS_FILE, creds)
    # Invalidate all sessions after password change
    _save_sessions({})
    try:
        os.chmod(AUTH_CREDENTIALS_FILE, 0o600)
    except Exception:
        pass
    return {"ok": True}


# -----------------------
# Panel users (multi-user auth)
# -----------------------
def _require_owner(session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    role = _normalize_role_name((session or {}).get("role") or "super_admin")
    if role != "super_admin":
        raise HTTPException(status_code=403, detail="Недостаточно прав")
    return session


class PanelUserCreateRequest(BaseModel):
    username: str
    password: str
    role: str = "operator"
    tg_id: int | None = None
    is_active: bool = True


class PanelUserUpdateRequest(BaseModel):
    username: str | None = None
    password: str | None = None
    role: str | None = None
    tg_id: int | None = None
    is_active: bool | None = None


@api.get("/panel-users")
def get_panel_users(_session: Dict[str, Any] = Depends(_require_owner)) -> Dict[str, Any]:
    items = panel_list_users(PANEL_USERS_DB_FILE)
    roles = [str(r.get("name")) for r in (panel_list_roles(PANEL_USERS_DB_FILE) or []) if isinstance(r, dict) and r.get("name")]
    # Enrich with totp_enabled flag
    for item in (items or []):
        if isinstance(item, dict):
            uid = str(item.get("id") or "")
            item["totp_enabled"] = is_totp_enabled(PANEL_USERS_DB_FILE, uid) if uid else False
    return {"ok": True, "items": items, "roles": roles}


@api.post("/panel-users")
async def create_panel_user(request: Request, session: Dict[str, Any] = Depends(_require_owner)) -> Dict[str, Any]:
    _require_csrf(request, session)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")
    role = _normalize_role_name(payload.get("role") or "operator")
    if not panel_role_exists(PANEL_USERS_DB_FILE, role):
        raise HTTPException(status_code=400, detail="Некорректная роль")
    try:
        user = panel_create_user(
            PANEL_USERS_DB_FILE,
            username=str(payload.get("username") or ""),
            password=str(payload.get("password") or ""),
            role=role,
            tg_id=payload.get("tg_id"),
            is_active=bool(payload.get("is_active", True)),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Пользователь с таким username уже существует")
    try:
        panel_append_audit(
            PANEL_USERS_DB_FILE,
            actor=str((session or {}).get("username") or "unknown"),
            action="panel_user.create",
            target_type="panel_user",
            target_id=str(user.get("id") or ""),
            meta={"username": user.get("username"), "role": user.get("role"), "is_active": user.get("is_active")},
        )
    except Exception:
        pass
    return {"ok": True, "user": user}


@api.patch("/panel-users/{user_id}")
async def update_panel_user(
    user_id: str,
    request: Request,
    session: Dict[str, Any] = Depends(_require_owner),
) -> Dict[str, Any]:
    _require_csrf(request, session)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")
    if "role" in payload and payload.get("role") is not None:
        role = _normalize_role_name(payload.get("role"))
        if not panel_role_exists(PANEL_USERS_DB_FILE, role):
            raise HTTPException(status_code=400, detail="Некорректная роль")
        payload["role"] = role
    try:
        before = panel_get_user_by_id(PANEL_USERS_DB_FILE, user_id)
        user = panel_update_user(
            PANEL_USERS_DB_FILE,
            user_id,
            username=payload.get("username"),
            password=payload.get("password"),
            role=payload.get("role"),
            tg_id=payload.get("tg_id"),
            is_active=payload.get("is_active"),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except KeyError:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Пользователь с таким username уже существует")
    try:
        changes: Dict[str, Any] = {}
        if before and isinstance(before, dict):
            for k in ("username", "role", "tg_id", "is_active"):
                if k in payload and payload.get(k) is not None:
                    if str(before.get(k)) != str(user.get(k)):
                        changes[k] = {"from": before.get(k), "to": user.get(k)}
        if "password" in payload and payload.get("password") is not None:
            changes["password"] = True
        panel_append_audit(
            PANEL_USERS_DB_FILE,
            actor=str((session or {}).get("username") or "unknown"),
            action="panel_user.update",
            target_type="panel_user",
            target_id=str(user.get("id") or user_id),
            meta={"changes": changes, "username": user.get("username")},
        )
    except Exception:
        pass
    return {"ok": True, "user": user}


@api.delete("/panel-users/{user_id}")
async def delete_panel_user(
    user_id: str,
    request: Request,
    session: Dict[str, Any] = Depends(_require_owner),
) -> Dict[str, Any]:
    _require_csrf(request, session)
    try:
        before = panel_get_user_by_id(PANEL_USERS_DB_FILE, user_id)
        deleted = panel_delete_user(PANEL_USERS_DB_FILE, user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if deleted:
        try:
            panel_append_audit(
                PANEL_USERS_DB_FILE,
                actor=str((session or {}).get("username") or "unknown"),
                action="panel_user.delete",
                target_type="panel_user",
                target_id=str(user_id),
                meta={"username": (before or {}).get("username") if isinstance(before, dict) else None},
            )
        except Exception:
            pass
    return {"ok": True, "deleted": bool(deleted)}


@api.get("/panel-users/{user_id}/2fa")
def get_panel_user_2fa(
    user_id: str,
    _session: Dict[str, Any] = Depends(_require_owner),
) -> Dict[str, Any]:
    info = get_totp_info(PANEL_USERS_DB_FILE, user_id)
    enabled = bool(info and info.get("enabled"))
    return {"ok": True, "enabled": enabled}


@api.delete("/panel-users/{user_id}/2fa")
async def delete_panel_user_2fa(
    user_id: str,
    request: Request,
    session: Dict[str, Any] = Depends(_require_owner),
) -> Dict[str, Any]:
    _require_csrf(request, session)
    user = panel_get_user_by_id(PANEL_USERS_DB_FILE, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    disable_totp(PANEL_USERS_DB_FILE, user_id)
    try:
        panel_append_audit(
            PANEL_USERS_DB_FILE,
            actor=str((session or {}).get("username") or "unknown"),
            action="panel_user.2fa_disabled",
            target_type="panel_user",
            target_id=str(user_id),
            meta={"username": user.get("username") if isinstance(user, dict) else None},
        )
    except Exception:
        pass
    return {"ok": True}


# -----------------------
# Panel roles (RBAC)
# -----------------------
class PanelRoleUpdateRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    permissions: list[str] | None = None


@api.get("/panel-roles")
def get_panel_roles(_session: Dict[str, Any] = Depends(_require_owner)) -> Dict[str, Any]:
    roles = panel_list_roles(PANEL_USERS_DB_FILE)
    resources = [{"key": k, "title": t} for (k, t) in RBAC_RESOURCES]
    actions = list(RBAC_ACTIONS)
    return {"ok": True, "roles": roles, "resources": resources, "actions": actions}


@api.patch("/panel-roles/{role_name}")
async def update_panel_role(
    role_name: str,
    request: Request,
    session: Dict[str, Any] = Depends(_require_owner),
) -> Dict[str, Any]:
    _require_csrf(request, session)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")
    try:
        before = panel_get_role(PANEL_USERS_DB_FILE, _normalize_role_name(role_name))
        role = panel_update_role_permissions(
            PANEL_USERS_DB_FILE,
            _normalize_role_name(role_name),
            title=payload.get("title"),
            description=payload.get("description"),
            permissions=payload.get("permissions"),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except KeyError:
        raise HTTPException(status_code=404, detail="Роль не найдена")
    try:
        added: List[str] = []
        removed: List[str] = []
        if before and isinstance(before, dict):
            prev_perms = set([str(x) for x in (before.get("permissions") or [])])
            next_perms = set([str(x) for x in (role.get("permissions") or [])])
            added = sorted(list(next_perms - prev_perms))[:100]
            removed = sorted(list(prev_perms - next_perms))[:100]
        panel_append_audit(
            PANEL_USERS_DB_FILE,
            actor=str((session or {}).get("username") or "unknown"),
            action="panel_role.update",
            target_type="panel_role",
            target_id=str(role.get("name") or role_name),
            meta={
                "title": role.get("title"),
                "permissions_added": added,
                "permissions_removed": removed,
                "permissions_total": len(role.get("permissions") or []),
            },
        )
    except Exception:
        pass
    return {"ok": True, "role": role}


# -----------------------
# Panel Audit Log
# -----------------------
class PanelAuditEventRequest(BaseModel):
    action: str
    target_type: str | None = None
    target_id: str | None = None
    meta: dict | None = None


@api.get("/panel-audit")
def get_panel_audit(
    limit: int = 100,
    offset: int = 0,
    actor: str | None = None,
    action: str | None = None,
    _session: Dict[str, Any] = Depends(_require_owner),
) -> Dict[str, Any]:
    items, total = panel_list_audit(PANEL_USERS_DB_FILE, limit=limit, offset=offset, actor=actor, action=action)
    return {"ok": True, "items": items, "total": total}


@api.post("/panel-audit/event")
async def post_panel_audit_event(request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    _require_csrf(request, session)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")
    action = str(payload.get("action") or "").strip()
    if not action:
        raise HTTPException(status_code=400, detail="action is required")
    try:
        panel_append_audit(
            PANEL_USERS_DB_FILE,
            actor=str((session or {}).get("username") or "unknown"),
            action=action,
            target_type=payload.get("target_type"),
            target_id=payload.get("target_id"),
            meta=payload.get("meta"),
        )
    except Exception as e:
        logger.error("panel_append_audit error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Ошибка записи аудита")
    return {"ok": True}


# -----------------------
# GitHub Update (AdminPanel self-update from main branch)
# -----------------------
@api.get("/github-update/config")
def get_github_update_config(_session: Dict[str, Any] = Depends(_require_owner)) -> Dict[str, Any]:
    cfg = _github_update_manager.load_config()
    if not isinstance(cfg, dict):
        cfg = default_update_config()
    return {"ok": True, "config": cfg}


@api.post("/github-update/config")
async def save_github_update_config(request: Request, session: Dict[str, Any] = Depends(_require_owner)) -> Dict[str, Any]:
    _require_csrf(request, session)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")
    try:
        cfg = _github_update_manager.save_config(payload)
    except Exception as e:
        logger.error("github-update config save error: %s", e, exc_info=True)
        raise HTTPException(status_code=400, detail="Ошибка сохранения конфигурации")
    return {"ok": True, "config": cfg}


@api.get("/github-update/status")
def get_github_update_status(_session: Dict[str, Any] = Depends(_require_owner)) -> Dict[str, Any]:
    return {"ok": True, "status": _github_update_manager.get_status()}


@api.get("/github-update/log")
def get_github_update_log(
    lines: int = 200,
    _session: Dict[str, Any] = Depends(_require_owner),
) -> Dict[str, Any]:
    try:
        data = _github_update_manager.read_log_tail(lines)
    except Exception:
        data = []
    return {"ok": True, "lines": data}


@api.post("/github-update/check")
async def check_github_update(request: Request, session: Dict[str, Any] = Depends(_require_owner)) -> Dict[str, Any]:
    _require_csrf(request, session)
    try:
        result = _github_update_manager.check_remote()
    except Exception as e:
        logger.error("github-update check error: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail="Ошибка проверки обновления")
    try:
        panel_append_audit(
            PANEL_USERS_DB_FILE,
            actor=str((session or {}).get("username") or "unknown"),
            action="github_update.check",
            target_type="github_update",
            target_id=str(result.get("status_code") or ""),
            meta={
                "ok": bool(result.get("ok")),
                "status_code": result.get("status_code"),
                "content_type": result.get("content_type"),
            },
        )
    except Exception:
        pass
    return result


@api.get("/github-update/commits")
async def get_github_commits(_session: Dict[str, Any] = Depends(_require_owner)) -> Dict[str, Any]:
    from github_update_service import fetch_github_commits, DEFAULT_REPO_URL as _DEFAULT_REPO_URL, DEFAULT_BRANCH as _DEFAULT_BRANCH
    cfg = _github_update_manager.load_config()
    repo_url = str(cfg.get("repo_url") or _DEFAULT_REPO_URL)
    branch = str(cfg.get("branch") or _DEFAULT_BRANCH)
    try:
        commits = fetch_github_commits(repo_url, branch, per_page=30)
    except Exception as e:
        logger.error("github fetch commits error: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail="Ошибка получения коммитов")
    return {"ok": True, "commits": commits, "repo_url": repo_url, "branch": branch}


@api.post("/github-update/run")
async def run_github_update(request: Request, session: Dict[str, Any] = Depends(_require_owner)) -> Dict[str, Any]:
    _require_csrf(request, session)
    username = str((session or {}).get("username") or "unknown")
    try:
        result = _github_update_manager.start_update(triggered_by=username)
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        logger.error("github-update run error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Ошибка запуска обновления")
    try:
        panel_append_audit(
            PANEL_USERS_DB_FILE,
            actor=username,
            action="github_update.run",
            target_type="github_update",
            target_id=str(int(time.time())),
            meta={"started": bool(result.get("started")), "service": _github_update_manager.service_name},
        )
    except Exception:
        pass
    return result


# -----------------------
# Bot profiles (local JSON)
# -----------------------
@api.get("/bot-profiles/")
def get_bot_profiles(_session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    data = _read_json(BOT_PROFILES_FILE, {"profiles": [], "activeProfileId": None})
    if not isinstance(data, dict):
        data = {"profiles": [], "activeProfileId": None}
    profiles = data.get("profiles") or []
    safe_profiles = []
    if isinstance(profiles, list):
        for p in profiles:
            if not isinstance(p, dict):
                continue
            safe = dict(p)
            # Не возвращаем токены в списке (UI просит вводить заново при редактировании)
            safe["token"] = ""
            safe_profiles.append(safe)
    return {"profiles": safe_profiles, "activeProfileId": data.get("activeProfileId")}


@api.post("/bot-profiles/")
async def create_bot_profile(request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    _require_csrf(request, session)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")
    data = _read_json(BOT_PROFILES_FILE, {"profiles": [], "activeProfileId": None})
    if not isinstance(data, dict):
        data = {"profiles": [], "activeProfileId": None}
    profiles = data.get("profiles") or []
    if not isinstance(profiles, list):
        profiles = []
    new_id = str(int(time.time() * 1000))
    profile = {
        "id": new_id,
        "name": payload.get("name", ""),
        "botApiUrl": payload.get("botApiUrl", ""),
        "adminId": payload.get("adminId", ""),
        "token": _token_encrypt(str(payload.get("token") or "")),
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()),
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()),
    }
    profiles.append(profile)
    data["profiles"] = profiles
    if not data.get("activeProfileId"):
        data["activeProfileId"] = new_id
    _write_json(BOT_PROFILES_FILE, data)
    _invalidate_bot_profiles_cache()
    # Immediately refresh BOT API status so UI doesn't wait for the background loop.
    try:
        await _refresh_bot_api_status_now(profile)
    except Exception:
        pass
    safe = dict(profile)
    safe["token"] = ""
    return {"profile": safe, "activeProfileId": data.get("activeProfileId")}


@api.patch("/bot-profiles/{profile_id}")
async def update_bot_profile(profile_id: str, request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    _require_csrf(request, session)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")
    data = _read_json(BOT_PROFILES_FILE, {"profiles": [], "activeProfileId": None})
    profiles = data.get("profiles") or []
    if not isinstance(profiles, list):
        profiles = []
    updated: Optional[Dict[str, Any]] = None
    for p in profiles:
        if isinstance(p, dict) and p.get("id") == profile_id:
            # token: пустое значение в edit-режиме означает "оставить текущий"
            allowed = {k: v for k, v in payload.items() if k in {"name", "botApiUrl", "adminId", "token"}}
            if "token" in allowed and (allowed["token"] is None or str(allowed["token"]) == ""):
                allowed.pop("token", None)
            if "token" in allowed:
                allowed["token"] = _token_encrypt(str(allowed["token"]))
            p.update(allowed)
            p["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())
            updated = p
            break
    if not updated:
        raise HTTPException(status_code=404, detail="Profile not found")
    data["profiles"] = profiles
    _write_json(BOT_PROFILES_FILE, data)
    _invalidate_bot_profiles_cache()
    # Immediately refresh BOT API status for updated profile.
    try:
        await _refresh_bot_api_status_now(updated)
    except Exception:
        pass
    # Не возвращаем token в ответ (фронт его не показывает)
    safe = dict(updated)
    safe["token"] = ""
    return safe


@api.delete("/bot-profiles/{profile_id}")
def delete_bot_profile(profile_id: str, request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    _require_csrf(request, session)
    data = _read_json(BOT_PROFILES_FILE, {"profiles": [], "activeProfileId": None})
    profiles = data.get("profiles") or []
    if not isinstance(profiles, list):
        profiles = []
    
    # Удаляем сессии Telegram перед удалением профиля
    _remove_telegram_sessions_for_bot_profiles([profile_id])
    
    profiles = [p for p in profiles if not (isinstance(p, dict) and p.get("id") == profile_id)]
    data["profiles"] = profiles
    if data.get("activeProfileId") == profile_id:
        data["activeProfileId"] = profiles[0].get("id") if profiles and isinstance(profiles[0], dict) else None
    _write_json(BOT_PROFILES_FILE, data)
    _invalidate_bot_profiles_cache()
    return {"ok": True, "activeProfileId": data.get("activeProfileId")}


@api.post("/bot-profiles/{profile_id}/set-active")
async def set_active_bot_profile(profile_id: str, request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    _require_csrf(request, session)
    data = _read_json(BOT_PROFILES_FILE, {"profiles": [], "activeProfileId": None})
    profiles = data.get("profiles") or []
    if not isinstance(profiles, list) or not any(isinstance(p, dict) and p.get("id") == profile_id for p in profiles):
        raise HTTPException(status_code=404, detail="Profile not found")
    data["activeProfileId"] = profile_id
    _write_json(BOT_PROFILES_FILE, data)
    _invalidate_bot_profiles_cache()
    # Immediately refresh BOT API status for newly active profile.
    try:
        target = None
        for p in profiles:
            if isinstance(p, dict) and p.get("id") == profile_id:
                target = p
                break
        if target:
            await _refresh_bot_api_status_now(target)
    except Exception:
        pass
    return {"ok": True, "activeProfileId": profile_id}


# -----------------------
# Bot proxy (token is stored server-side)
# -----------------------
@api.api_route("/bot-proxy/{path:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE"])
async def bot_proxy(path: str, request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Response:
    # Для mutating операций требуем CSRF
    if request.method.upper() in {"POST", "PATCH", "PUT", "DELETE"}:
        _require_csrf(request, session)
    return await _proxy_to_bot(request, path, add_admin_tg_id=False)


# -----------------------
# Balance set with admin_tg_id injection
# -----------------------
@api.post("/users/{tg_id}/balance/set")
async def user_balance_set(tg_id: int, request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Response:
    """Proxy balance/set to bot, injecting admin_tg_id from active profile into body."""
    _require_csrf(request, session)
    _, profile = _get_active_bot_profile()
    admin_id = str(profile.get("adminId") or "").strip()
    try:
        body = await request.json()
    except Exception:
        body = {}
    if admin_id:
        body["admin_tg_id"] = int(admin_id)
    import httpx as _httpx
    from bot_api_base import get_bot_api_base_url
    base_url = get_bot_api_base_url(profile)
    token = str(profile.get("token") or "").strip()
    url = base_url.rstrip("/") + f"/users/{tg_id}/balance/set"
    params: Dict[str, Any] = {"tg_id": str(tg_id)}
    headers: Dict[str, str] = {"Accept": "application/json", "Content-Type": "application/json"}
    if token:
        headers["X-Token"] = token
    try:
        from bot_proxy import _get_bot_proxy_client
        client = _get_bot_proxy_client()
        upstream = await client.request("POST", url, params=params, json=body, headers=headers)
        import json as _json
        try:
            return JSONResponse(status_code=upstream.status_code, content=upstream.json())
        except Exception:
            return Response(status_code=upstream.status_code, content=upstream.content)
    except Exception as e:
        return JSONResponse(status_code=502, content={"detail": str(e)})


# -----------------------
# Dashboard Stats (fast, cached, server-side aggregation)
# -----------------------
@api.get("/dashboard-stats")
async def get_dashboard_stats(force: bool = False, _session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    """
    Return pre-aggregated dashboard statistics.
    Caches Bot API data for 5 minutes to avoid slow repeated fetches.
    """
    # Prefer DB-aggregated stats from the bot API module (fast on large DBs).
    # Fallback to legacy in-process aggregation only if module endpoint is unavailable.
    from collections import defaultdict
    
    _, profile = _get_active_bot_profile()
    profile_id = str(profile.get("id") or "default")
    base_url = get_bot_api_base_url(profile)
    token = str(profile.get("token") or "").strip()
    admin_id = str(profile.get("adminId") or "").strip()
    
    if not base_url:
        return {
            "error": "Bot API base URL not configured (set BOT_API_BASE_URL on the AdminPanel server)",
            "users": [],
            "keys": [],
            "payments": [],
            "tariffs": [],
            "referrals": [],
        }
    
    # Check cache (unless force refresh)
    # Use include_day=True to invalidate cache on Moscow day change
    if not force:
        cached_stats = _bot_cache_get(profile_id, "dashboard_stats", include_day=True)
        if cached_stats:
            return cached_stats
    
    headers: Dict[str, str] = {"Accept": "application/json"}
    if token:
        headers["X-Token"] = token
    
    timeout = httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=10.0)

    # Try module endpoint: /dashboard-stats (same prefix as base_url)
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, headers=headers) as client:
            url = base_url.rstrip("/") + "/dashboard-stats"
            params = {"tg_id": admin_id} if admin_id else {}
            resp = await client.get(url, params=params)
            if resp.status_code < 400:
                data = resp.json()
                if isinstance(data, dict) and data.get("users") and data.get("finances"):
                    _bot_cache_set(profile_id, "dashboard_stats", data, include_day=True)
                    return data
    except Exception:
        pass

    # Legacy fallback below can be extremely heavy because it pulls full lists (users/keys/payments)
    # from Bot API and aggregates in-process. On large DBs this can stall the panel.
    # By default, we DISABLE this fallback to keep the panel responsive.
    if os.getenv("ADMINPANEL_ENABLE_LEGACY_DASHBOARD_FALLBACK", "0") not in ("1", "true", "yes", "on"):
        safe = {
            "cached_at": datetime.now(timezone.utc).isoformat(),
            "error": "Dashboard aggregation fallback is disabled. Ensure Bot API module /dashboard-stats endpoint is available.",
            "users": {"total": 0, "day": 0, "yesterday": 0, "week": 0, "month": 0, "prev_month": 0},
            "finances": {"total": 0.0, "day": 0.0, "yesterday": 0.0, "week": 0.0, "month": 0.0, "prev_month": 0.0},
            "subscriptions": {"total": 0, "active": 0, "paid_active": 0, "trial_active": 0, "expired": 0},
            "referrals": {"total_attracted": 0},
            "chart_daily": [],
            "tariff_stats": [],
        }
        return safe
    
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, headers=headers) as client:
        async def fetch_json(path: str) -> Any:
            url = base_url.rstrip("/") + "/" + path.lstrip("/")
            params = {"tg_id": admin_id} if admin_id else {}
            try:
                resp = await client.get(url, params=params)
                if resp.status_code >= 400:
                    return []
                return resp.json()
            except Exception:
                return []
        
        # Fetch all data in parallel
        users_task = asyncio.create_task(fetch_json("users/"))
        payments_task = asyncio.create_task(fetch_json("payments/"))
        keys_task = asyncio.create_task(fetch_json("keys/"))
        tariffs_task = asyncio.create_task(fetch_json("tariffs/"))
        referrals_task = asyncio.create_task(fetch_json("referrals/"))
        
        raw_users, raw_payments, raw_keys, raw_tariffs, raw_referrals = await asyncio.gather(
            users_task, payments_task, keys_task, tariffs_task, referrals_task
        )
    
    users = raw_users if isinstance(raw_users, list) else []
    payments = raw_payments if isinstance(raw_payments, list) else []
    keys = raw_keys if isinstance(raw_keys, list) else []
    tariffs = raw_tariffs if isinstance(raw_tariffs, list) else []
    referrals = raw_referrals if isinstance(raw_referrals, list) else []
    
    # Moscow time offset (UTC+3)
    MOSCOW_OFFSET_SEC = 3 * 60 * 60
    now = datetime.now(timezone.utc)
    now_ts = now.timestamp()
    
    def to_moscow_day(ts: float) -> str:
        """Convert timestamp to Moscow day key (YYYY-MM-DD)."""
        moscow_ts = ts + MOSCOW_OFFSET_SEC
        d = datetime.fromtimestamp(moscow_ts, tz=timezone.utc)
        return d.strftime("%Y-%m-%d")
    
    def to_moscow_month(ts: float) -> str:
        """Convert timestamp to Moscow month key (YYYY-MM)."""
        moscow_ts = ts + MOSCOW_OFFSET_SEC
        d = datetime.fromtimestamp(moscow_ts, tz=timezone.utc)
        return d.strftime("%Y-%m")
    
    def parse_ts(val: Any) -> Optional[float]:
        """Parse timestamp from various formats. Returns Unix timestamp in seconds."""
        if not val:
            return None
        if isinstance(val, (int, float)):
            # If > 10^12, it's milliseconds; convert to seconds
            v = float(val)
            return v / 1000 if v > 10000000000 else v
        if isinstance(val, str):
            try:
                dt = datetime.fromisoformat(val.replace("Z", "+00:00"))
                # If no timezone info, assume Moscow time (bot часто отдаёт МСК без TZ).
                # This keeps dashboard "today" in sync with what admins see in the panel.
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone(timedelta(hours=3)))
                return dt.timestamp()
            except Exception:
                return None
        return None
    
    today_key = to_moscow_day(now_ts)
    yesterday_key = to_moscow_day(now_ts - 86400)
    this_month_key = to_moscow_month(now_ts)
    prev_month_key = to_moscow_month(now_ts - 30 * 86400)  # Approximate
    
    # Calculate week days set
    week_days = set()
    for i in range(7):
        week_days.add(to_moscow_day(now_ts - i * 86400))
    
    # --- Users stats ---
    users_day = 0
    users_yesterday = 0
    users_week = 0
    users_month = 0
    users_prev_month = 0
    
    for u in users:
        created = parse_ts(u.get("created_at") or u.get("createdAt"))
        if not created:
            continue
        day_key = to_moscow_day(created)
        month_key = to_moscow_month(created)
        
        if day_key == today_key:
            users_day += 1
        if day_key == yesterday_key:
            users_yesterday += 1
        if day_key in week_days:
            users_week += 1
        if month_key == this_month_key:
            users_month += 1
        if month_key == prev_month_key:
            users_prev_month += 1
    
    # --- Payments stats ---
    def is_referral_payment(p: Dict) -> bool:
        ps = str(p.get("payment_system") or p.get("provider") or "").lower()
        pt = str(p.get("type") or p.get("payment_type") or "").lower()
        desc = str(p.get("description") or p.get("comment") or "").lower()
        hay = f"{ps} {pt} {desc}"
        return "referral" in hay or "рефер" in hay or "admin" in hay or "админ" in hay
    
    def is_success_payment(p: Dict) -> bool:
        status = str(p.get("status") or p.get("payment_status") or "").lower()
        return status in ("success", "successful", "completed", "paid")
    
    finance_day = 0.0
    finance_yesterday = 0.0
    finance_week = 0.0
    finance_month = 0.0
    finance_prev_month = 0.0
    finance_total = 0.0
    
    for p in payments:
        if is_referral_payment(p) or not is_success_payment(p):
            continue
        amount = float(p.get("amount") or p.get("sum") or p.get("total") or 0)
        finance_total += amount
        
        created = parse_ts(p.get("created_at") or p.get("createdAt"))
        if not created:
            continue
        day_key = to_moscow_day(created)
        month_key = to_moscow_month(created)
        
        if day_key == today_key:
            finance_day += amount
        if day_key == yesterday_key:
            finance_yesterday += amount
        if day_key in week_days:
            finance_week += amount
        if month_key == this_month_key:
            finance_month += amount
        if month_key == prev_month_key:
            finance_prev_month += amount
    
    # --- Keys/Subscriptions stats ---
    now_ms = now_ts * 1000
    active_keys = 0
    expired_keys = 0
    trial_active = 0
    paid_active = 0

    # Map tariffs by id to resolve trial group_code
    tariffs_by_id: Dict[str, Dict[str, Any]] = {}
    for t in (tariffs or []):
        if not isinstance(t, dict):
            continue
        tid = t.get("id") or t.get("tariff_id") or t.get("tariffId")
        if tid is None:
            continue
        tariffs_by_id[str(tid)] = t
    
    # Build set of users who paid
    paid_tg_ids = set()
    for p in payments:
        if is_success_payment(p) and not is_referral_payment(p):
            tg_id = p.get("tg_id") or p.get("user_id")
            if tg_id:
                paid_tg_ids.add(str(tg_id))
    
    def is_trial_key(k: Dict) -> bool:
        # Check explicit flags
        if k.get("is_trial") is True or k.get("isTrial") is True:
            return True
        if k.get("is_trial") is False or k.get("isTrial") is False:
            return False
        
        # Primary rule: detect by tariff group code (always "trial")
        tariff_id = k.get("tariff_id") or k.get("tariffId") or k.get("tariff") or k.get("plan_id") or k.get("tariffId")
        if tariff_id is not None:
            t = tariffs_by_id.get(str(tariff_id))
            if isinstance(t, dict):
                tg = str(t.get("group_code") or t.get("group") or t.get("tariff_group") or t.get("tariffGroup") or "").lower()
                if tg == "trial":
                    return True
                # also accept contains trial for safety
                if "trial" in tg:
                    return True

        # Fallback: key may have group fields
        group = str(k.get("group") or k.get("group_code") or k.get("tariff_group") or "").lower()
        if "trial" in group or "триал" in group:
            return True
        
        # Check tariff name
        # Try key tariff name first, then tariff name by id
        tariff_name = str(k.get("tariff_name") or k.get("tariff_name_ru") or k.get("tariff") or k.get("plan") or "").lower()
        if (not tariff_name) and tariff_id is not None:
            t = tariffs_by_id.get(str(tariff_id))
            if isinstance(t, dict):
                tariff_name = str(t.get("name") or t.get("tariff_name") or t.get("title") or "").lower()
        if (
            "trial" in tariff_name
            or "триал" in tariff_name
            or "пробн" in tariff_name
        ):
            return True
        
        # Check price
        price = k.get("price") or k.get("tariff_price") or k.get("amount")
        if price is None and tariff_id is not None:
            t = tariffs_by_id.get(str(tariff_id))
            if isinstance(t, dict):
                price = t.get("price") or t.get("price_rub") or t.get("amount")
        if price is not None and float(price) == 0:
            return True
        
        # If user has no payments, might be trial (only if tariff_name indicates trial)
        tg_id = str(k.get("tg_id") or k.get("user_id") or "")
        if tg_id and tg_id not in paid_tg_ids:
            if "trial" in tariff_name:
                return True
        
        return False
    
    for k in keys:
        expiry = k.get("expiry_time") or k.get("expires_at") or k.get("expiry")
        expiry_ms = None
        if expiry:
            if isinstance(expiry, (int, float)):
                expiry_ms = float(expiry) if expiry > 10000000000 else float(expiry) * 1000
            elif isinstance(expiry, str):
                try:
                    dt = datetime.fromisoformat(expiry.replace("Z", "+00:00"))
                    expiry_ms = dt.timestamp() * 1000
                except Exception:
                    pass
        
        if expiry_ms and expiry_ms > now_ms:
            active_keys += 1
            if is_trial_key(k):
                trial_active += 1
            else:
                paid_active += 1
        else:
            expired_keys += 1
    
    # --- Referrals stats ---
    unique_referred = set()
    for r in referrals:
        ref_id = r.get("referred_tg_id") or r.get("referredId")
        if ref_id:
            unique_referred.add(ref_id)
    
    # --- Daily chart data (last 30 days) ---
    daily_users: Dict[str, int] = defaultdict(int)
    daily_payments: Dict[str, float] = defaultdict(float)
    daily_keys_new: Dict[str, int] = defaultdict(int)
    
    for u in users:
        created = parse_ts(u.get("created_at") or u.get("createdAt"))
        if created:
            daily_users[to_moscow_day(created)] += 1
    
    for p in payments:
        if is_referral_payment(p) or not is_success_payment(p):
            continue
        created = parse_ts(p.get("created_at") or p.get("createdAt"))
        amount = float(p.get("amount") or p.get("sum") or 0)
        if created:
            daily_payments[to_moscow_day(created)] += amount
    
    for k in keys:
        created = parse_ts(k.get("created_at") or k.get("createdAt"))
        if created:
            daily_keys_new[to_moscow_day(created)] += 1
    
    # Generate last 30 days
    chart_days = []
    for i in range(29, -1, -1):
        day_key = to_moscow_day(now_ts - i * 86400)
        chart_days.append({
            "date": day_key,
            "users": daily_users.get(day_key, 0),
            "payments": round(daily_payments.get(day_key, 0), 2),
            "keys": daily_keys_new.get(day_key, 0),
        })
    
    # --- Monthly chart data (last 12 months) ---
    monthly_users: Dict[str, int] = defaultdict(int)
    monthly_payments: Dict[str, float] = defaultdict(float)
    
    for u in users:
        created = parse_ts(u.get("created_at") or u.get("createdAt"))
        if created:
            monthly_users[to_moscow_month(created)] += 1
    
    for p in payments:
        if is_referral_payment(p) or not is_success_payment(p):
            continue
        created = parse_ts(p.get("created_at") or p.get("createdAt"))
        amount = float(p.get("amount") or p.get("sum") or 0)
        if created:
            monthly_payments[to_moscow_month(created)] += amount
    
    def _add_months(year: int, month: int, delta: int) -> Tuple[int, int]:
        """Month is 1..12."""
        total = (year * 12 + (month - 1)) + delta
        y = total // 12
        m = (total % 12) + 1
        return y, m

    # Use exact month stepping (no 30-day approximation)
    moscow_now = datetime.fromtimestamp(now_ts + MOSCOW_OFFSET_SEC, tz=timezone.utc)
    base_y = int(moscow_now.strftime("%Y"))
    base_m = int(moscow_now.strftime("%m"))  # 1..12

    chart_months = []
    for i in range(11, -1, -1):
        y, m = _add_months(base_y, base_m, -i)
        month_key = f"{y:04d}-{m:02d}"
        chart_months.append({
            "month": month_key,
            "users": monthly_users.get(month_key, 0),
            "payments": round(monthly_payments.get(month_key, 0), 2),
        })

    # --- Subscription growth series (computed server-side to avoid heavy frontend parsing) ---
    def _start_of_moscow_day_utc_ms(day_key: str) -> int:
        # day_key is YYYY-MM-DD in Moscow day. UTC midnight minus offset gives Moscow-day start in UTC ms.
        try:
            utc_midnight = datetime.fromisoformat(f"{day_key}T00:00:00+00:00")
            return int(utc_midnight.timestamp() * 1000) - int(MOSCOW_OFFSET_SEC * 1000)
        except Exception:
            return 0

    # Parse keys into (created_ms, expiry_ms)
    key_events: List[Tuple[int, int]] = []
    for k in keys:
        try:
            created_s = parse_ts(k.get("created_at") or k.get("createdAt") or k.get("created") or k.get("issued_at"))
            expiry = k.get("expiry_time") or k.get("expires_at") or k.get("expiry") or k.get("until")
            if not created_s or not expiry:
                continue
            created_ms = int(created_s * 1000)
            expiry_ms: Optional[int] = None
            if isinstance(expiry, (int, float)):
                expiry_ms = int(float(expiry) if float(expiry) > 10000000000 else float(expiry) * 1000)
            elif isinstance(expiry, str):
                dt = datetime.fromisoformat(expiry.replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                expiry_ms = int(dt.timestamp() * 1000)
            if expiry_ms is None:
                continue
            # interval [created_ms, expiry_ms)
            key_events.append((created_ms, 1))
            key_events.append((expiry_ms, -1))
        except Exception:
            continue

    key_events.sort(key=lambda x: x[0])

    # Daily subscription series aligned with chart_days keys
    sub_daily = []
    active_now = int(active_keys)
    active_running = 0
    ev_i = 0
    for item in chart_days:
        dk = str(item.get("date") or "")
        if not dk:
            continue
        end_ms = int(now_ms) if dk == today_key else (_start_of_moscow_day_utc_ms(dk) + 24 * 60 * 60 * 1000 - 1)
        while ev_i < len(key_events) and key_events[ev_i][0] <= end_ms:
            active_running += key_events[ev_i][1]
            ev_i += 1
        # For today, prefer current active_keys (card-aligned)
        active_end = active_now if dk == today_key else max(0, active_running)
        sub_daily.append({
            "date": dk,
            "active": int(active_end),
            "new": int(daily_keys_new.get(dk, 0)),
        })

    # Monthly subscription series aligned with chart_months keys (active at month end)
    # Build month-end timestamps (Moscow end-of-month in UTC ms)
    def _end_of_moscow_month_utc_ms(month_key: str) -> int:
        try:
            y, m = month_key.split("-")
            year = int(y)
            mon = int(m)  # 1..12
            ny, nm = _add_months(year, mon, 1)
            next_month_key = f"{ny:04d}-{nm:02d}"
            # Start of next month Moscow day (YYYY-MM-01)
            start_next = _start_of_moscow_day_utc_ms(f"{next_month_key}-01")
            return start_next - 1
        except Exception:
            return 0

    sub_monthly = []
    # Reuse events; compute active at each month end by scanning events from start
    active_running = 0
    ev_i = 0
    for mitem in chart_months:
        mk = str(mitem.get("month") or "")
        if not mk:
            continue
        end_ms = int(now_ms) if mk == this_month_key else _end_of_moscow_month_utc_ms(mk)
        while ev_i < len(key_events) and key_events[ev_i][0] <= end_ms:
            active_running += key_events[ev_i][1]
            ev_i += 1
        active_end = active_now if mk == this_month_key else max(0, active_running)
        # New keys in this month
        sub_monthly.append({
            "month": mk,
            "active": int(active_end),
            "new": int(0),  # filled below
        })

    # Fill monthly new counts
    monthly_keys_new: Dict[str, int] = defaultdict(int)
    for k in keys:
        created = parse_ts(k.get("created_at") or k.get("createdAt"))
        if created:
            monthly_keys_new[to_moscow_month(created)] += 1
    for sm in sub_monthly:
        mk = sm.get("month")
        if mk:
            sm["new"] = int(monthly_keys_new.get(str(mk), 0))

    # --- Tariff popularity stats (server-side, to avoid loading full keys on frontend) ---
    tariffs_by_id2: Dict[str, Dict[str, Any]] = {}
    for t in tariffs:
        if isinstance(t, dict):
            tid = t.get("id") or t.get("tariff_id") or t.get("tariffId")
            if tid is not None:
                tariffs_by_id2[str(tid)] = t

    tariff_stats_map: Dict[str, Dict[str, Any]] = {}
    for k in keys:
        if not isinstance(k, dict):
            continue
        tid = k.get("tariff_id") or k.get("tariffId") or k.get("tariff")
        t = tariffs_by_id2.get(str(tid)) if tid is not None else None
        name = str(
            (k.get("tariff_name") or k.get("tariff") or "")
            or (t.get("name") if isinstance(t, dict) else "")
            or (t.get("tariff_name") if isinstance(t, dict) else "")
            or (tid if tid is not None else "")
            or "Неизвестно"
        )
        if not name:
            name = "Неизвестно"
        if name not in tariff_stats_map:
            tariff_stats_map[name] = {"name": name, "count": 0, "revenue": 0.0}
        tariff_stats_map[name]["count"] += 1
        # Revenue: use tariff price if available
        price = None
        if isinstance(t, dict):
            price = t.get("price") or t.get("price_rub") or t.get("amount")
        if price is not None:
            try:
                tariff_stats_map[name]["revenue"] += float(price)
            except Exception:
                pass

    tariff_stats_list = sorted(tariff_stats_map.values(), key=lambda x: float(x.get("count") or 0), reverse=True)
    
    result = {
        "cached_at": datetime.now(timezone.utc).isoformat(),
        "users": {
            "total": len(users),
            "day": users_day,
            "yesterday": users_yesterday,
            "week": users_week,
            "month": users_month,
            "prev_month": users_prev_month,
        },
        "finances": {
            "total": round(finance_total, 2),
            "day": round(finance_day, 2),
            "yesterday": round(finance_yesterday, 2),
            "week": round(finance_week, 2),
            "month": round(finance_month, 2),
            "prev_month": round(finance_prev_month, 2),
        },
        "subscriptions": {
            "total": len(keys),
            "active": active_keys,
            "paid_active": paid_active,
            "trial_active": trial_active,
            "expired": expired_keys,
        },
        "referrals": {
            "total_attracted": len(unique_referred),
        },
        "chart_daily": chart_days,
        "chart_monthly": chart_months,
        # Pre-aggregated dashboard series (avoid heavy frontend parsing for 100k+ datasets)
        "subscription_daily": sub_daily,
        "subscription_monthly": sub_monthly,
        "tariff_stats": tariff_stats_list,
    }
    
    # Cache the result (include_day=True to separate cache by Moscow day)
    _bot_cache_set(profile_id, "dashboard_stats", result, include_day=True)
    
    return result


# -----------------------
# Cached Bot API Data with Pagination
# -----------------------
async def _fetch_bot_paginated(profile: Dict[str, Any], path: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Fetch paginated data from Bot API (module) and normalize response to:
      { items, total, page, per_page, total_pages }
    """
    base_url = get_bot_api_base_url(profile)
    token = str(profile.get("token") or "").strip()
    admin_id = str(profile.get("adminId") or "").strip()
    if not base_url:
        page = int(params.get("page") or 1)
        per_page = int(params.get("per_page") or params.get("limit") or 50)
        return {"items": [], "total": 0, "page": page, "per_page": per_page, "total_pages": 1}

    headers: Dict[str, str] = {"Accept": "application/json"}
    if token:
        headers["X-Token"] = token

    timeout = httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=10.0)
    url = base_url.rstrip("/") + "/" + path.lstrip("/")
    qp: Dict[str, Any] = {}
    if admin_id:
        qp["tg_id"] = admin_id
    qp.update({k: v for k, v in (params or {}).items() if v is not None and v != ""})

    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, headers=headers) as client:
        resp = await client.get(url, params=qp)
        if resp.status_code >= 400:
            page = int(qp.get("page") or 1)
            per_page = int(qp.get("per_page") or qp.get("limit") or 50)
            return {"items": [], "total": 0, "page": page, "per_page": per_page, "total_pages": 1}
        data = resp.json()

    # Bot module format: { ok, items, total, page, limit, pages }
    if isinstance(data, dict) and isinstance(data.get("items"), list):
        page = int(data.get("page") or qp.get("page") or 1)
        per_page = int(data.get("per_page") or data.get("limit") or qp.get("per_page") or qp.get("limit") or 50)
        total = int(data.get("total") or 0)
        total_pages = int(data.get("total_pages") or data.get("pages") or 1)
        return {"items": data["items"], "total": total, "page": page, "per_page": per_page, "total_pages": total_pages}

    # Legacy: list response (defensive pagination).
    # If the Bot API returns a raw list, DO NOT return the entire list (can be huge on 100k+ DBs).
    # Instead, slice by requested page/per_page and compute totals.
    if isinstance(data, list):
        page = int(qp.get("page") or 1)
        per_page = int(qp.get("per_page") or qp.get("limit") or 50)
        page = max(1, page)
        per_page = max(1, min(per_page, _PAGINATION_MAX_PER_PAGE))
        total = len(data)
        start = (page - 1) * per_page
        end = start + per_page
        items = data[start:end]
        total_pages = max(1, (total + per_page - 1) // per_page)
        return {"items": items, "total": total, "page": page, "per_page": per_page, "total_pages": total_pages}

    page = int(qp.get("page") or 1)
    per_page = int(qp.get("per_page") or qp.get("limit") or 50)
    return {"items": [], "total": 0, "page": page, "per_page": per_page, "total_pages": 1}

@api.get("/cached-users")
async def get_cached_users(
    page: int = 1,
    per_page: int = 50,
    search: str = "",
    source: str = "",  # UTM source_code filter
    force: bool = False,
    _session: Dict[str, Any] = Depends(_require_auth)
) -> Dict[str, Any]:
    """Get paginated users (server-side pagination via Bot API module)."""
    page = max(1, int(page or 1))
    per_page = max(1, min(int(per_page or 50), _PAGINATION_MAX_PER_PAGE))
    _, profile = _get_active_bot_profile()
    params: Dict[str, Any] = {"page": page, "limit": per_page}
    if search:
        params["search"] = search
    if source:
        params["source"] = source
    return await _fetch_bot_paginated(profile, "users", params)


@api.get("/cached-keys")
async def get_cached_keys(
    page: int = 1,
    per_page: int = 50,
    search: str = "",
    status: str = "",  # "active", "expired", "all"
    tariff_id: int = None,  # tariff filter
    force: bool = False,
    _session: Dict[str, Any] = Depends(_require_auth)
) -> Dict[str, Any]:
    """Get paginated keys/subscriptions (server-side pagination via Bot API module)."""
    page = max(1, int(page or 1))
    per_page = max(1, min(int(per_page or 50), _PAGINATION_MAX_PER_PAGE))
    _, profile = _get_active_bot_profile()
    params: Dict[str, Any] = {"page": page, "limit": per_page}
    if search:
        params["search"] = search
    if status and status != "all":
        params["status"] = status
    if tariff_id is not None:
        params["tariff_id"] = tariff_id
    return await _fetch_bot_paginated(profile, "keys", params)


@api.get("/cached-payments")
async def get_cached_payments(
    page: int = 1,
    per_page: int = 50,
    search: str = "",
    status: str = "",  # "success", "pending", "failed", "all"
    provider: str = "",  # payment_system
    force: bool = False,
    _session: Dict[str, Any] = Depends(_require_auth)
) -> Dict[str, Any]:
    """Get paginated payments (server-side pagination via Bot API module)."""
    page = max(1, int(page or 1))
    per_page = max(1, min(int(per_page or 50), _PAGINATION_MAX_PER_PAGE))
    _, profile = _get_active_bot_profile()
    params: Dict[str, Any] = {"page": page, "limit": per_page}
    if search:
        params["search"] = search
    if status and status != "all":
        params["status"] = status
    if provider and provider != "all":
        params["provider"] = provider
    return await _fetch_bot_paginated(profile, "payments", params)

# -----------------------
# Partner payouts stats (computed via Bot API module payments)
# -----------------------
@api.get("/partner-payouts-stats")
async def get_partner_payouts_stats(
    force: bool = False,
    _session: Dict[str, Any] = Depends(_require_auth),
) -> Dict[str, Any]:
    """
    Stats for partner payouts (used in Dashboard "Партнёрская программа" card).
    Prefer withdrawals/payouts history endpoints from the bot module (closest to what the bot shows).
    Fallback: best-effort detection from payments list by withdrawal keywords.
    """
    def parse_ts(val: Any) -> Optional[float]:
        if not val:
            return None
        if isinstance(val, (int, float)):
            v = float(val)
            return v / 1000 if v > 10000000000 else v
        if isinstance(val, str):
            try:
                dt = datetime.fromisoformat(val.replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone(timedelta(hours=3)))
                return dt.timestamp()
            except Exception:
                return None
        return None

    MOSCOW_OFFSET_SEC = 3 * 60 * 60

    def to_moscow_day(ts: float) -> str:
        moscow_ts = ts + MOSCOW_OFFSET_SEC
        d = datetime.fromtimestamp(moscow_ts, tz=timezone.utc)
        return d.strftime("%Y-%m-%d")

    def to_moscow_month(ts: float) -> str:
        moscow_ts = ts + MOSCOW_OFFSET_SEC
        d = datetime.fromtimestamp(moscow_ts, tz=timezone.utc)
        return d.strftime("%Y-%m")

    def is_success_payment(p: Dict[str, Any]) -> bool:
        status = str(p.get("status") or p.get("payment_status") or "").lower()
        return status in ("success", "successful", "completed", "paid")

    def is_payout_payment(p: Dict[str, Any]) -> bool:
        """
        Heuristic payout detector (partner payouts / withdrawals).
        Uses provider/payment_system/type/description keywords. Keep it strict to avoid counting user payments.
        """
        ps = str(p.get("payment_system") or p.get("provider") or "").lower()
        pt = str(p.get("type") or p.get("payment_type") or "").lower()
        desc = str(p.get("description") or p.get("comment") or p.get("title") or "").lower()
        meta = str(p.get("meta") or p.get("payload") or p.get("details") or "").lower()
        hay = f"{ps} {pt} {desc} {meta}"
        keywords = (
            "withdraw", "withdrawal", "payout", "payouts",
            "вывод", "выплат", "выплата",
        )
        return any(k in hay for k in keywords)

    def amount_value(p: Dict[str, Any]) -> float:
        try:
            return float(p.get("amount") or p.get("sum") or 0)
        except Exception:
            return 0.0

    def any_amount_value(obj: Dict[str, Any]) -> float:
        for k in ("amount", "sum", "value", "payout_amount", "withdrawal_amount"):
            if k in obj:
                try:
                    return float(obj.get(k) or 0)
                except Exception:
                    return 0.0
        return 0.0

    def any_ts_value(obj: Dict[str, Any]) -> Optional[float]:
        for k in ("paid_at", "payed_at", "paidAt", "created_at", "createdAt", "date", "time", "timestamp"):
            if k in obj and obj.get(k):
                v = parse_ts(obj.get(k))
                if v is not None:
                    return v
        return None

    # Cache (5 min, also invalidated on Moscow day change)
    _, profile = _get_active_bot_profile()
    profile_id = str(profile.get("id") or "default")
    if not force:
        cached = _bot_cache_get(profile_id, "partner_payouts_stats", include_day=True)
        if cached:
            return cached

    now = datetime.now(timezone.utc)
    now_ts = now.timestamp()
    today_key = to_moscow_day(now_ts)
    yesterday_key = to_moscow_day(now_ts - 86400)
    this_month_key = to_moscow_month(now_ts)
    week_days = {to_moscow_day(now_ts - i * 86400) for i in range(7)}

    max_pages = max(1, int(os.getenv("ADMINPANEL_PAYOUTS_STATS_MAX_PAGES", "300")))
    per_page = min(_PAGINATION_MAX_PER_PAGE, 200)

    totals = {"today": 0.0, "yesterday": 0.0, "week": 0.0, "month": 0.0, "total": 0.0}
    scanned_items = 0
    scanned_pages = 0
    truncated_total = False

    def _accumulate(items: list[dict], *, ts_key: str = "created_at", amount_fn: Optional[Callable[[Dict[str, Any]], float]] = None) -> int:
        nonlocal scanned_items, totals
        matched = 0
        for p in items:
            if not isinstance(p, dict):
                continue
            created = None
            if ts_key == "any":
                created = any_ts_value(p)
            else:
                created = parse_ts(p.get(ts_key) or p.get("createdAt"))
            if not created:
                continue
            amt = (amount_fn or amount_value)(p)
            if not isinstance(amt, (int, float)):
                continue
            scanned_items += 1
            matched += 1

            day_key = to_moscow_day(created)
            month_key = to_moscow_month(created)

            totals["total"] += amt
            if month_key == this_month_key:
                totals["month"] += amt
            if day_key == today_key:
                totals["today"] += amt
            if day_key == yesterday_key:
                totals["yesterday"] += amt
            if day_key in week_days:
                totals["week"] += amt
        return matched

    async def _compute_from_candidates() -> bool:
        """
        Try bot-module endpoints that likely represent partner withdrawals/payouts history.
        Returns True if we matched any payouts.
        """
        nonlocal scanned_pages, truncated_total
        candidates: list[tuple[str, Dict[str, Any]]] = [
            ("partners/withdrawals", {"status": "paid"}),
            ("partners/withdrawals", {"state": "paid"}),
            ("partners/withdrawals/paid", {}),
            ("partners/payouts", {"status": "paid"}),
            ("partners/payouts/paid", {}),
        ]
        for path, extra in candidates:
            page = 1
            matched_local = 0
            while True:
                if scanned_pages >= max_pages:
                    truncated_total = True
                    break
                scanned_pages += 1
                data = await _fetch_bot_paginated(profile, path, {"page": page, "limit": per_page, **extra})
                items = data.get("items") if isinstance(data, dict) else None
                if not isinstance(items, list) or not items:
                    break
                # withdrawals records often have paid_at/created_at and amount/sum/value; use "any" extractor
                matched_local += _accumulate([p for p in items if isinstance(p, dict)], ts_key="any", amount_fn=any_amount_value)
                total_pages = int(data.get("total_pages") or 1) if isinstance(data, dict) else 1
                if page >= total_pages:
                    break
                page += 1
            if matched_local > 0:
                return True
            if truncated_total:
                return scanned_items > 0
        return False

    # 1) Prefer withdrawals/payouts history from module.
    got_any = await _compute_from_candidates()

    # 2) Fallback: scan payments list (strict withdrawal keywords).
    if not truncated_total and not got_any and scanned_items == 0:
        page = 1
        while True:
            if scanned_pages >= max_pages:
                truncated_total = True
                break
            scanned_pages += 1
            data = await _fetch_bot_paginated(profile, "payments", {"page": page, "limit": per_page, "status": "success"})
            items = data.get("items") if isinstance(data, dict) else None
            if not isinstance(items, list) or not items:
                break
            filtered = []
            for p in items:
                if not isinstance(p, dict):
                    continue
                if not is_success_payment(p):
                    continue
                if not is_payout_payment(p):
                    continue
                filtered.append(p)
            _accumulate(filtered)
            total_pages = int(data.get("total_pages") or 1) if isinstance(data, dict) else 1
            if page >= total_pages:
                break
            page += 1

    payload = {
        "ok": True,
        "cached_at": datetime.now(timezone.utc).isoformat(),
        "today": round(totals["today"], 2),
        "yesterday": round(totals["yesterday"], 2),
        "week": round(totals["week"], 2),
        "month": round(totals["month"], 2),
        "total": round(totals["total"], 2),
        "scanned_items": scanned_items,
        "scanned_pages": scanned_pages,
        "truncated_total": truncated_total,
    }
    _bot_cache_set(profile_id, "partner_payouts_stats", payload, include_day=True)
    return payload


@api.get("/partner-attracted-stats")
async def get_partner_attracted_stats(
    force: bool = False,
    _session: Dict[str, Any] = Depends(_require_auth),
) -> Dict[str, Any]:
    """
    "Привлечено" stats like in the bot:
    counts referred users by registration date (fallback), or by referral event date if provided by module.
    """
    def parse_ts(val: Any) -> Optional[float]:
        if not val:
            return None
        if isinstance(val, (int, float)):
            v = float(val)
            return v / 1000 if v > 10000000000 else v
        if isinstance(val, str):
            try:
                dt = datetime.fromisoformat(val.replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone(timedelta(hours=3)))
                return dt.timestamp()
            except Exception:
                return None
        return None

    MOSCOW_OFFSET_SEC = 3 * 60 * 60

    def to_moscow_day(ts: float) -> str:
        moscow_ts = ts + MOSCOW_OFFSET_SEC
        d = datetime.fromtimestamp(moscow_ts, tz=timezone.utc)
        return d.strftime("%Y-%m-%d")

    def to_moscow_month(ts: float) -> str:
        moscow_ts = ts + MOSCOW_OFFSET_SEC
        d = datetime.fromtimestamp(moscow_ts, tz=timezone.utc)
        return d.strftime("%Y-%m")

    # Cache (5 min, invalidated on Moscow day change)
    _, profile = _get_active_bot_profile()
    profile_id = str(profile.get("id") or "default")
    if not force:
        cached = _bot_cache_get(profile_id, "partner_attracted_stats", include_day=True)
        if cached:
            return cached

    now = datetime.now(timezone.utc)
    now_ts = now.timestamp()
    today_key = to_moscow_day(now_ts)
    yesterday_key = to_moscow_day(now_ts - 86400)
    this_month_key = to_moscow_month(now_ts)
    week_days = {to_moscow_day(now_ts - i * 86400) for i in range(7)}

    max_pages = max(1, int(os.getenv("ADMINPANEL_ATTRACTED_STATS_MAX_PAGES", "300")))
    per_page = min(_PAGINATION_MAX_PER_PAGE, 200)

    totals = {"today": 0, "yesterday": 0, "week": 0, "month": 0, "total": 0}
    scanned_pages = 0
    truncated = False

    # 1) Try to compute directly from referral records if they contain timestamps.
    referred_ids: set[int] = set()
    referred_ts: Dict[int, float] = {}

    page = 1
    while True:
        if scanned_pages >= max_pages:
            truncated = True
            break
        scanned_pages += 1
        data = await _fetch_bot_paginated(profile, "referrals", {"page": page, "limit": per_page})
        items = data.get("items") if isinstance(data, dict) else None
        if not isinstance(items, list) or not items:
            break
        for r in items:
            if not isinstance(r, dict):
                continue
            rid = r.get("referred_tg_id") or r.get("referredId") or r.get("referred_tgId")
            try:
                rid_int = int(rid)
            except Exception:
                continue
            referred_ids.add(rid_int)
            ts = parse_ts(r.get("created_at") or r.get("createdAt") or r.get("date") or r.get("timestamp"))
            if ts is not None:
                # keep earliest if multiple
                prev = referred_ts.get(rid_int)
                if prev is None or ts < prev:
                    referred_ts[rid_int] = ts
        total_pages = int(data.get("total_pages") or 1) if isinstance(data, dict) else 1
        if page >= total_pages:
            break
        page += 1

    # If referral timestamps exist, use them.
    if referred_ts:
        uniq = set(referred_ts.keys())
        totals["total"] = len(uniq)
        for rid, ts in referred_ts.items():
            day_key = to_moscow_day(ts)
            month_key = to_moscow_month(ts)
            if day_key == today_key:
                totals["today"] += 1
            if day_key == yesterday_key:
                totals["yesterday"] += 1
            if day_key in week_days:
                totals["week"] += 1
            if month_key == this_month_key:
                totals["month"] += 1
    else:
        # 2) Fallback: count referred users by user registration date (fetch /users/<tg_id>).
        base_url = get_bot_api_base_url(profile)
        token = str(profile.get("token") or "").strip()
        admin_id = str(profile.get("adminId") or "").strip()
        headers: Dict[str, str] = {"Accept": "application/json"}
        if token:
            headers["X-Token"] = token
        timeout = httpx.Timeout(connect=10.0, read=30.0, write=30.0, pool=10.0)
        params = {"tg_id": admin_id} if admin_id else {}

        async def fetch_user_created_at(client: httpx.AsyncClient, tg_id: int) -> Optional[float]:
            try:
                url = base_url.rstrip("/") + f"/users/{tg_id}"
                resp = await client.get(url, params=params)
                if resp.status_code >= 400:
                    return None
                data = resp.json()
                if isinstance(data, dict) and "user" in data and isinstance(data["user"], dict):
                    data = data["user"]
                if not isinstance(data, dict):
                    return None
                return parse_ts(data.get("created_at") or data.get("createdAt") or data.get("registered_at") or data.get("date"))
            except Exception:
                return None

        uniq = set(referred_ids)
        totals["total"] = len(uniq)
        if base_url and uniq:
            sem = asyncio.Semaphore(int(os.getenv("ADMINPANEL_ATTRACTED_USER_CONCURRENCY", "20")))

            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, headers=headers) as client:
                async def one(tg_id: int) -> Optional[float]:
                    async with sem:
                        return await fetch_user_created_at(client, tg_id)

                created_list = await asyncio.gather(*[one(tid) for tid in list(uniq)], return_exceptions=True)
            for ts in created_list:
                if isinstance(ts, Exception) or ts is None:
                    continue
                day_key = to_moscow_day(float(ts))
                month_key = to_moscow_month(float(ts))
                if day_key == today_key:
                    totals["today"] += 1
                if day_key == yesterday_key:
                    totals["yesterday"] += 1
                if day_key in week_days:
                    totals["week"] += 1
                if month_key == this_month_key:
                    totals["month"] += 1

    payload = {
        "ok": True,
        "cached_at": datetime.now(timezone.utc).isoformat(),
        **totals,
        "scanned_pages": scanned_pages,
        "truncated": truncated,
    }
    _bot_cache_set(profile_id, "partner_attracted_stats", payload, include_day=True)
    return payload

# -----------------------
# Partner payout requests (admin management)
# -----------------------

def _get_bot_db_session():
    """Get a raw DB session via the bot's DB engine (same DB as bot)."""
    try:
        from database import AsyncSessionLocal
        return AsyncSessionLocal()
    except Exception:
        return None

@api.get("/partner-withdrawals")
async def get_partner_withdrawals(
    status: str = "pending",
    page: int = 1,
    limit: int = 25,
    _session: Dict[str, Any] = Depends(_require_auth),
) -> Dict[str, Any]:
    """List payout requests. status: pending|completed|all"""
    try:
        from database import AsyncSessionLocal
        from sqlalchemy import text as _text
        async with AsyncSessionLocal() as db:
            # Check table exists
            exists = (await db.execute(_text(
                "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='payout_requests'"
            ))).scalar()
            if not exists:
                return {"ok": True, "items": [], "total": 0, "pages": 0, "no_module": True}

            where = ""
            if status == "pending":
                where = "WHERE lower(coalesce(status,'')) ~ '(pending|wait)' OR lower(coalesce(status,'')) IN ('created','new')"
            elif status == "completed":
                where = "WHERE lower(coalesce(status,'')) IN ('approved','paid','done','success','completed','rejected','declined','cancelled')"

            total = int((await db.execute(_text(f"SELECT COUNT(*) FROM payout_requests {where}"))).scalar() or 0)
            offset = (max(1, page) - 1) * limit
            rows = (await db.execute(_text(
                f"SELECT id, tg_id, amount, method, destination, status, created_at FROM payout_requests {where} ORDER BY created_at DESC LIMIT :lim OFFSET :off"
            ), {"lim": limit, "off": offset})).fetchall()

            items = []
            for r in rows:
                items.append({
                    "id": r[0], "tg_id": r[1], "amount": float(r[2] or 0),
                    "method": r[3], "destination": r[4], "status": r[5],
                    "created_at": r[6].isoformat() if r[6] else None,
                })
            return {"ok": True, "items": items, "total": total, "pages": max(1, -(-total // limit))}
    except ImportError:
        return {"ok": False, "error": "no_module", "items": [], "total": 0, "pages": 0}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@api.post("/partner-withdrawals/{withdrawal_id}/approve")
async def approve_partner_withdrawal(
    withdrawal_id: int,
    request: Request,
    _session: Dict[str, Any] = Depends(_require_auth),
) -> Dict[str, Any]:
    _require_csrf(request, _session)
    try:
        from database import AsyncSessionLocal
        from sqlalchemy import text as _text
        async with AsyncSessionLocal() as db:
            result = await db.execute(_text(
                "UPDATE payout_requests SET status='approved' WHERE id=:id AND lower(coalesce(status,'')) NOT IN ('approved','paid','done') RETURNING id"
            ), {"id": withdrawal_id})
            updated = result.fetchone()
            await db.commit()
            if not updated:
                raise HTTPException(status_code=404, detail="Заявка не найдена или уже обработана")
            return {"ok": True, "id": withdrawal_id}
    except HTTPException:
        raise
    except ImportError:
        raise HTTPException(status_code=400, detail="Модуль партнёрской программы недоступен")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@api.post("/partner-withdrawals/{withdrawal_id}/reject")
async def reject_partner_withdrawal(
    withdrawal_id: int,
    request: Request,
    _session: Dict[str, Any] = Depends(_require_auth),
) -> Dict[str, Any]:
    """Reject and return funds to partner balance."""
    _require_csrf(request, _session)
    try:
        from database import AsyncSessionLocal
        from sqlalchemy import text as _text
        async with AsyncSessionLocal() as db:
            row = (await db.execute(_text(
                "SELECT tg_id, amount, status FROM payout_requests WHERE id=:id"
            ), {"id": withdrawal_id})).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Заявка не найдена")
            tg_id, amount, cur_status = row
            if str(cur_status).lower() in ("approved", "paid", "done"):
                raise HTTPException(status_code=400, detail="Заявка уже одобрена — нельзя отклонить")
            # Return funds to partner balance
            await db.execute(_text(
                "UPDATE payout_requests SET status='rejected' WHERE id=:id"
            ), {"id": withdrawal_id})
            await db.execute(_text(
                "UPDATE users SET partner_balance = COALESCE(partner_balance,0) + :amt WHERE tg_id=:t"
            ), {"amt": float(amount or 0), "t": tg_id})
            await db.commit()
            return {"ok": True, "id": withdrawal_id, "refunded": float(amount or 0)}
    except HTTPException:
        raise
    except ImportError:
        raise HTTPException(status_code=400, detail="Модуль партнёрской программы недоступен")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@api.post("/partner-reset-methods")
async def reset_partner_disabled_methods(
    request: Request,
    _session: Dict[str, Any] = Depends(_require_auth),
) -> Dict[str, Any]:
    """Reset disabled/empty payout methods for all partners."""
    _require_csrf(request, _session)
    try:
        from database import AsyncSessionLocal
        from sqlalchemy import text as _text
        async with AsyncSessionLocal() as db:
            result = await db.execute(_text(
                "UPDATE users SET payout_method=NULL, card_number=NULL WHERE partner_balance IS NOT NULL AND (payout_method IS NULL OR payout_method='' OR card_number IS NULL OR card_number='') RETURNING tg_id"
            ))
            rows = result.fetchall()
            await db.commit()
            return {"ok": True, "reset_count": len(rows)}
    except ImportError:
        raise HTTPException(status_code=400, detail="Модуль партнёрской программы недоступен")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# -----------------------
# Monitoring (local JSON)
# -----------------------
@api.get("/monitoring/settings/")
def get_monitoring_settings(_session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    data = _read_json(MONITORING_SETTINGS_FILE, {})
    if not isinstance(data, dict):
        data = {}
    # Mask sensitive tokens in response — bot tokens should not be exposed in API
    safe = dict(data)
    recipients = safe.get("recipients")
    if isinstance(recipients, list):
        masked = []
        for r in recipients:
            if isinstance(r, dict):
                r = dict(r)
                if r.get("botToken"):
                    r["botToken"] = ""
                    r["botTokenSet"] = True
            masked.append(r)
        safe["recipients"] = masked
    return safe


@api.post("/monitoring/settings/")
async def save_monitoring_settings(request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    _require_csrf(request, session)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")
    # Preserve existing botToken values if client sends empty string (masked field)
    existing = _read_json(MONITORING_SETTINGS_FILE, {})
    existing_recipients = {str(r.get("id") or ""): r for r in (existing.get("recipients") or []) if isinstance(r, dict)}
    new_recipients = payload.get("recipients")
    if isinstance(new_recipients, list):
        for r in new_recipients:
            if not isinstance(r, dict):
                continue
            rid = str(r.get("id") or "")
            if not r.get("botToken") and rid in existing_recipients:
                r["botToken"] = existing_recipients[rid].get("botToken", "")
    _write_json(MONITORING_SETTINGS_FILE, payload)
    return payload


@api.get("/monitoring/state/")
def get_monitoring_state(_session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    data = _read_json(MONITORING_STATE_FILE, {})
    if not isinstance(data, dict):
        data = {}
    return data


# -----------------------
# AdminPanel process metrics (this server)
# -----------------------
_PANEL_METRICS_LOCK = threading.Lock()
_PANEL_METRICS_PREV: Tuple[float, int] | None = None  # (ts, cpu_jiffies_total)


def _panel_read_rss_kb(pid: int) -> Optional[int]:
    try:
        with open(f"/proc/{pid}/status", "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    parts = line.split()
                    if len(parts) >= 2:
                        return int(parts[1])
    except Exception:
        return None
    return None


def _panel_read_proc_cpu_jiffies(pid: int) -> Optional[int]:
    # utime+stime from /proc/<pid>/stat
    try:
        with open(f"/proc/{pid}/stat", "r", encoding="utf-8", errors="ignore") as f:
            s = f.read().strip()
        if not s:
            return None
        rp = s.rfind(")")
        if rp == -1:
            return None
        tail = s[rp + 1 :].strip().split()
        if len(tail) < 13:
            return None
        utime = int(tail[11])
        stime = int(tail[12])
        return int(utime + stime)
    except Exception:
        return None


@api.get("/monitoring/panel-metrics/")
def get_panel_metrics(_session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    """
    CPU/RAM of the AdminPanel backend process (this server).
    This answers: "Сколько потребляет админка".
    """
    import math

    pid = int(os.getpid())
    now = time.time()
    rss_kb = _panel_read_rss_kb(pid)
    rss_mb = float(rss_kb) / 1024.0 if isinstance(rss_kb, int) and rss_kb >= 0 else None

    cpu_pct: Optional[float] = None
    j = _panel_read_proc_cpu_jiffies(pid)
    cpu_cores = int(os.cpu_count() or 1)

    if j is not None:
        with _PANEL_METRICS_LOCK:
            global _PANEL_METRICS_PREV
            if _PANEL_METRICS_PREV is not None:
                ts0, j0 = _PANEL_METRICS_PREV
                dt = max(0.001, now - float(ts0))
                dj = int(j - int(j0))
                try:
                    clk = int(os.sysconf(os.sysconf_names["SC_CLK_TCK"]))
                except Exception:
                    clk = 100
                if dj >= 0 and clk > 0:
                    cpu_pct = 100.0 * ((float(dj) / float(clk)) / dt)
                    # can be >100 on multi-core; clamp to 100*cores for display
                    cpu_pct = float(max(0.0, min(cpu_pct, 100.0 * float(cpu_cores))))
                    if not math.isfinite(cpu_pct):
                        cpu_pct = None
            _PANEL_METRICS_PREV = (now, int(j))

    return {
        "ok": True,
        "ts": int(now * 1000),
        "process": {"pid": pid, "cpu_pct": cpu_pct, "rss_mb": rss_mb, "cpu_cores": cpu_cores},
    }


# -----------------------
# UI Settings / Branding
# -----------------------
@api.get("/ui/settings/")
def get_ui_settings(_session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    data = _read_json(UI_SETTINGS_FILE, {})
    return data if isinstance(data, dict) else {}


@api.post("/ui/settings/")
async def save_ui_settings(request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    _require_csrf(request, session)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")
    _write_json(UI_SETTINGS_FILE, payload)
    return payload


# -----------------------
# Notifications state (server-side read/unread)
# -----------------------
@api.get("/notifications/state/")
def get_notifications_state(_session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    return _get_notifications_state(NOTIFICATIONS_STATE_FILE)


@api.post("/notifications/state/")
async def save_notifications_state(request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    _require_csrf(request, session)
    payload = await request.json()
    result = _save_notifications_state(NOTIFICATIONS_STATE_FILE, payload)
    # keep backward-compatible response shape for frontend
    return {
        "ok": True,
        "count": int(result.get("count") or 0),
        "dismissed_before": int(result.get("dismissed_before") or 0),
        "status_notifications": result.get("status_notifications") or [],
        "updated_at": int(result.get("updated_at") or 0),
    }


# -----------------------
# Sender: saved messages (server-side) + photo upload
# -----------------------
class SavedSenderButton(BaseModel):
    text: str
    url: Optional[str] = None
    callback: Optional[str] = None


class SavedSenderMessage(BaseModel):
    id: Optional[str] = None
    name: str
    send_to: Optional[str] = None
    cluster_name: Optional[str] = None
    tg_id: Optional[int] = None
    text: str
    photo: Optional[str] = None
    buttons: Optional[List[SavedSenderButton]] = None


def _sender_messages_read() -> Dict[str, Any]:
    data = _read_json(SENDER_MESSAGES_FILE, {"by_profile": {}})
    if not isinstance(data, dict):
        return {"by_profile": {}}
    by_profile = data.get("by_profile")
    if not isinstance(by_profile, dict):
        by_profile = {}
    return {"by_profile": by_profile}


def _sender_messages_write(data: Dict[str, Any]) -> None:
    _write_json(SENDER_MESSAGES_FILE, data)


def _sender_messages_for_profile(profile_id: str) -> List[Dict[str, Any]]:
    store = _sender_messages_read()
    by_profile = store.get("by_profile") or {}
    items = by_profile.get(str(profile_id)) or []
    if not isinstance(items, list):
        return []
    # keep only dicts
    cleaned: List[Dict[str, Any]] = [x for x in items if isinstance(x, dict)]
    cleaned.sort(key=lambda x: float(x.get("updated_at_ts") or 0), reverse=True)
    return cleaned


@api.get("/sender/saved-messages/")
def list_sender_saved_messages(_session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    _, active = _get_active_bot_profile()
    pid = str(active.get("id") or "")
    if not pid:
        raise HTTPException(status_code=400, detail="Нет активного профиля. Настройте его в Settings.")
    return {"ok": True, "items": _sender_messages_for_profile(pid)}


@api.post("/sender/saved-messages/")
async def upsert_sender_saved_message(request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    _require_csrf(request, session)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")
    msg = SavedSenderMessage(**payload)

    _, active = _get_active_bot_profile()
    pid = str(active.get("id") or "")
    if not pid:
        raise HTTPException(status_code=400, detail="Нет активного профиля. Настройте его в Settings.")

    store = _sender_messages_read()
    by_profile = store.get("by_profile") or {}
    items = by_profile.get(pid) or []
    if not isinstance(items, list):
        items = []

    now = time.time()
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    msg_id = (msg.id or "").strip()
    if not msg_id:
        msg_id = secrets.token_hex(6)
        created_iso = now_iso
        created_ts = now
        updated_iso = now_iso
        updated_ts = now
        item = {
            "id": msg_id,
            "name": str(msg.name or "").strip()[:120],
            "send_to": (str(msg.send_to).strip() if msg.send_to else None),
            "cluster_name": (str(msg.cluster_name).strip() if msg.cluster_name else None),
            "tg_id": int(msg.tg_id) if msg.tg_id else None,
            "text": str(msg.text or ""),
            "photo": (str(msg.photo).strip() if msg.photo else None),
            "buttons": [b.model_dump() for b in (msg.buttons or [])],
            "created_at": created_iso,
            "created_at_ts": created_ts,
            "updated_at": updated_iso,
            "updated_at_ts": updated_ts,
        }
        items = [item] + [x for x in items if isinstance(x, dict)][:99]
    else:
        found = False
        next_items: List[Dict[str, Any]] = []
        for x in items:
            if not isinstance(x, dict):
                continue
            if str(x.get("id") or "") == msg_id:
                found = True
                x = dict(x)
                x["name"] = str(msg.name or "").strip()[:120]
                x["send_to"] = (str(msg.send_to).strip() if msg.send_to else None)
                x["cluster_name"] = (str(msg.cluster_name).strip() if msg.cluster_name else None)
                x["tg_id"] = int(msg.tg_id) if msg.tg_id else None
                x["text"] = str(msg.text or "")
                x["photo"] = (str(msg.photo).strip() if msg.photo else None)
                x["buttons"] = [b.model_dump() for b in (msg.buttons or [])]
                x["updated_at"] = now_iso
                x["updated_at_ts"] = now
            next_items.append(x)
        if not found:
            # treat as create with given id
            item = {
                "id": msg_id,
                "name": str(msg.name or "").strip()[:120],
                "send_to": (str(msg.send_to).strip() if msg.send_to else None),
                "cluster_name": (str(msg.cluster_name).strip() if msg.cluster_name else None),
                "tg_id": int(msg.tg_id) if msg.tg_id else None,
                "text": str(msg.text or ""),
                "photo": (str(msg.photo).strip() if msg.photo else None),
                "buttons": [b.model_dump() for b in (msg.buttons or [])],
                "created_at": now_iso,
                "created_at_ts": now,
                "updated_at": now_iso,
                "updated_at_ts": now,
            }
            next_items = [item] + next_items
        # sort newest first
        next_items.sort(key=lambda x: float(x.get("updated_at_ts") or 0), reverse=True)
        items = next_items[:100]

    by_profile[pid] = items
    store["by_profile"] = by_profile
    _sender_messages_write(store)
    return {"ok": True, "id": msg_id}


@api.delete("/sender/saved-messages/{msg_id}")
async def delete_sender_saved_message(msg_id: str, request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    _require_csrf(request, session)
    _, active = _get_active_bot_profile()
    pid = str(active.get("id") or "")
    if not pid:
        raise HTTPException(status_code=400, detail="Нет активного профиля. Настройте его в Settings.")

    mid = str(msg_id or "").strip()
    if not mid:
        raise HTTPException(status_code=400, detail="msg_id is required")

    store = _sender_messages_read()
    by_profile = store.get("by_profile") or {}
    items = by_profile.get(pid) or []
    if not isinstance(items, list):
        items = []
    next_items = [x for x in items if not (isinstance(x, dict) and str(x.get("id") or "") == mid)]
    by_profile[pid] = next_items
    store["by_profile"] = by_profile
    _sender_messages_write(store)
    return {"ok": True, "deleted": True}


@api.post("/uploads/photo")
async def upload_sender_photo(request: Request, file: UploadFile = File(...), session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    """
    Upload photo for Sender broadcasts.
    Returns URL that can be pasted into Sender photo field.
    """
    _require_csrf(request, session)

    filename = str(file.filename or "").strip()
    ext = Path(filename).suffix.lower()
    allowed = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
    if ext not in allowed:
        raise HTTPException(status_code=400, detail="Поддерживаются только: png, jpg, jpeg, webp, gif")

    header = await file.read(12)
    if not _check_image_magic(header, ext):
        raise HTTPException(status_code=400, detail="Тип файла не соответствует расширению")

    SENDER_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    out_name = f"{int(time.time())}_{secrets.token_hex(8)}{ext}"
    out_path = (SENDER_UPLOADS_DIR / out_name).resolve()
    if not str(out_path).startswith(str(SENDER_UPLOADS_DIR.resolve())):
        raise HTTPException(status_code=400, detail="Invalid filename")

    max_bytes = 10 * 1024 * 1024  # 10MB
    size = len(header)
    with out_path.open("wb") as f:
        f.write(header)
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > max_bytes:
                try:
                    out_path.unlink(missing_ok=True)
                except Exception:
                    pass
                raise HTTPException(status_code=413, detail="Файл слишком большой (макс 10MB)")
            f.write(chunk)
    try:
        os.chmod(out_path, 0o644)
    except Exception:
        pass

    rel = f"/webpanel/uploads/sender/{out_name}"
    # Best-effort absolute URL for convenience (Telegram requires host).
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme or "http"
    abs_url = f"{proto}://{host}{rel}" if host else rel
    return {"ok": True, "url": abs_url, "relative_url": rel}


# -----------------------
# Bot servers (proxy to bot API)
# -----------------------
@api.api_route("/servers", methods=["GET", "POST"])
async def servers(request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Response:
    if request.method.upper() == "POST":
        _require_csrf(request, session)
    return await _proxy_to_bot(request, "servers", add_admin_tg_id=True)


@api.api_route("/servers/{identifier:path}", methods=["GET", "PATCH", "DELETE"])
async def servers_by_identifier(identifier: str, request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Response:
    if request.method.upper() in {"PATCH", "DELETE"}:
        _require_csrf(request, session)
    return await _proxy_to_bot(request, f"servers/{identifier}", add_admin_tg_id=True)


# -----------------------
# LK settings (proxy to bot module API)
# -----------------------
@api.api_route("/lk-settings", methods=["GET", "PATCH"])
async def lk_settings(request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Response:
    if request.method.upper() == "PATCH":
        _require_csrf(request, session)
    return await _proxy_to_bot(request, "lk/admin/settings", add_admin_tg_id=True)


def _get_bot_profile_by_id_full(profile_id: str) -> Optional[Dict[str, Any]]:
    profile_id = str(profile_id or "").strip()
    if not profile_id:
        return None
    data = _read_json(BOT_PROFILES_FILE, {"profiles": [], "activeProfileId": None})
    profiles = (data or {}).get("profiles") or []
    if not isinstance(profiles, list):
        return None
    for p in profiles:
        if isinstance(p, dict) and str(p.get("id") or "").strip() == profile_id:
            p = dict(p)
            p["token"] = _token_decrypt(str(p.get("token") or ""))
            return p
    return None


async def _proxy_to_bot_profile(request: Request, profile_id: str, upstream_path: str, *, add_admin_tg_id: bool, body_override: bytes | None = None) -> Response:
    prof = _get_bot_profile_by_id_full(profile_id)
    if not prof:
        return _error(404, "Профиль бота не найден")
    base_url = get_bot_api_base_url(prof)
    token = str(prof.get("token") or "")
    admin_id = str(prof.get("adminId") or "")
    if not base_url:
        return _error(400, "URL API модуля не указан")
    if add_admin_tg_id and not admin_id:
        return _error(400, "Admin ID не указан")
    if not token:
        return _error(400, "Token Admin не указан (сохраните токен в профиле)")
    return await _proxy_to_bot_request_impl(
        request,
        upstream_path,
        base_url=base_url,
        token=token,
        admin_id=admin_id,
        add_admin_tg_id=add_admin_tg_id,
        error_fn=_error,
        body_override=body_override,
    )


@api.get("/bot-profiles/{profile_id}/lk-settings")
async def lk_settings_get_for_bot_profile(profile_id: str, session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    """GET: отдаём настройки ЛК из adminpanel (lk_profiles.json) — без обращения к боту."""
    data = _load_lk_profiles_data()
    profiles = data.get("profiles") or []
    for p in profiles:
        bot_ids = p.get("botProfileIds") or []
        if profile_id in [str(b) for b in bot_ids]:
            return {"ok": True, "data": _lk_profile_settings_out(p)}
    return {"ok": True, "data": {
        "brand_title": "", "domain": "", "support_url": "",
        "enabled_tariff_group_codes": [], "enabled_payment_providers": [], "invite_tab_mode": "auto",
    }}


@api.patch("/bot-profiles/{profile_id}/lk-settings")
async def lk_settings_patch_for_bot_profile(profile_id: str, request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Response:
    """PATCH: сохраняем все настройки ЛК в adminpanel; к боту отправляем только то что нужно боту (без brand_title)."""
    _require_csrf(request, session)
    bot_body_override: bytes | None = None
    try:
        body = await request.body()
        payload = json.loads(body) if body else {}
        if isinstance(payload, dict):
            data = _load_lk_profiles_data()
            profiles = data.get("profiles") or []
            for p in profiles:
                bot_ids = p.get("botProfileIds") or []
                if profile_id in [str(b) for b in bot_ids]:
                    cur = p.get("settings") or {}
                    if not isinstance(cur, dict):
                        cur = {}
                    for key in ("brand_title", "support_url", "news_url", "terms_url", "enabled_tariff_group_codes", "enabled_payment_providers", "invite_tab_mode"):
                        if key in payload:
                            cur[key] = payload[key]
                    p["settings"] = cur
                    break
            _save_lk_profiles_data(data)
            # brand_title хранится только в adminpanel — к боту не отправляем
            bot_payload = {k: v for k, v in payload.items() if k != "brand_title"}
            bot_body_override = json.dumps(bot_payload).encode()
    except Exception:
        pass
    return await _proxy_to_bot_profile(request, profile_id, "lk/admin/settings", add_admin_tg_id=True, body_override=bot_body_override)


@api.get("/bot-profiles/{profile_id}/lk-partner-module")
async def lk_partner_module_for_bot_profile(profile_id: str, request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Response:
    """Проверяем доступность модуля партнёрской программы в боте."""
    return await _proxy_to_bot_profile(request, profile_id, "lk/admin/settings", add_admin_tg_id=True)


@api.get("/bot-profiles/{profile_id}/lk-tariffs")
async def lk_tariffs_for_bot_profile(profile_id: str, request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Response:
    return await _proxy_to_bot_profile(request, profile_id, "lk/tariffs", add_admin_tg_id=False)


@api.get("/bot-profiles/{profile_id}/lk-providers")
async def lk_providers_for_bot_profile(profile_id: str, request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Response:
    return await _proxy_to_bot_profile(request, profile_id, "lk/payments/providers", add_admin_tg_id=False)


# -----------------------
# Remnawave (local JSON, token is not returned to frontend)
# -----------------------
def _load_remnawave_profiles() -> list[Dict[str, Any]]:
    data = _read_json(REMNAWAVE_PROFILES_FILE, [])
    profiles = data if isinstance(data, list) else []
    result = []
    for p in profiles:
        if not isinstance(p, dict):
            result.append(p)
            continue
        p = dict(p)
        settings = p.get("settings")
        if isinstance(settings, dict) and settings.get("token"):
            settings = dict(settings)
            settings["token"] = _token_decrypt(str(settings["token"]))
            p["settings"] = settings
        result.append(p)
    return result


def _save_remnawave_profiles(profiles: list[Dict[str, Any]]) -> None:
    encrypted = []
    for p in profiles:
        if isinstance(p, dict):
            p = dict(p)
            settings = p.get("settings")
            if isinstance(settings, dict) and settings.get("token"):
                settings = dict(settings)
                settings["token"] = _token_encrypt(str(settings["token"]))
                p["settings"] = settings
        encrypted.append(p)
    _write_json(REMNAWAVE_PROFILES_FILE, encrypted)


def _normalize_single_bot_profile_id(value: Any) -> str:
    """
    Remnawave profile binding is a *single choice* (0 or 1 bot-profile).
    Accept legacy payloads (list / scalar) and normalize to one string id or "".
    """
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        for x in value:
            s = str(x or "").strip()
            if s:
                return s
        return ""
    s = str(value or "").strip()
    return s


def _enforce_unique_remnawave_binding(profiles: list[Dict[str, Any]], *, owner_profile_id: str, bot_profile_id: str) -> None:
    """
    Ensure a bot-profile id is bound to at most ONE remnawave profile.
    If bot_profile_id is non-empty, remove it from all other profiles.
    Also normalize every profile's botProfileIds to contain at most 1 id.
    """
    bot_profile_id = str(bot_profile_id or "").strip()
    owner_profile_id = str(owner_profile_id or "").strip()
    for p in profiles:
        if not isinstance(p, dict):
            continue
        pid = str(p.get("id") or "").strip()
        current = _normalize_single_bot_profile_id(p.get("botProfileIds"))
        # Remove binding from other profiles
        if bot_profile_id and pid and pid != owner_profile_id and current == bot_profile_id:
            p["botProfileIds"] = []
            continue
        # Normalize to single-entry list (or empty)
        p["botProfileIds"] = [current] if current else []


@api.get("/remnawave/settings/")
def get_remnawave_settings(profile_id: Optional[str] = None, _session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    # Возвращаем настройки для bot-profile (profile_id=botProfileId) если найдены
    profiles = _load_remnawave_profiles()
    if profile_id:
        for p in profiles:
            if profile_id in (p.get("botProfileIds") or []):
                settings = p.get("settings") or {}
                return {"base_url": settings.get("base_url", ""), "token": ""}
    # global (backward compat): base_url пустой, token не возвращаем
    return {"base_url": "", "token": ""}


@api.get("/remnawave/settings/all/")
def get_all_remnawave_settings(_session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    profiles = _load_remnawave_profiles()
    result_profiles = []
    for p in profiles:
        settings = p.get("settings") or {}
        base_url = settings.get("base_url", "")
        for bot_profile_id in (p.get("botProfileIds") or []):
            result_profiles.append({"profileId": bot_profile_id, "settings": {"base_url": base_url, "token": ""}})
    # global: сохраняем только base_url если оно есть в файле (сейчас там agent_token)
    global_settings = {"base_url": "", "token": ""}
    return {"profiles": result_profiles, "global": global_settings}


@api.post("/remnawave/settings/")
async def save_remnawave_settings(request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    _require_csrf(request, session)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")
    # Ожидаем {base_url, token, profile_id?}. Храним token только в remnawave_profiles.json
    base_url = str(payload.get("base_url") or "")
    token = str(payload.get("token") or "")
    bot_profile_id = payload.get("profile_id")
    if bot_profile_id:
        profiles = _load_remnawave_profiles()
        # находим профиль, связанный с botProfileId
        for p in profiles:
            if bot_profile_id in (p.get("botProfileIds") or []):
                p["settings"] = {"base_url": base_url, "token": token}
                _save_remnawave_profiles(profiles)
                return {"base_url": base_url, "token": ""}
    return {"base_url": base_url, "token": ""}


@api.delete("/remnawave/settings/")
def delete_remnawave_settings(request: Request, profile_id: Optional[str] = None, session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    _require_csrf(request, session)
    if profile_id:
        profiles = _load_remnawave_profiles()
        for p in profiles:
            if profile_id in (p.get("botProfileIds") or []):
                p["settings"] = {"base_url": "", "token": ""}
        _save_remnawave_profiles(profiles)
    return {"ok": True}


@api.get("/remnawave/profiles/")
def get_remnawave_profiles(_session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    profiles = _load_remnawave_profiles()
    safe_profiles = []
    for p in profiles:
        settings = p.get("settings") or {}
        safe_profiles.append(
            {
                "id": p.get("id"),
                "name": p.get("name"),
                "settings": {"base_url": settings.get("base_url", ""), "token": ""},
                "botProfileIds": p.get("botProfileIds") or [],
            }
        )
    return {"profiles": safe_profiles}


@api.post("/remnawave/profiles/")
async def create_remnawave_profile(request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    _require_csrf(request, session)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")
    profiles = _load_remnawave_profiles()
    new_id = secrets.token_hex(16)
    settings = payload.get("settings") or {}
    selected_bot_profile_id = _normalize_single_bot_profile_id(payload.get("botProfileIds"))
    profile = {
        "id": new_id,
        "name": payload.get("name", ""),
        "settings": {"base_url": settings.get("base_url", ""), "token": settings.get("token", "")},
        "botProfileIds": [selected_bot_profile_id] if selected_bot_profile_id else [],
    }
    profiles.append(profile)
    _enforce_unique_remnawave_binding(profiles, owner_profile_id=new_id, bot_profile_id=selected_bot_profile_id)
    _save_remnawave_profiles(profiles)
    # Immediately refresh Remnawave API status so UI doesn't wait for the background loop.
    try:
        await _refresh_remnawave_status_now(profile)
    except Exception:
        pass
    return {"id": new_id, "name": profile["name"], "settings": {"base_url": profile["settings"]["base_url"], "token": ""}, "botProfileIds": profile["botProfileIds"]}


@api.put("/remnawave/profiles/{profile_id}")
async def update_remnawave_profile(profile_id: str, request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    _require_csrf(request, session)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")
    profiles = _load_remnawave_profiles()
    updated = None
    selected_bot_profile_id: Optional[str] = None
    for p in profiles:
        if p.get("id") == profile_id:
            if "name" in payload:
                p["name"] = payload.get("name")
            if "botProfileIds" in payload:
                selected_bot_profile_id = _normalize_single_bot_profile_id(payload.get("botProfileIds"))
                p["botProfileIds"] = [selected_bot_profile_id] if selected_bot_profile_id else []
            if "settings" in payload and isinstance(payload.get("settings"), dict):
                s = payload.get("settings") or {}
                p["settings"] = {"base_url": s.get("base_url", ""), "token": s.get("token", p.get("settings", {}).get("token", ""))}
            updated = p
            break
    if not updated:
        raise HTTPException(status_code=404, detail="Profile not found")
    # If user changed binding, enforce uniqueness (one bot-profile -> one remnawave profile).
    if selected_bot_profile_id is not None:
        _enforce_unique_remnawave_binding(profiles, owner_profile_id=profile_id, bot_profile_id=selected_bot_profile_id)
    else:
        # Always normalize in case legacy data sneaks in
        _enforce_unique_remnawave_binding(profiles, owner_profile_id=profile_id, bot_profile_id="")

    _save_remnawave_profiles(profiles)
    # Immediately refresh Remnawave API status for updated profile.
    try:
        await _refresh_remnawave_status_now(updated)
    except Exception:
        pass
    settings = updated.get("settings") or {}
    return {"id": updated.get("id"), "name": updated.get("name"), "settings": {"base_url": settings.get("base_url", ""), "token": ""}, "botProfileIds": updated.get("botProfileIds") or []}


@api.delete("/remnawave/profiles/{profile_id}")
def delete_remnawave_profile(profile_id: str, request: Request, session: Dict[str, Any] = Depends(_require_auth)) -> Dict[str, Any]:
    _require_csrf(request, session)
    profiles = _load_remnawave_profiles()
    
    # Находим профиль перед удалением, чтобы получить его botProfileIds
    profile_to_delete = None
    for p in profiles:
        if p.get("id") == profile_id:
            profile_to_delete = p
            break
    
    # Удаляем профиль
    profiles = [p for p in profiles if p.get("id") != profile_id]
    _save_remnawave_profiles(profiles)
    
    # Удаляем историю онлайна, состояние мониторинга и сессии Telegram для этого профиля
    if profile_to_delete:
        bot_profile_ids = profile_to_delete.get("botProfileIds") or []
        if bot_profile_ids:
            bot_profile_ids_str = [str(pid) for pid in bot_profile_ids]
            _remove_online_history_for_bot_profiles(bot_profile_ids_str)
            _remove_monitoring_state_for_profile(profile_id, bot_profile_ids_str)
            _remove_telegram_sessions_for_bot_profiles(bot_profile_ids_str)
    
    return {"ok": True}


# Remnawave runtime endpoints
async def _proxy_to_remnawave(
    request: Request,
    upstream_path: str,
    profile_id: Optional[str] = None,
) -> Response:
    """Проксирование запросов к Remnawave API"""
    # Получаем настройки Remnawave для профиля
    profiles = _load_remnawave_profiles()
    base_url = ""
    token = ""
    
    if profile_id:
        for p in profiles:
            if profile_id in (p.get("botProfileIds") or []):
                settings = p.get("settings") or {}
                base_url = settings.get("base_url", "").strip()
                token = settings.get("token", "").strip()
                break
    else:
        # Используем активный профиль бота
        try:
            _, bot_profile = _get_active_bot_profile()
            bot_profile_id = bot_profile.get("id")
            if bot_profile_id:
                for p in profiles:
                    if bot_profile_id in (p.get("botProfileIds") or []):
                        settings = p.get("settings") or {}
                        base_url = settings.get("base_url", "").strip()
                        token = settings.get("token", "").strip()
                        break
        except Exception:
            # No active bot profile yet or profiles are malformed.
            pass
    
    if not base_url:
        raise HTTPException(status_code=400, detail="Remnawave не настроен для этого профиля")

    return await _proxy_to_remnawave_request_impl(
        request,
        upstream_path,
        base_url=base_url,
        token=token,
        strip_profile_id_param=True,
        debug_log=str(os.getenv("ADMINPANEL_REMWAVE_PROXY_DEBUG", "")).strip().lower() in ("1", "true", "yes", "on"),
    )


def _get_remnawave_credentials(profile_id: Optional[str]) -> Tuple[str, str, str]:
    """
    Возвращает (cache_profile_key, base_url, token) для Remnawave.
    cache_profile_key используется для кэша и должен быть стабилен.
    """
    profiles = _load_remnawave_profiles()
    base_url = ""
    token = ""
    cache_profile_key = str(profile_id or "")

    if profile_id:
        for p in profiles:
            if profile_id in (p.get("botProfileIds") or []):
                settings = p.get("settings") or {}
                base_url = str(settings.get("base_url", "")).strip()
                token = str(settings.get("token", "")).strip()
                cache_profile_key = str(profile_id)
                break
    else:
        try:
            _, bot_profile = _get_active_bot_profile()
            bot_profile_id = bot_profile.get("id")
            if bot_profile_id:
                cache_profile_key = str(bot_profile_id)
                for p in profiles:
                    if bot_profile_id in (p.get("botProfileIds") or []):
                        settings = p.get("settings") or {}
                        base_url = str(settings.get("base_url", "")).strip()
                        token = str(settings.get("token", "")).strip()
                        break
        except Exception:
            pass

    if not base_url:
        raise HTTPException(status_code=400, detail="Remnawave не настроен для этого профиля")
    return cache_profile_key, base_url, token


@api.get("/remnawave/nodes/")
async def remnawave_nodes(request: Request, profile_id: Optional[str] = None, _session: Dict[str, Any] = Depends(_require_auth)) -> Any:
    return await _proxy_to_remnawave(request, "api/nodes", profile_id)


@api.get("/remnawave/system/stats")
async def remnawave_system_stats(request: Request, profile_id: Optional[str] = None, _session: Dict[str, Any] = Depends(_require_auth)) -> Any:
    return await _proxy_to_remnawave(request, "api/system/stats", profile_id)


@api.get("/remnawave/nodes/usage/realtime")
async def remnawave_nodes_usage_realtime(request: Request, profile_id: Optional[str] = None, _session: Dict[str, Any] = Depends(_require_auth)) -> Any:
    return await _proxy_to_remnawave(request, "api/nodes/usage/realtime", profile_id)


@api.get("/remnawave/bandwidth-stats/nodes/realtime")
async def remnawave_bandwidth_stats_nodes_realtime(request: Request, profile_id: Optional[str] = None, _session: Dict[str, Any] = Depends(_require_auth)) -> Any:
    return await _proxy_to_remnawave(request, "api/bandwidth-stats/nodes/realtime", profile_id)


@api.get("/remnawave/hosts/")
async def remnawave_hosts(request: Request, profile_id: Optional[str] = None, _session: Dict[str, Any] = Depends(_require_auth)) -> Any:
    return await _proxy_to_remnawave(request, "api/hosts", profile_id)


@api.get("/remnawave/hosts/{host_id}")
async def remnawave_host(host_id: str, request: Request, profile_id: Optional[str] = None, _session: Dict[str, Any] = Depends(_require_auth)) -> Any:
    return await _proxy_to_remnawave(request, f"api/hosts/{host_id}", profile_id)


@api.post("/remnawave/hosts/")
async def remnawave_create_host(request: Request, profile_id: Optional[str] = None, session: Dict[str, Any] = Depends(_require_auth)) -> Any:
    _require_csrf(request, session)
    return await _proxy_to_remnawave(request, "api/hosts", profile_id)


@api.put("/remnawave/hosts/{host_id}")
@api.patch("/remnawave/hosts/{host_id}")
async def remnawave_update_host(host_id: str, request: Request, profile_id: Optional[str] = None, session: Dict[str, Any] = Depends(_require_auth)) -> Any:
    _require_csrf(request, session)
    # В актуальной API доке PATCH идет на /api/hosts (без /{uuid}), а uuid передается в body.
    # Чтобы не ломать фронт (который вызывает /remnawave/hosts/{host_id}), переписываем запрос:
    # - ходим в upstream api/hosts
    # - гарантируем наличие поля uuid в JSON body (если body пустой/без uuid)
    try:
        raw_body = await request.body()
        payload: Any = {}
        if raw_body:
            try:
                payload = json.loads(raw_body.decode("utf-8"))
            except Exception:
                payload = {}

        if not isinstance(payload, dict):
            payload = {}

        # если uuid/id не задан, добавляем uuid из path-параметра
        if "uuid" not in payload and "id" not in payload:
            payload["uuid"] = host_id

        # Проксируем в upstream /api/hosts тем же методом, что пришёл (PATCH/PUT)
        upstream_path = "api/hosts"

        # Создаем новый Request с подмененным body нельзя просто так, поэтому делаем прямой httpx запрос,
        # используя настройки профиля remnawave аналогично _proxy_to_remnawave.
        profiles = _load_remnawave_profiles()
        base_url = ""
        token = ""

        if profile_id:
            for p in profiles:
                if profile_id in (p.get("botProfileIds") or []):
                    settings = p.get("settings") or {}
                    base_url = settings.get("base_url", "").strip()
                    token = settings.get("token", "").strip()
                    break
        else:
            try:
                _, bot_profile = _get_active_bot_profile()
                bot_profile_id = bot_profile.get("id")
                if bot_profile_id:
                    for p in profiles:
                        if bot_profile_id in (p.get("botProfileIds") or []):
                            settings = p.get("settings") or {}
                            base_url = settings.get("base_url", "").strip()
                            token = settings.get("token", "").strip()
                            break
            except Exception:
                pass

        if not base_url:
            raise HTTPException(status_code=400, detail="Remnawave не настроен для этого профиля")

        url = base_url.rstrip("/") + "/" + upstream_path.lstrip("/")
        params = dict(request.query_params)
        params.pop("profile_id", None)

        headers: Dict[str, str] = {"Accept": "application/json", "Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        method = request.method.upper()
        body_bytes = json.dumps(payload).encode("utf-8")

        logger.debug("[PROXY][rewrite] %s %s params=%s body_len=%s", method, url, params, len(body_bytes))
        timeout = httpx.Timeout(connect=10.0, read=30.0, write=30.0, pool=10.0)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            try:
                upstream = await client.request(method, url, params=params, content=body_bytes, headers=headers)
                logger.debug("[PROXY][rewrite] response %s %s", upstream.status_code, upstream.reason_phrase)
                if upstream.status_code >= 400:
                    try:
                        logger.warning("[PROXY][rewrite] error response: %s", upstream.text[:500])
                    except Exception:
                        logger.warning("[PROXY][rewrite] error response (raw): %s", upstream.content[:500])
            except httpx.RequestError as e:
                logger.warning("[PROXY][rewrite] request error: %s", e)
                raise HTTPException(status_code=502, detail=f"Remnawave API недоступен: {e.__class__.__name__}")

        content_type = upstream.headers.get("content-type", "")
        if "application/json" in content_type:
            try:
                return JSONResponse(status_code=upstream.status_code, content=upstream.json())
            except Exception:
                return Response(status_code=upstream.status_code, content=upstream.content, media_type=content_type)
        return Response(status_code=upstream.status_code, content=upstream.content, media_type=content_type or None)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("remnawave host update error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Ошибка обработки запроса обновления хоста")


@api.delete("/remnawave/hosts/{host_id}")
async def remnawave_delete_host(host_id: str, request: Request, profile_id: Optional[str] = None, session: Dict[str, Any] = Depends(_require_auth)) -> Any:
    _require_csrf(request, session)
    return await _proxy_to_remnawave(request, f"api/hosts/{host_id}", profile_id)


@api.get("/remnawave/hosts/tags")
async def remnawave_host_tags(request: Request, profile_id: Optional[str] = None, _session: Dict[str, Any] = Depends(_require_auth)) -> Any:
    # Согласно API: GET /api/hosts/tags
    return await _proxy_to_remnawave(request, "api/hosts/tags", profile_id)


@api.post("/remnawave/hosts/actions/reorder")
async def remnawave_hosts_reorder(request: Request, profile_id: Optional[str] = None, session: Dict[str, Any] = Depends(_require_auth)) -> Any:
    # Согласно API: POST /api/hosts/actions/reorder
    _require_csrf(request, session)
    return await _proxy_to_remnawave(request, "api/hosts/actions/reorder", profile_id)


@api.get("/remnawave/inbounds/")
async def remnawave_inbounds(request: Request, profile_id: Optional[str] = None, _session: Dict[str, Any] = Depends(_require_auth)) -> Any:
    # В актуальной версии Remnawave список инбаундов лежит здесь:
    # GET /api/config-profiles/inbounds
    return await _proxy_to_remnawave(request, "api/config-profiles/inbounds", profile_id)

#
# Remnawave Users API
#
@api.get("/remnawave/users/")
async def remnawave_users(request: Request, profile_id: Optional[str] = None, _session: Dict[str, Any] = Depends(_require_auth)) -> Any:
    # GET /api/users?start=&size=
    return await _proxy_to_remnawave(request, "api/users", profile_id)


@api.post("/remnawave/users/")
async def remnawave_create_user(request: Request, profile_id: Optional[str] = None, session: Dict[str, Any] = Depends(_require_auth)) -> Any:
    _require_csrf(request, session)
    return await _proxy_to_remnawave(request, "api/users", profile_id)


@api.patch("/remnawave/users/")
async def remnawave_update_user(request: Request, profile_id: Optional[str] = None, session: Dict[str, Any] = Depends(_require_auth)) -> Any:
    _require_csrf(request, session)
    return await _proxy_to_remnawave(request, "api/users", profile_id)


@api.get("/remnawave/users/{user_uuid}")
async def remnawave_user(user_uuid: str, request: Request, profile_id: Optional[str] = None, _session: Dict[str, Any] = Depends(_require_auth)) -> Any:
    return await _proxy_to_remnawave(request, f"api/users/{user_uuid}", profile_id)


@api.delete("/remnawave/users/{user_uuid}")
async def remnawave_delete_user(user_uuid: str, request: Request, profile_id: Optional[str] = None, session: Dict[str, Any] = Depends(_require_auth)) -> Any:
    _require_csrf(request, session)
    return await _proxy_to_remnawave(request, f"api/users/{user_uuid}", profile_id)


@api.get("/remnawave/users/by-username/{username}")
async def remnawave_user_by_username(username: str, request: Request, profile_id: Optional[str] = None, _session: Dict[str, Any] = Depends(_require_auth)) -> Any:
    return await _proxy_to_remnawave(request, f"api/users/by-username/{username}", profile_id)


@api.get("/remnawave/users/by-short-uuid/{short_uuid}")
async def remnawave_user_by_short_uuid(short_uuid: str, request: Request, profile_id: Optional[str] = None, _session: Dict[str, Any] = Depends(_require_auth)) -> Any:
    return await _proxy_to_remnawave(request, f"api/users/by-short-uuid/{short_uuid}", profile_id)


@api.get("/remnawave/users/by-subscription-uuid/{subscription_uuid}")
async def remnawave_user_by_subscription_uuid(subscription_uuid: str, request: Request, profile_id: Optional[str] = None, _session: Dict[str, Any] = Depends(_require_auth)) -> Any:
    return await _proxy_to_remnawave(request, f"api/users/by-subscription-uuid/{subscription_uuid}", profile_id)


@api.get("/remnawave/users/by-telegram-id/{telegram_id}")
async def remnawave_user_by_telegram_id(telegram_id: str, request: Request, profile_id: Optional[str] = None, _session: Dict[str, Any] = Depends(_require_auth)) -> Any:
    return await _proxy_to_remnawave(request, f"api/users/by-telegram-id/{telegram_id}", profile_id)


@api.get("/remnawave/users/by-email/{email}")
async def remnawave_user_by_email(email: str, request: Request, profile_id: Optional[str] = None, _session: Dict[str, Any] = Depends(_require_auth)) -> Any:
    return await _proxy_to_remnawave(request, f"api/users/by-email/{email}", profile_id)


class RemnawaveBulkLookupRequest(BaseModel):
    identifiers: List[str] = Field(max_length=500)


@api.post("/remnawave/users/bulk-lookup")
async def remnawave_users_bulk_lookup(
    request: Request,
    payload: RemnawaveBulkLookupRequest,
    profile_id: Optional[str] = None,
    force: bool = False,
    session: Dict[str, Any] = Depends(_require_auth),
) -> Dict[str, Any]:
    """
    Bulk lookup users in Remnawave for the subscriptions table.
    Returns: {"items": { ident: user|null, ... }}
    """
    _require_csrf(request, session)
    cache_profile_key, base_url, token = _get_remnawave_credentials(profile_id)

    identifiers = [str(x or "").strip() for x in (payload.identifiers or [])]
    identifiers = [x for x in identifiers if x]
    # Deduplicate while preserving order
    seen = set()
    identifiers = [x for x in identifiers if not (x in seen or seen.add(x))]

    out: Dict[str, Any] = {}
    to_fetch: List[str] = []
    for ident in identifiers:
        ck = (cache_profile_key, ident)
        if not force:
            cached = _rmw_cache_get(ck)
            if cached is not None:
                out[ident] = cached
                continue
        to_fetch.append(ident)

    if not to_fetch:
        return {"items": out}

    headers: Dict[str, str] = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    timeout = httpx.Timeout(connect=7.0, read=20.0, write=20.0, pool=7.0)
    limits = httpx.Limits(max_connections=120, max_keepalive_connections=40)
    sem = asyncio.Semaphore(60)

    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, headers=headers, limits=limits) as client:
        async def _get_json(path: str) -> Tuple[int, Any]:
            url = base_url.rstrip("/") + "/" + path.lstrip("/")
            async with sem:
                resp = await client.get(url)
                if resp.status_code == 404:
                    return 404, None
                if resp.status_code >= 400:
                    return resp.status_code, None
                try:
                    return resp.status_code, resp.json()
                except Exception:
                    return resp.status_code, None

        async def _lookup_one(ident: str) -> Tuple[str, Any]:
            # Heuristics:
            # - email contains '@' -> by-email
            # - otherwise treat as short_uuid first, then fallback to username
            enc = urllib.parse.quote(ident, safe="")
            if "@" in ident:
                code, data = await _get_json(f"api/users/by-email/{enc}")
                if code == 404:
                    return ident, None
                return ident, data

            code, data = await _get_json(f"api/users/by-short-uuid/{enc}")
            if code == 404:
                code2, data2 = await _get_json(f"api/users/by-username/{enc}")
                if code2 == 404:
                    return ident, None
                return ident, data2
            return ident, data

        results = await asyncio.gather(*[_lookup_one(x) for x in to_fetch], return_exceptions=True)
        for r in results:
            if isinstance(r, Exception):
                continue
            ident, data = r
            out[ident] = data
            _rmw_cache_set((cache_profile_key, ident), data)

    return {"items": out}


@api.get("/remnawave/users/by-tag/{tag}")
async def remnawave_users_by_tag(tag: str, request: Request, profile_id: Optional[str] = None, _session: Dict[str, Any] = Depends(_require_auth)) -> Any:
    return await _proxy_to_remnawave(request, f"api/users/by-tag/{tag}", profile_id)


@api.get("/remnawave/users/tags")
async def remnawave_users_tags(request: Request, profile_id: Optional[str] = None, _session: Dict[str, Any] = Depends(_require_auth)) -> Any:
    return await _proxy_to_remnawave(request, "api/users/tags", profile_id)


@api.post("/remnawave/users/{user_uuid}/actions/disable")
async def remnawave_user_disable(user_uuid: str, request: Request, profile_id: Optional[str] = None, session: Dict[str, Any] = Depends(_require_auth)) -> Any:
    _require_csrf(request, session)
    return await _proxy_to_remnawave(request, f"api/users/{user_uuid}/actions/disable", profile_id)


@api.post("/remnawave/users/{user_uuid}/actions/enable")
async def remnawave_user_enable(user_uuid: str, request: Request, profile_id: Optional[str] = None, session: Dict[str, Any] = Depends(_require_auth)) -> Any:
    _require_csrf(request, session)
    return await _proxy_to_remnawave(request, f"api/users/{user_uuid}/actions/enable", profile_id)


@api.post("/remnawave/users/{user_uuid}/actions/reset-traffic")
async def remnawave_user_reset_traffic(user_uuid: str, request: Request, profile_id: Optional[str] = None, session: Dict[str, Any] = Depends(_require_auth)) -> Any:
    _require_csrf(request, session)
    return await _proxy_to_remnawave(request, f"api/users/{user_uuid}/actions/reset-traffic", profile_id)


@api.post("/remnawave/users/{user_uuid}/actions/activate-all-inbounds")
async def remnawave_user_activate_all_inbounds(user_uuid: str, request: Request, profile_id: Optional[str] = None, session: Dict[str, Any] = Depends(_require_auth)) -> Any:
    _require_csrf(request, session)
    return await _proxy_to_remnawave(request, f"api/users/{user_uuid}/actions/activate-all-inbounds", profile_id)


@api.post("/remnawave/users/{user_uuid}/actions/revoke")
async def remnawave_user_revoke(user_uuid: str, request: Request, profile_id: Optional[str] = None, session: Dict[str, Any] = Depends(_require_auth)) -> Any:
    _require_csrf(request, session)
    return await _proxy_to_remnawave(request, f"api/users/{user_uuid}/actions/revoke", profile_id)


@api.get("/remnawave/online-history/")
async def remnawave_online_history(
    period: str = "24h",
    profile_id: Optional[str] = None,
    _session: Dict[str, Any] = Depends(_require_auth)
) -> Dict[str, Any]:
    """Получение истории онлайна пользователей Remnawave"""
    # Определяем временной диапазон
    now = int(time.time() * 1000)  # миллисекунды
    period_ms = {
        "24h": 24 * 60 * 60 * 1000,
        "week": 7 * 24 * 60 * 60 * 1000,
        "14days": 14 * 24 * 60 * 60 * 1000,
        "month": 30 * 24 * 60 * 60 * 1000,
        "year": 365 * 24 * 60 * 60 * 1000,
    }.get(period, 24 * 60 * 60 * 1000)
    
    cutoff_time = now - period_ms
    
    # Загружаем историю (кешируем большие файлы дольше)
    history_data = _cached_read_json(REMNAWAVE_ONLINE_HISTORY_FILE, {}, ttl_seconds=300)  # 5 минут кеша
    
    # Определяем profile_id для фильтрации
    target_profile_id = profile_id
    if not target_profile_id:
        # Если profile_id не указан, используем активный профиль
        try:
            _, bot_profile = _get_active_bot_profile()
            target_profile_id = bot_profile.get("id")
        except:
            target_profile_id = None
    
    # Преобразуем в массив и фильтруем по времени
    history_list = []
    
    # Если это массив (новый формат: [{timestamp, count, profile_id}, ...])
    if isinstance(history_data, list):
        for item in history_data:
            if isinstance(item, dict):
                timestamp = item.get("timestamp")
                count = item.get("count")
                profile_id_item = item.get("profile_id")
                
                # Фильтруем по profile_id если указан
                if target_profile_id:
                    if not profile_id_item or str(profile_id_item) != str(target_profile_id):
                        continue
                
                if timestamp and count is not None:
                    try:
                        ts = int(timestamp)
                        if ts >= cutoff_time:
                            history_list.append({"timestamp": ts, "count": int(count)})
                    except (ValueError, TypeError):
                        continue
    
    # Если это словарь (старый формат: {profile_id: {timestamp: count}} или {timestamp: count})
    elif isinstance(history_data, dict):
        # Проверяем, есть ли ключи вида "profile_*"
        has_profile_keys = any(k.startswith("profile_") for k in history_data.keys())
        
        if has_profile_keys and target_profile_id:
            # Формат: {profile_id: {timestamp: count}}
            profile_key = f"profile_{target_profile_id}"
            profile_data = history_data.get(profile_key, {})
            if isinstance(profile_data, dict):
                for timestamp_str, count in profile_data.items():
                    try:
                        timestamp = int(timestamp_str)
                        if timestamp >= cutoff_time:
                            history_list.append({"timestamp": timestamp, "count": int(count)})
                    except (ValueError, TypeError):
                        continue
        else:
            # Формат: {timestamp: count} - прямой словарь
            for timestamp_str, count in history_data.items():
                try:
                    timestamp = int(timestamp_str)
                    if timestamp >= cutoff_time:
                        history_list.append({"timestamp": timestamp, "count": int(count)})
                except (ValueError, TypeError):
                    continue
    
    # Сортируем по времени
    history_list.sort(key=lambda x: x["timestamp"])

    # Downsample large payloads to keep the chart smooth on weak clients.
    max_points = 1400 if period == "week" else 1000 if period == "24h" else 1800
    if len(history_list) > max_points and max_points > 0:
        step = max(1, len(history_list) // max_points)
        sampled = history_list[::step]
        # Keep the latest point for up-to-date value in tooltip.
        if sampled and sampled[-1]["timestamp"] != history_list[-1]["timestamp"]:
            sampled.append(history_list[-1])
        history_list = sampled

    return {"history": history_list}


# -----------------------
# Remnawave v2 wildcard proxy
# Proxies all /remnawave/v2/* requests to remnawave /api/v2/*
# -----------------------

@api.api_route("/remnawave/rw/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def remnawave_rw_proxy(
    path: str,
    request: Request,
    profile_id: Optional[str] = None,
    _session: Dict[str, Any] = Depends(_require_auth),
) -> Any:
    if request.method.upper() in {"POST", "PATCH", "PUT", "DELETE"}:
        _require_csrf(request, _session)
    return await _proxy_to_remnawave(request, f"api/{path}", profile_id)


# -----------------------
# System Logs
# -----------------------
_SYSTEM_LOG_FILES = {
    "app": DATA_DIR / "logs" / "app.log",
    "access": DATA_DIR / "logs" / "access.log",
}
_SYSTEM_LOG_LINES_MAX = 2000


def _tail_file(path: Path, lines: int) -> list[str]:
    """Read last N lines of a text file efficiently."""
    lines = max(1, min(lines, _SYSTEM_LOG_LINES_MAX))
    try:
        size = path.stat().st_size
    except OSError:
        return []
    if size == 0:
        return []
    # Read up to 200 bytes per line heuristically
    chunk = min(size, lines * 200)
    result: list[str] = []
    with open(path, "rb") as f:
        pos = max(0, size - chunk)
        while len(result) < lines and pos >= 0:
            f.seek(pos)
            data = f.read(size - pos)
            decoded = data.decode("utf-8", errors="replace")
            all_lines = decoded.splitlines()
            result = all_lines[-lines:] if len(all_lines) >= lines else all_lines
            if len(result) >= lines or pos == 0:
                break
            # Need more data
            chunk = min(size, chunk * 2)
            pos = max(0, size - chunk)
    return result[-lines:]


@api.get("/system-logs/files")
def system_logs_files(_session: Dict[str, Any] = Depends(_require_owner)) -> Dict[str, Any]:
    """List available log files with sizes."""
    files = []
    # Panel log files
    for name, path in _SYSTEM_LOG_FILES.items():
        try:
            size = path.stat().st_size
            exists = True
        except OSError:
            size = 0
            exists = False
        files.append({"name": name, "path": str(path), "size": size, "exists": exists})
    # Docker container logs via journald (best-effort)
    return {"ok": True, "files": files}


@api.get("/system-logs/read")
def system_logs_read(
    name: str = "app",
    lines: int = 200,
    _session: Dict[str, Any] = Depends(_require_owner),
) -> Dict[str, Any]:
    """Read last N lines from a log file."""
    lines = max(1, min(int(lines or 200), _SYSTEM_LOG_LINES_MAX))
    path = _SYSTEM_LOG_FILES.get(str(name or "").strip())
    if not path:
        raise HTTPException(status_code=400, detail=f"Unknown log: {name}")
    if not path.exists():
        return {"ok": True, "lines": [], "size": 0, "name": name}
    log_lines = _tail_file(path, lines)
    try:
        size = path.stat().st_size
    except OSError:
        size = 0
    return {"ok": True, "lines": log_lines, "size": size, "name": name}


@api.get("/system-logs/docker")
async def system_logs_docker(
    service: str = "adminpanel",
    lines: int = 200,
    _session: Dict[str, Any] = Depends(_require_owner),
) -> Dict[str, Any]:
    """Stream last N lines from a Docker container via docker logs."""
    lines = max(1, min(int(lines or 200), _SYSTEM_LOG_LINES_MAX))
    # Whitelist container names to prevent injection
    allowed = re.match(r'^[a-zA-Z0-9_.-]+$', str(service or ""))
    if not allowed:
        raise HTTPException(status_code=400, detail="Invalid service name")
    try:
        proc = await asyncio.create_subprocess_exec(
            "docker", "logs", "--tail", str(lines), "--timestamps", str(service),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
        text = stdout.decode("utf-8", errors="replace") if stdout else ""
        log_lines = text.splitlines()[-lines:]
        return {"ok": True, "lines": log_lines, "service": service}
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="docker logs timed out")
    except FileNotFoundError:
        raise HTTPException(status_code=503, detail="docker not available")
    except Exception as e:
        logger.error("docker logs error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Ошибка чтения логов")


# -----------------------
# Nodes (Fleet) CRUD
# -----------------------

@api.get("/nodes")
def nodes_list(_session: Dict[str, Any] = Depends(_require_owner)) -> Dict[str, Any]:
    """Вернуть все записи агентов (токен + метрики) без привязки к именам нод."""
    nodes = list_nodes(NODES_DB_FILE)
    online = _agent_manager.connected_nodes()
    for n in nodes:
        n["online"] = n["uuid"] in online
    return {"ok": True, "nodes": nodes}


@api.get("/nodes/{node_uuid}/agent-token")
async def nodes_agent_token_status(node_uuid: str, _session: Dict[str, Any] = Depends(_require_owner)) -> Dict[str, Any]:
    """Статус токена агента для ноды (маскированный)."""
    node = get_node(NODES_DB_FILE, node_uuid)
    token = (node or {}).get("agent_token", "")
    has_token = bool(token)
    masked = ""
    if has_token and len(token) > 12:
        masked = token[:8] + "..." + token[-4:]
    elif has_token:
        masked = token[:4] + "..."
    return {"ok": True, "has_token": has_token, "masked_token": masked}


@api.post("/nodes/{node_uuid}/agent-token/generate")
async def nodes_agent_token_generate(node_uuid: str, request: Request, session: Dict[str, Any] = Depends(_require_owner)) -> Dict[str, Any]:
    """Сгенерировать/перегенерировать токен агента. Возвращает полный токен один раз."""
    _require_csrf(request, session)
    token = regenerate_token(NODES_DB_FILE, node_uuid)
    panel_append_audit(NODES_DB_FILE, actor=session.get("username", "?"),
                       action="node.agent_token.generate", target_id=node_uuid)
    return {"ok": True, "token": token}


@api.post("/nodes/{node_uuid}/agent-token/revoke")
async def nodes_agent_token_revoke(node_uuid: str, request: Request, session: Dict[str, Any] = Depends(_require_owner)) -> Dict[str, Any]:
    """Отозвать токен агента."""
    _require_csrf(request, session)
    revoke_token(NODES_DB_FILE, node_uuid)
    panel_append_audit(NODES_DB_FILE, actor=session.get("username", "?"),
                       action="node.agent_token.revoke", target_id=node_uuid)
    return {"ok": True}


def _get_panel_url(request: Request) -> str:
    """Determine public panel URL: origin header > x-forwarded-host > base_url."""
    origin = request.headers.get("origin", "")
    if origin:
        return origin.rstrip("/")
    forwarded_proto = request.headers.get("x-forwarded-proto", "")
    forwarded_host = request.headers.get("x-forwarded-host", "") or request.headers.get("host", "")
    if forwarded_proto and forwarded_host:
        return f"{forwarded_proto}://{forwarded_host}"
    return str(request.base_url).rstrip("/")


@api.post("/nodes/{node_uuid}/agent-install")
async def nodes_agent_install(node_uuid: str, request: Request, session: Dict[str, Any] = Depends(_require_owner)) -> Dict[str, Any]:
    """Вернуть команду установки. Автоматически генерирует токен если не существует."""
    _require_csrf(request, session)
    node = get_node(NODES_DB_FILE, node_uuid)
    token = (node or {}).get("agent_token", "")
    if not token:
        token = regenerate_token(NODES_DB_FILE, node_uuid)
    panel_url = _get_panel_url(request)
    ws_secret = _AGENT_SECRET_KEY or ""
    script_url = f"{panel_url}/webpanel/node-agent/install.sh"
    cmd = (
        f"bash <(curl -sSL {script_url})"
        f" --uuid {node_uuid}"
        f" --url {panel_url}"
        f" --token {token}"
    )
    if ws_secret:
        cmd += f" --ws-secret {ws_secret}"
    else:
        cmd += " --no-command"
    return {
        "ok": True,
        "install_command": cmd,
        "token": token,
        "node_uuid": node_uuid,
        "collector_url": panel_url,
    }


@api.get("/nodes/{node_uuid}/install-command")
async def nodes_install_command(node_uuid: str, request: Request, _session: Dict[str, Any] = Depends(_require_owner)) -> Dict[str, Any]:
    """Legacy endpoint."""
    node = get_node(NODES_DB_FILE, node_uuid)
    token = (node or {}).get("agent_token", "")
    panel_url = _get_panel_url(request)
    ws_secret = _AGENT_SECRET_KEY or ""
    cmd = f"bash <(curl -sSL {panel_url}/webpanel/node-agent/install.sh) --uuid {node_uuid} --url {panel_url} --token {token}"
    if ws_secret:
        cmd += f" --ws-secret {ws_secret}"
    return {"ok": True, "command": cmd, "uuid": node_uuid, "token": token, "panel_url": panel_url}


# -----------------------
# Collector API (called by node agents)
# -----------------------

@api.post("/collector/batch")
async def collector_batch(request: Request) -> Dict[str, Any]:
    """Receive connection batch + metrics from node agent."""
    # Auth: Bearer token
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = auth[7:].strip()
    node = get_node_by_token(NODES_DB_FILE, token)
    if not node:
        raise HTTPException(status_code=403, detail="Unknown node token")

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    metrics = payload.get("system_metrics")
    connections = payload.get("connections") or []
    node_update_heartbeat(NODES_DB_FILE, node["uuid"], metrics)
    if connections:
        node_increment_connections(NODES_DB_FILE, node["uuid"], len(connections))
        # Store connection history + run violation detection in background
        try:
            vio_add_connections(VIOLATIONS_DB_FILE, connections)
            await run_in_threadpool(
                _vio_detector.process_batch,
                VIOLATIONS_DB_FILE, node["uuid"], connections, None,
            )
        except Exception as _vio_err:
            logger.warning("Violation detection error: %s", _vio_err)

    return {"ok": True, "processed": len(connections), "node_uuid": node["uuid"]}


# -----------------------
# Agent WebSocket channel
# -----------------------

@app.websocket("/api/agent/ws")
@app.websocket("/webpanel/api/agent/ws")
async def agent_ws(websocket: WebSocket) -> None:
    """Persistent WebSocket connection from node agent (heartbeat only)."""
    token = websocket.query_params.get("token", "")
    node_uuid = websocket.query_params.get("node_uuid", "")

    node = get_node_by_token(NODES_DB_FILE, token) if token else None
    if not node or node["uuid"] != node_uuid:
        await websocket.close(code=4001, reason="auth_failed")
        return

    await websocket.accept()
    _agent_manager.register(node_uuid, websocket)
    node_update_heartbeat(NODES_DB_FILE, node_uuid)

    try:
        async for raw in websocket.iter_text():
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if msg.get("type") == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
                node_update_heartbeat(NODES_DB_FILE, node_uuid)
    except WebSocketDisconnect:
        pass
    finally:
        _agent_manager.unregister(node_uuid)


# -----------------------
# Violations API
# -----------------------

@api.get("/violations")
def violations_list(
    request: Request,
    days: int = 7, page: int = 1, per_page: int = 20,
    severity: Optional[str] = None, min_score: float = 0,
    resolved: Optional[bool] = None,
    user_email: Optional[str] = None,
    country: Optional[str] = None,
    recommended_action: Optional[str] = None,
    _session: Dict[str, Any] = Depends(_require_owner),
) -> Dict[str, Any]:
    return list_violations(
        VIOLATIONS_DB_FILE, days=days, page=page, per_page=per_page,
        severity=severity, min_score=min_score, resolved=resolved,
        user_email=user_email, country=country,
        recommended_action=recommended_action,
    )


@api.get("/violations/stats")
def violations_stats(
    days: int = 7,
    _session: Dict[str, Any] = Depends(_require_owner),
) -> Dict[str, Any]:
    return get_violations_stats(VIOLATIONS_DB_FILE, days=days)


@api.get("/violations/top-violators")
def violations_top(
    days: int = 7, limit: int = 15,
    _session: Dict[str, Any] = Depends(_require_owner),
) -> List[Dict[str, Any]]:
    return get_top_violators(VIOLATIONS_DB_FILE, days=days, limit=limit)


@api.get("/violations/{vid}")
def violations_detail(
    vid: int,
    _session: Dict[str, Any] = Depends(_require_owner),
) -> Dict[str, Any]:
    v = get_violation(VIOLATIONS_DB_FILE, vid)
    if not v:
        raise HTTPException(status_code=404, detail="Violation not found")
    return v


@api.post("/violations/{vid}/resolve")
async def violations_resolve(
    vid: int, request: Request,
    session: Dict[str, Any] = Depends(_require_owner),
) -> Dict[str, Any]:
    _require_csrf(request, session)
    payload = await request.json()
    action = str((payload or {}).get("action", "ignore"))
    if action not in ("block", "warn", "ignore", "dismissed"):
        raise HTTPException(status_code=400, detail="Invalid action")
    ok = resolve_violation(VIOLATIONS_DB_FILE, vid, action, session.get("username", "?"))
    if not ok:
        raise HTTPException(status_code=404, detail="Violation not found")
    return {"ok": True}


@api.post("/violations/{vid}/annul")
async def violations_annul(
    vid: int, request: Request,
    session: Dict[str, Any] = Depends(_require_owner),
) -> Dict[str, Any]:
    _require_csrf(request, session)
    ok = annul_violation(VIOLATIONS_DB_FILE, vid, session.get("username", "?"))
    if not ok:
        raise HTTPException(status_code=404, detail="Violation not found")
    return {"ok": True}


@api.get("/violations/whitelist/list")
def violations_whitelist_list(
    limit: int = 50, offset: int = 0,
    _session: Dict[str, Any] = Depends(_require_owner),
) -> Dict[str, Any]:
    return list_whitelist(VIOLATIONS_DB_FILE, limit=limit, offset=offset)


@api.post("/violations/whitelist")
async def violations_whitelist_add(
    request: Request,
    session: Dict[str, Any] = Depends(_require_owner),
) -> Dict[str, Any]:
    _require_csrf(request, session)
    payload = await request.json()
    email = str((payload or {}).get("user_email", "")).strip()
    if not email:
        raise HTTPException(status_code=400, detail="user_email required")
    reason = str((payload or {}).get("reason", "") or "")
    ok = add_to_whitelist(VIOLATIONS_DB_FILE, email, reason or None, session.get("username", "?"))
    return {"ok": ok}


@api.delete("/violations/whitelist/{user_email}")
async def violations_whitelist_remove(
    user_email: str, request: Request,
    session: Dict[str, Any] = Depends(_require_owner),
) -> Dict[str, Any]:
    _require_csrf(request, session)
    ok = remove_from_whitelist(VIOLATIONS_DB_FILE, user_email)
    if not ok:
        raise HTTPException(status_code=404, detail="Not in whitelist")
    return {"ok": True}


# -----------------------
# Analytics API (for Remnawave section)
# -----------------------

@api.get("/analytics/violations-trend")
def analytics_violations_trend(
    days: int = 30,
    _session: Dict[str, Any] = Depends(_require_owner),
) -> List[Dict[str, Any]]:
    return get_violations_trend(VIOLATIONS_DB_FILE, days=days)


@api.get("/analytics/connection-stats")
def analytics_connection_stats(
    days: int = 7,
    _session: Dict[str, Any] = Depends(_require_owner),
) -> Dict[str, Any]:
    return get_connection_stats(VIOLATIONS_DB_FILE, days=days)


@api.get("/analytics/node-fleet")
def analytics_node_fleet(
    _session: Dict[str, Any] = Depends(_require_owner),
) -> Dict[str, Any]:
    """Fleet overview for analytics: online/offline/disabled counts + avg metrics."""
    nodes = list_nodes(NODES_DB_FILE)
    online_ids = set(_agent_manager.connected_nodes())
    total = len(nodes)
    online = 0
    offline = 0
    disabled = 0
    fleet_nodes = []
    for n in nodes:
        is_connected = n["uuid"] in online_ids
        is_disabled = not n.get("is_active", True)
        if is_disabled:
            disabled += 1
        elif is_connected:
            online += 1
        else:
            offline += 1
        m = n.get("metrics") or {}
        fleet_nodes.append({
            "uuid": n["uuid"],
            "name": n["name"],
            "address": n.get("address", ""),
            "port": 0,
            "is_connected": is_connected,
            "is_disabled": is_disabled,
            "is_xray_running": bool(m.get("xray_running", False)),
            "xray_version": m.get("xray_version") or None,
            "users_online": 0,
            "traffic_today_bytes": 0,
            "traffic_total_bytes": n.get("connection_count", 0),
            "uptime_seconds": m.get("uptime_seconds") or None,
            "cpu_usage": m.get("cpu_percent") or None,
            "cpu_cores": m.get("cpu_cores") or None,
            "memory_usage": m.get("memory_percent") or None,
            "memory_total_bytes": m.get("memory_total_bytes") or None,
            "memory_used_bytes": m.get("memory_used_bytes") or None,
            "disk_usage": m.get("disk_percent") or None,
            "disk_total_bytes": m.get("disk_total_bytes") or None,
            "disk_used_bytes": m.get("disk_used_bytes") or None,
            "disk_read_speed_bps": m.get("disk_read_speed_bps", 0),
            "disk_write_speed_bps": m.get("disk_write_speed_bps", 0),
            "last_seen_at": str(n["last_seen"]) if n.get("last_seen") else None,
            "download_speed_bps": m.get("net_download_bps", 0),
            "upload_speed_bps": m.get("net_upload_bps", 0),
        })
    return {"nodes": fleet_nodes, "total": total, "online": online, "offline": offline, "disabled": disabled}


# Register API under both /api and /webpanel/api (frontend uses /webpanel/api/*)
app.include_router(api, prefix="/api")
app.include_router(api, prefix="/webpanel/api")

# Serve node-agent install.sh publicly (no auth required — it's a bash script with no secrets)
_NODE_AGENT_DIR = PROJECT_ROOT / "node-agent"

@app.api_route("/webpanel/node-agent/install.sh", methods=["GET", "HEAD"], include_in_schema=False)
def node_agent_install_sh() -> Response:
    sh_path = _NODE_AGENT_DIR / "install.sh"
    if not sh_path.exists():
        raise HTTPException(status_code=404, detail="install.sh not found")
    return FileResponse(str(sh_path), media_type="text/x-sh",
                        headers={"Cache-Control": "no-cache"})


@app.api_route("/webpanel/node-agent/src.tar.gz", methods=["GET", "HEAD"], include_in_schema=False)
def node_agent_src_archive() -> Response:
    """Раздаём архив с исходниками агента."""
    import io, tarfile as _tarfile
    buf = io.BytesIO()
    with _tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for path in (_NODE_AGENT_DIR / "src").rglob("*"):
            if path.is_file():
                tar.add(str(path), arcname=str(path.relative_to(_NODE_AGENT_DIR)))
        req_path = _NODE_AGENT_DIR / "requirements.txt"
        if req_path.exists():
            tar.add(str(req_path), arcname="requirements.txt")
    buf.seek(0)
    return Response(content=buf.read(), media_type="application/gzip",
                    headers={"Cache-Control": "no-cache",
                             "Content-Disposition": "attachment; filename=src.tar.gz"})


# Serve built frontend (Vite dist) under /webpanel/
if FRONTEND_DIST.exists():
    # Важно: редирект /webpanel -> /webpanel/ должен быть зарегистрирован ДО mount StaticFiles,
    # иначе mount перехватывает /webpanel и редирект никогда не срабатывает.
    @app.api_route("/webpanel", methods=["GET", "HEAD"], include_in_schema=False)
    def webpanel_no_slash() -> RedirectResponse:
        return RedirectResponse(url="/webpanel/")

    # Serve SPA + assets with a single handler:
    # - stream files via FileResponse (no manual reads into memory)
    # - never cache index.html (so clients always pick up new asset hashes)
    # - cache fingerprinted Vite assets aggressively
    _STATIC_IMMUTABLE_MAX_AGE = 31536000  # 1 year

    def _no_cache_headers() -> Dict[str, str]:
        return {"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0", "Pragma": "no-cache"}

    def _immutable_headers() -> Dict[str, str]:
        return {"Cache-Control": f"public, max-age={_STATIC_IMMUTABLE_MAX_AGE}, immutable"}

    @app.api_route("/webpanel/", methods=["GET", "HEAD"], include_in_schema=False)
    def webpanel_root() -> Response:
        index_path = FRONTEND_DIST / "index.html"
        if not index_path.exists():
            raise HTTPException(status_code=404, detail="Frontend not found")
        return FileResponse(str(index_path), media_type="text/html", headers=_no_cache_headers())

    @app.api_route("/webpanel/uploads/sender/{file_name:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def webpanel_sender_uploads(file_name: str) -> Response:
        """
        Serve uploaded images for Sender.
        """
        rel = str(file_name or "").lstrip("/").strip()
        if not rel or ".." in rel or rel.startswith("."):
            raise HTTPException(status_code=404, detail="Not Found")
        path = (SENDER_UPLOADS_DIR / rel).resolve()
        if not str(path).startswith(str(SENDER_UPLOADS_DIR.resolve())):
            raise HTTPException(status_code=404, detail="Not Found")
        if not path.exists() or not path.is_file():
            raise HTTPException(status_code=404, detail="Not Found")
        return FileResponse(str(path), headers={"Cache-Control": "public, max-age=31536000, immutable"})

    @app.api_route("/webpanel/{full_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def webpanel_spa(full_path: str, request: Request) -> Response:
        # Exclude API paths and node-agent paths (handled by dedicated routes above)
        if full_path.startswith("api/") or full_path.startswith("node-agent/"):
            raise HTTPException(status_code=404, detail="Not Found")

        # If it's an existing file in dist/ => serve it
        if full_path and "." in full_path:
            static_file = (FRONTEND_DIST / full_path).resolve()
            # Avoid path traversal
            if not str(static_file).startswith(str(FRONTEND_DIST.resolve())):
                raise HTTPException(status_code=404, detail="Not Found")
            if static_file.exists() and static_file.is_file():
                # Vite fingerprinted assets live under /assets/*
                headers = _immutable_headers() if full_path.startswith("assets/") else {"Cache-Control": "public, max-age=86400"}
                return FileResponse(str(static_file), headers=headers)

        # SPA fallback: index.html for everything else
        index_path = FRONTEND_DIST / "index.html"
        if not index_path.exists():
            raise HTTPException(status_code=404, detail="Frontend not found")
        return FileResponse(str(index_path), media_type="text/html", headers=_no_cache_headers())

    def _parse_hosts_env(name: str) -> set[str]:
        raw = str(os.environ.get(name) or "").strip()
        if not raw:
            return set()
        out: set[str] = set()
        for part in raw.split(","):
            h = str(part or "").strip().lower()
            if h:
                out.add(h)
        return out

    def _is_lk_host(request: Request) -> bool:
        # Explicit override first (comma-separated)
        lk_hosts = _parse_hosts_env("ADMINPANEL_LK_HOSTS")
        if lk_hosts:
            host = _lk_extract_request_host(request)
            return host in lk_hosts

        # Otherwise: detect by LK profiles domains
        host = _lk_extract_request_host(request)
        if not host:
            return False
        try:
            return _lk_pick_lk_profile_for_host(host) is not None
        except Exception:
            return False

    def _is_preview_authed(request: Request) -> bool:
        try:
            pv = str(request.query_params.get("preview") or "").strip().lower()
            if pv not in ("1", "true", "yes", "on"):
                return False
            _require_auth_impl(request, cookie_name=COOKIE_NAME, auth_tokens_file=AUTH_TOKENS_FILE)
            return True
        except Exception:
            return False

    # Some reverse proxies use "handle_path /webpanel/*" which strips the "/webpanel" prefix
    # before forwarding requests to this backend. In that case, browser requests like:
    #   /webpanel/assets/index-xxxx.css
    # arrive here as:
    #   /assets/index-xxxx.css
    # We serve /assets/* for BOTH apps:
    # - LK (dist-lk) uses base "/"
    # - Admin (dist) uses base "/webpanel/" but may still need this fallback under handle_path
    @app.api_route("/assets/{asset_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def any_assets_no_prefix(asset_path: str, request: Request) -> Response:
        rel = str(asset_path or "").lstrip("/").strip()
        if not rel or ".." in rel or rel.startswith("."):
            raise HTTPException(status_code=404, detail="Not Found")

        base = FRONTEND_LK_DIST if (FRONTEND_LK_DIST.exists() and _is_lk_host(request)) else FRONTEND_DIST
        static_file = (base / "assets" / rel).resolve()
        base_assets = (base / "assets").resolve()
        if not str(static_file).startswith(str(base_assets)):
            raise HTTPException(status_code=404, detail="Not Found")
        if not static_file.exists() or not static_file.is_file():
            raise HTTPException(status_code=404, detail="Not Found")
        return FileResponse(str(static_file), headers=_immutable_headers())

    # LK preview assets for iframe preview (admin-auth only).
    # In preview mode we rewrite LK index.html to point to /lk-preview-assets/* instead of /assets/*,
    # so it works even on non-LK hosts/domains.
    @app.api_route("/lk-preview-assets/{asset_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def lk_preview_assets(asset_path: str, _session: Dict[str, Any] = Depends(_require_auth)) -> Response:
        rel = str(asset_path or "").lstrip("/").strip()
        if not rel or ".." in rel or rel.startswith("."):
            raise HTTPException(status_code=404, detail="Not Found")
        base_assets = (FRONTEND_LK_DIST / "assets").resolve()
        static_file = (base_assets / rel).resolve()
        if not str(static_file).startswith(str(base_assets)):
            raise HTTPException(status_code=404, detail="Not Found")
        if not static_file.exists() or not static_file.is_file():
            raise HTTPException(status_code=404, detail="Not Found")
        return FileResponse(str(static_file), headers=_immutable_headers())

    # Root handler:
    # - on LK domains => serve LK SPA (if built)
    # - otherwise => redirect to /webpanel/
    @app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
    def root(request: Request) -> Response:
        root_mode = str(os.environ.get("ADMINPANEL_ROOT_MODE") or "").strip().lower()
        serve_lk = False
        if root_mode in ("lk", "lk_only", "cabinet"):
            serve_lk = True
        elif FRONTEND_LK_DIST.exists() and _is_lk_host(request):
            serve_lk = True
        elif FRONTEND_LK_DIST.exists() and _is_preview_authed(request):
            serve_lk = True

        if serve_lk and FRONTEND_LK_DIST.exists():
            index_path = FRONTEND_LK_DIST / "index.html"
            if not index_path.exists():
                raise HTTPException(status_code=404, detail="LK frontend not found")
            # Preview: rewrite /assets/* -> /lk-preview-assets/*
            if _is_preview_authed(request):
                try:
                    html = index_path.read_text(encoding="utf-8", errors="ignore")
                    html = html.replace('"/assets/', '"/lk-preview-assets/')
                    return Response(content=html, media_type="text/html", headers=_no_cache_headers())
                except Exception:
                    pass
            return FileResponse(str(index_path), media_type="text/html", headers=_no_cache_headers())

        return RedirectResponse(url="/webpanel/")

    # LK SPA + assets on "/" (for LK domains).
    @app.api_route("/{full_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def lk_spa(full_path: str, request: Request) -> Response:
        # Do not shadow webpanel/api routes
        if full_path.startswith("webpanel") or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")

        if not (FRONTEND_LK_DIST.exists() and (_is_lk_host(request) or _is_preview_authed(request))):
            return RedirectResponse(url="/webpanel/")

        # If it's an existing file in LK dist => serve it
        if full_path and "." in full_path:
            static_file = (FRONTEND_LK_DIST / full_path).resolve()
            if not str(static_file).startswith(str(FRONTEND_LK_DIST.resolve())):
                raise HTTPException(status_code=404, detail="Not Found")
            if static_file.exists() and static_file.is_file():
                headers = _immutable_headers() if full_path.startswith("assets/") else {"Cache-Control": "public, max-age=86400"}
                return FileResponse(str(static_file), headers=headers)

        # SPA fallback: LK index.html
        index_path = FRONTEND_LK_DIST / "index.html"
        if not index_path.exists():
            raise HTTPException(status_code=404, detail="LK frontend not found")
        # Preview: rewrite /assets/* -> /lk-preview-assets/*
        if _is_preview_authed(request):
            try:
                html = index_path.read_text(encoding="utf-8", errors="ignore")
                html = html.replace('"/assets/', '"/lk-preview-assets/')
                return Response(content=html, media_type="text/html", headers=_no_cache_headers())
            except Exception:
                pass
        return FileResponse(str(index_path), media_type="text/html", headers=_no_cache_headers())


@app.get("/favicon.ico")
def favicon() -> Response:
    # Optional: avoid noisy 404s
    return Response(status_code=204)


# Мониторинг узлов Remnawave
# ---------------------------

def _get_node_state_key(profile_id: str, node_id: str) -> str:
    """Генерация ключа для состояния узла"""
    return f"{profile_id}:{node_id}"


async def _check_nodes_status(profile_id: str, base_url: str, token: str) -> Dict[str, Any]:
    """Проверка состояния узлов через Remnawave API"""
    try:
        import time
        start_time = time.time()
        url = base_url.rstrip("/") + "/api/nodes"
        headers = {"Accept": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        
        timeout = httpx.Timeout(connect=10.0, read=30.0, write=30.0, pool=10.0)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            response = await client.get(url, headers=headers)
            response_time = int((time.time() - start_time) * 1000)
            if response.status_code == 200:
                nodes = response.json()
                logger.debug("[MONITORING] profile=%s response type=%s", profile_id, type(nodes))
                if isinstance(nodes, list):
                    logger.debug("[MONITORING] profile=%s nodes=%s (list)", profile_id, len(nodes))
                    return {"nodes": nodes, "error": None, "responseTime": response_time}
                # Возможно, ответ в формате {"nodes": [...]} или {"data": [...]}
                if isinstance(nodes, dict):
                    logger.debug("[MONITORING] profile=%s keys=%s", profile_id, list(nodes.keys()))
                    if "nodes" in nodes:
                        node_list = nodes["nodes"]
                        if isinstance(node_list, list):
                            logger.debug("[MONITORING] profile=%s nodes=%s (field=nodes)", profile_id, len(node_list))
                            return {"nodes": node_list, "error": None, "responseTime": response_time}
                    if "data" in nodes:
                        node_list = nodes["data"]
                        if isinstance(node_list, list):
                            logger.debug("[MONITORING] profile=%s nodes=%s (field=data)", profile_id, len(node_list))
                            return {"nodes": node_list, "error": None, "responseTime": response_time}
                    # Возможно, узлы находятся в другом поле или структура другая
                    # Попробуем найти любой список в словаре
                    for key, value in nodes.items():
                        if isinstance(value, list) and len(value) > 0:
                            # Проверяем, похоже ли это на список узлов (есть поле id или name)
                            if isinstance(value[0], dict) and ("id" in value[0] or "name" in value[0]):
                                logger.debug("[MONITORING] profile=%s nodes=%s (field=%s)", profile_id, len(value), key)
                                return {"nodes": value, "error": None, "responseTime": response_time}
                return {"nodes": [], "error": f"Invalid response format: {type(nodes)}", "responseTime": response_time}
            logger.warning("[MONITORING] profile=%s http=%s", profile_id, response.status_code)
            return {"nodes": [], "error": f"HTTP {response.status_code}", "responseTime": response_time}
    except Exception as e:
        # Some exceptions (notably TimeoutError / httpx timeouts) can stringify to empty string,
        # which makes monitoring_state look "healthy" even though the check failed.
        msg = str(e).strip()
        err = msg or type(e).__name__
        logger.warning("[MONITORING] profile=%s exception=%s", profile_id, err)
        return {"nodes": [], "error": err, "responseTime": None}


def _get_node_status(node: Dict[str, Any]) -> str:
    """Определение статуса узла (online/offline)"""
    # Проверяем isDisabled - если узел отключен, он считается offline
    is_disabled = node.get("isDisabled", False)
    if is_disabled:
        return "offline"
    
    # Основное поле для определения статуса - isConnected
    is_connected = node.get("isConnected")
    if is_connected is True:
        return "online"
    if is_connected is False:
        return "offline"
    
    # Проверяем различные поля, которые могут указывать на статус (case-insensitive)
    status = node.get("status")
    if status:
        status_lower = str(status).lower()
        if status_lower == "online":
            return "online"
        if status_lower == "offline":
            return "offline"
    
    # Проверяем булево поле online
    online = node.get("online")
    if online is True:
        return "online"
    if online is False:
        return "offline"
    
    # Проверяем is_online
    is_online = node.get("is_online")
    if is_online is True:
        return "online"
    if is_online is False:
        return "offline"
    
    # Если нет явного статуса, считаем неизвестным
    return "unknown"


async def _send_telegram_notification(bot_token: str, chat_id: str, message: str, message_thread_id: Optional[int] = None) -> bool:
    """Отправка уведомления в Telegram"""
    try:
        url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        payload = {
            "chat_id": chat_id,
            "text": message,
            "parse_mode": "HTML"
        }
        if message_thread_id is not None:
            payload["message_thread_id"] = message_thread_id
        
        timeout = httpx.Timeout(connect=10.0, read=30.0, write=30.0, pool=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(url, json=payload)
            if response.status_code == 200:
                return True
            else:
                logger.warning("[MONITORING] telegram http=%s chat_id=%s body=%s", response.status_code, chat_id, response.text[:200])
                return False
    except httpx.ConnectError as e:
        logger.warning("[MONITORING] telegram connect error chat_id=%s err=%s", chat_id, e)
        return False
    except httpx.TimeoutException as e:
        logger.warning("[MONITORING] telegram timeout chat_id=%s err=%s", chat_id, e)
        return False
    except Exception as e:
        logger.warning("[MONITORING] telegram send error chat_id=%s err=%s:%s", chat_id, type(e).__name__, e)
        return False


async def _send_notifications_to_recipients(
    message: str,
    recipients: list,
    bot_profile_ids: list,
    log_prefix: str = "Уведомление"
) -> None:
    """Отправка уведомлений всем соответствующим получателям"""
    # Dedupe recipients to avoid double-send when the same target is configured multiple times.
    # Keyed by (mode, botToken, chatId, threadId).
    seen_targets: set[tuple[str, str, str, str]] = set()
    bot_profile_ids_str = [str(x) for x in (bot_profile_ids or []) if str(x)]
    for recipient in recipients:
        if not isinstance(recipient, dict):
            continue
        recipient_profile_ids = recipient.get("botProfileIds", [])
        if not isinstance(recipient_profile_ids, list):
            recipient_profile_ids = []
        recipient_profile_ids_str = [str(x) for x in recipient_profile_ids if str(x)]
        if not any(pid in recipient_profile_ids_str for pid in bot_profile_ids_str):
            continue
        
        mode = str(recipient.get("mode") or "bot")
        bot_token = str(recipient.get("botToken") or "")
        chat_id = str(recipient.get("userId") or "") if mode == "bot" else str(recipient.get("channelId") or "")
        thread_id = recipient.get("threadId")
        
        if not bot_token or not chat_id:
            continue
        
        message_thread_id = None
        thread_key = ""
        if thread_id:
            try:
                message_thread_id = int(thread_id)
                thread_key = str(message_thread_id)
            except:
                pass

        dedupe_key = (mode, bot_token, chat_id, thread_key)
        if dedupe_key in seen_targets:
            continue
        seen_targets.add(dedupe_key)
        
        sent = await _send_telegram_notification(bot_token, chat_id, message, message_thread_id)
        if sent:
            logger.info("[MONITORING] sent %s to %s", log_prefix, chat_id)
        else:
            logger.warning("[MONITORING] failed to send %s to %s", log_prefix.lower(), chat_id)


def _format_notification(template: str, node: Dict[str, Any], is_down: bool, downtime: Optional[str] = None, profile_name: Optional[str] = None) -> str:
    """Форматирование сообщения уведомления"""
    try:
        from zoneinfo import ZoneInfo  # py3.9+
    except Exception:  # pragma: no cover
        ZoneInfo = None  # type: ignore
    
    node_name = node.get("name", node.get("id", "Unknown"))
    node_ip = node.get("ip", node.get("address", "N/A"))
    # Always format timestamps in MSK for notifications (Telegram + in-panel templates).
    try:
        if ZoneInfo:
            current_time = datetime.now(ZoneInfo("Europe/Moscow")).strftime("%d.%m.%Y %H:%M:%S")
        else:
            current_time = (datetime.now(timezone.utc) + timedelta(hours=3)).strftime("%d.%m.%Y %H:%M:%S")
    except Exception:
        current_time = (datetime.now(timezone.utc) + timedelta(hours=3)).strftime("%d.%m.%Y %H:%M:%S")
    
    message = template
    message = message.replace("{name}", str(node_name))
    message = message.replace("{ip}", str(node_ip))
    # Alias for API links / URLs (backward compatible with older templates)
    message = message.replace("{url}", str(node_ip))
    message = message.replace("{time}", current_time)
    
    if downtime:
        message = message.replace("{downtime}", downtime)
    
    if profile_name:
        message = message.replace("{profile}", str(profile_name))
    elif "{profile}" in message:
        message = message.replace("{profile}", "Неизвестно")
    
    error = node.get("error")
    if error and "{error}" in message:
        error_text = f"\n❌ Ошибка: {error}"
        message = message.replace("{error}", error_text)
    elif "{error}" in message:
        message = message.replace("{error}", "")
    
    return message


async def _monitor_nodes_loop():
    return await _monitor_nodes_loop_impl(
        read_json=_read_json,
        write_json=_write_json,
        load_remnawave_profiles=_load_remnawave_profiles,
        check_nodes_status=_check_nodes_status,
        get_node_state_key=_get_node_state_key,
        get_node_status=_get_node_status,
        format_notification=_format_notification,
        send_notifications_to_recipients=_send_notifications_to_recipients,
        monitoring_settings_file=MONITORING_SETTINGS_FILE,
        monitoring_state_file=MONITORING_STATE_FILE,
        bot_profiles_file=BOT_PROFILES_FILE,
        notifications_state_file=NOTIFICATIONS_STATE_FILE,
        decrypt_token=_token_decrypt,
    )


async def _collect_online_history_loop():
    return await _collect_online_history_loop_impl(
        read_json=_read_json,
        load_remnawave_profiles=_load_remnawave_profiles,
        remnawave_get_json=_remnawave_get_json,
        sum_online_from_nodes=_sum_online_from_nodes,
        extract_online_users_count=_extract_online_users_count,
        append_online_history=_append_online_history,
        monitoring_settings_file=MONITORING_SETTINGS_FILE,
    )


async def _session_cleanup_loop():
    return await _session_cleanup_loop_impl(cleanup_expired_sessions=_cleanup_expired_sessions)

@asynccontextmanager
async def _lifespan(app_: FastAPI):
    """
    FastAPI lifespan handler:
    - start background loops on startup (unless disabled)
    - cancel them on shutdown
    """
    tasks: list[asyncio.Task] = []
    try:
        # Ensure persistent data dirs exist (Docker volume friendly)
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            TELEGRAM_SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
            SENDER_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
            LK_SUPPORT_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            logger.warning("[INIT] failed to ensure DATA_DIR: %s", str(e) or type(e).__name__)

        # In tests / CI we must not start infinite background loops.
        if os.getenv("ADMINPANEL_DISABLE_BACKGROUND_LOOPS", "0").lower() in ("1", "true", "yes", "on"):
            logger.info("[MONITORING] background loops disabled by ADMINPANEL_DISABLE_BACKGROUND_LOOPS=1")
            _cleanup_expired_sessions()
            yield
            return

        logger.info("[MONITORING] starting background monitoring tasks...")
        _cleanup_expired_sessions()
        cleanup_expired_blacklist()

        async def _jwt_blacklist_cleanup_loop():
            while True:
                await asyncio.sleep(5 * 60)  # каждые 5 минут
                try:
                    cleanup_expired_blacklist()
                except Exception:
                    pass

        tasks.append(asyncio.create_task(_monitor_nodes_loop()))
        tasks.append(asyncio.create_task(_collect_online_history_loop()))
        tasks.append(asyncio.create_task(_session_cleanup_loop()))
        tasks.append(asyncio.create_task(_jwt_blacklist_cleanup_loop()))
        yield
    finally:
        for t in tasks:
            try:
                t.cancel()
            except Exception:
                pass
        if tasks:
            try:
                await asyncio.gather(*tasks, return_exceptions=True)
            except Exception:
                pass


# attach lifespan after definition (keeps file order mostly unchanged)
app.router.lifespan_context = _lifespan
