"""JWT token generation and verification for admin panel auth."""
import os
import secrets
import time
import sqlite3
import threading
from pathlib import Path
from typing import Any, Dict, Optional

try:
    import jwt as _jwt
    _HAS_JWT = True
except ImportError:
    _HAS_JWT = False

_SECRET: str = os.environ.get("ADMINPANEL_JWT_SECRET", "").strip()
if not _SECRET:
    # No secret in env — generate one and persist to .env so sessions survive restarts.
    _SECRET = secrets.token_urlsafe(48)
    os.environ["ADMINPANEL_JWT_SECRET"] = _SECRET
    # Try to persist to .env file (in /data/ for Docker, or project root for bare-metal)
    for _env_candidate in [
        Path(os.environ.get("ADMINPANEL_DATA_DIR", "")) / ".." / ".env",  # Docker: /data/../.env → /app/.env
        Path("/host-project/.env"),  # Docker: host-mounted project
        Path(__file__).resolve().parent.parent / ".env",  # bare-metal: project root
    ]:
        try:
            _env_path = _env_candidate.resolve()
            if _env_path.parent.is_dir():
                _existing = _env_path.read_text(encoding="utf-8") if _env_path.exists() else ""
                if "ADMINPANEL_JWT_SECRET" not in _existing:
                    with _env_path.open("a", encoding="utf-8") as _f:
                        _f.write(f"\nADMINPANEL_JWT_SECRET={_SECRET}\n")
                    break
        except Exception:
            continue

ALGORITHM = "HS256"
ACCESS_EXP = 8 * 60 * 60    # 8 часов
REFRESH_EXP = 7 * 24 * 60 * 60  # 7 дней
PENDING_2FA_EXP = 5 * 60    # 5 минут

_LOCK = threading.Lock()


# ---------------------------------------------------------------------------
# Token creation
# ---------------------------------------------------------------------------

def create_access_token(user_id: str, username: str, role: str) -> str:
    if not _HAS_JWT:
        raise RuntimeError("PyJWT not installed")
    now = int(time.time())
    payload = {
        "sub": str(user_id or ""),
        "username": str(username or ""),
        "role": str(role or "viewer"),
        "type": "access",
        "jti": secrets.token_hex(16),
        "iat": now,
        "exp": now + ACCESS_EXP,
    }
    return _jwt.encode(payload, _SECRET, algorithm=ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    if not _HAS_JWT:
        raise RuntimeError("PyJWT not installed")
    now = int(time.time())
    payload = {
        "sub": str(user_id or ""),
        "type": "refresh",
        "jti": secrets.token_hex(16),
        "iat": now,
        "exp": now + REFRESH_EXP,
    }
    return _jwt.encode(payload, _SECRET, algorithm=ALGORITHM)


def create_2fa_pending_token(user_id: str, username: str, role: str) -> str:
    """Временный токен после успешного пароля, до верификации TOTP."""
    if not _HAS_JWT:
        raise RuntimeError("PyJWT not installed")
    now = int(time.time())
    payload = {
        "sub": str(user_id or ""),
        "username": str(username or ""),
        "role": str(role or "viewer"),
        "type": "2fa_pending",
        "jti": secrets.token_hex(16),
        "iat": now,
        "exp": now + PENDING_2FA_EXP,
    }
    return _jwt.encode(payload, _SECRET, algorithm=ALGORITHM)


# ---------------------------------------------------------------------------
# Token verification
# ---------------------------------------------------------------------------

def verify_token(token: str, expected_type: str = "access") -> Dict[str, Any]:
    """Верифицировать токен и вернуть payload. Raises ValueError если невалидный."""
    if not _HAS_JWT:
        raise ValueError("PyJWT not installed")
    if not token:
        raise ValueError("No token")
    try:
        payload = _jwt.decode(token, _SECRET, algorithms=[ALGORITHM])
    except _jwt.ExpiredSignatureError:
        raise ValueError("Token expired")
    except _jwt.InvalidTokenError:
        raise ValueError("Invalid token")
    if payload.get("type") != expected_type:
        raise ValueError(f"Wrong token type: expected {expected_type}, got {payload.get('type')}")
    return payload


# ---------------------------------------------------------------------------
# JWT blacklist (SQLite-based, persistent)
# ---------------------------------------------------------------------------

_blacklist_db_path: Optional[Path] = None


def init_jwt_blacklist(db_path: Path) -> None:
    global _blacklist_db_path
    _blacklist_db_path = db_path
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with _LOCK:
        conn = sqlite3.connect(str(db_path), check_same_thread=False, timeout=10)
        try:
            conn.execute("PRAGMA journal_mode=WAL;")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS jwt_blacklist (
                    jti TEXT PRIMARY KEY,
                    exp REAL NOT NULL
                );
            """)
            conn.commit()
        finally:
            conn.close()


def revoke_jti(jti: str, exp: float) -> None:
    if not _blacklist_db_path:
        return
    with _LOCK:
        conn = sqlite3.connect(str(_blacklist_db_path), check_same_thread=False, timeout=10)
        try:
            conn.execute("INSERT OR IGNORE INTO jwt_blacklist (jti, exp) VALUES (?, ?);", (jti, exp))
            conn.commit()
        finally:
            conn.close()


def is_jti_revoked(jti: str) -> bool:
    if not _blacklist_db_path or not jti:
        return False
    with _LOCK:
        conn = sqlite3.connect(str(_blacklist_db_path), check_same_thread=False, timeout=10)
        try:
            row = conn.execute("SELECT jti FROM jwt_blacklist WHERE jti = ?;", (jti,)).fetchone()
            return row is not None
        finally:
            conn.close()


def cleanup_expired_blacklist() -> None:
    """Удалить истёкшие записи из blacklist (запускать периодически)."""
    if not _blacklist_db_path:
        return
    now = time.time()
    with _LOCK:
        conn = sqlite3.connect(str(_blacklist_db_path), check_same_thread=False, timeout=10)
        try:
            conn.execute("DELETE FROM jwt_blacklist WHERE exp < ?;", (now,))
            conn.commit()
        finally:
            conn.close()


# ---------------------------------------------------------------------------
# CSRF token (non-httpOnly cookie, readable by JS for header)
# ---------------------------------------------------------------------------

def new_csrf_token() -> str:
    return secrets.token_urlsafe(24)
