import json
import os
import secrets
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import bcrypt

try:
    import pyotp as _pyotp
    _HAS_PYOTP = True
except ImportError:
    _HAS_PYOTP = False


# NOTE:
# We keep legacy "admin" for backwards compatibility / migrations.
# New main roles: super_admin, manager, operator, viewer.
ALLOWED_ROLES: Tuple[str, ...] = ("super_admin", "manager", "operator", "viewer", "admin")


def _now() -> float:
    return time.time()


def _normalize_username(username: str) -> str:
    return str(username or "").strip()


def _connect(db_path: Path) -> sqlite3.Connection:
    # Create parent directory just in case (PROJECT_ROOT should exist, but be safe).
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), check_same_thread=False, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        conn.execute("PRAGMA foreign_keys=ON;")
    except Exception:
        pass
    return conn


_LOCK = threading.Lock()


def init_panel_users_db(db_path: Path) -> None:
    with _LOCK:
        conn = _connect(db_path)
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS panel_users (
                    id TEXT PRIMARY KEY,
                    username TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL,
                    tg_id INTEGER NULL,
                    is_active INTEGER NOT NULL DEFAULT 1,
                    created_at REAL NOT NULL,
                    last_login_at REAL NULL
                );
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_panel_users_username ON panel_users(username);")
            # Migration: rename legacy role 'owner' -> 'super_admin'
            conn.execute("UPDATE panel_users SET role='super_admin' WHERE role='owner';")
            # Migration: rename legacy role 'admin' -> 'manager'
            conn.execute("UPDATE panel_users SET role='manager' WHERE role='admin';")
            # TOTP table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS panel_user_totp (
                    user_id TEXT PRIMARY KEY,
                    secret TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 0,
                    backup_codes_json TEXT NULL
                );
            """)
            conn.commit()
        finally:
            conn.close()
        try:
            os.chmod(db_path, 0o600)
        except Exception:
            pass


def _row_to_public_dict(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "username": row["username"],
        "role": row["role"],
        "tg_id": row["tg_id"],
        "is_active": bool(row["is_active"]),
        "created_at": row["created_at"],
        "last_login_at": row["last_login_at"],
    }


def count_users(db_path: Path) -> int:
    with _LOCK:
        conn = _connect(db_path)
        try:
            row = conn.execute("SELECT COUNT(*) AS c FROM panel_users;").fetchone()
            return int(row["c"] or 0) if row else 0
        finally:
            conn.close()


def list_users(db_path: Path) -> List[Dict[str, Any]]:
    with _LOCK:
        conn = _connect(db_path)
        try:
            rows = conn.execute(
                "SELECT id, username, role, tg_id, is_active, created_at, last_login_at FROM panel_users ORDER BY created_at ASC;"
            ).fetchall()
            return [_row_to_public_dict(r) for r in (rows or [])]
        finally:
            conn.close()


def get_user_by_id(db_path: Path, user_id: str) -> Optional[Dict[str, Any]]:
    with _LOCK:
        conn = _connect(db_path)
        try:
            row = conn.execute(
                "SELECT id, username, role, tg_id, is_active, created_at, last_login_at FROM panel_users WHERE id = ? LIMIT 1;",
                (str(user_id),),
            ).fetchone()
            return _row_to_public_dict(row) if row else None
        finally:
            conn.close()


def _get_user_row_by_username(db_path: Path, username: str) -> Optional[sqlite3.Row]:
    username = _normalize_username(username)
    if not username:
        return None
    with _LOCK:
        conn = _connect(db_path)
        try:
            row = conn.execute(
                "SELECT * FROM panel_users WHERE lower(username) = lower(?) LIMIT 1;",
                (username,),
            ).fetchone()
            return row
        finally:
            conn.close()


def create_user(
    db_path: Path,
    *,
    username: str,
    password: str,
    role: str = "operator",
    tg_id: Optional[int] = None,
    is_active: bool = True,
) -> Dict[str, Any]:
    username = _normalize_username(username)
    if not username:
        raise ValueError("username is required")
    # Compatibility: accept legacy 'owner' as 'super_admin'
    if role == "owner":
        role = "super_admin"
    # Compatibility: accept legacy 'admin' as 'manager'
    if role == "admin":
        role = "manager"
    if role not in ALLOWED_ROLES:
        raise ValueError("invalid role")
    password = str(password or "")
    if len(password) < 8:
        raise ValueError("password too short (min 8)")

    password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")
    user_id = uuid.uuid4().hex
    now = _now()

    with _LOCK:
        conn = _connect(db_path)
        try:
            if role == "super_admin" and bool(is_active):
                row = conn.execute(
                    "SELECT COUNT(*) AS c FROM panel_users WHERE role IN ('super_admin','owner') AND is_active=1;"
                ).fetchone()
                cnt = int(row["c"] or 0) if row else 0
                if cnt >= 1:
                    raise ValueError("super_admin already exists (only one active super_admin is allowed)")
            conn.execute(
                """
                INSERT INTO panel_users (id, username, password_hash, role, tg_id, is_active, created_at, last_login_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, NULL);
                """,
                (
                    user_id,
                    username,
                    password_hash,
                    role,
                    int(tg_id) if tg_id is not None else None,
                    1 if is_active else 0,
                    float(now),
                ),
            )
            conn.commit()
        finally:
            conn.close()

    return get_user_by_id(db_path, user_id) or {
        "id": user_id,
        "username": username,
        "role": role,
        "tg_id": tg_id,
        "is_active": bool(is_active),
        "created_at": now,
        "last_login_at": None,
    }


def update_user(
    db_path: Path,
    user_id: str,
    *,
    username: Optional[str] = None,
    password: Optional[str] = None,
    role: Optional[str] = None,
    tg_id: Optional[int] = None,
    is_active: Optional[bool] = None,
) -> Dict[str, Any]:
    user_id = str(user_id)
    fields: List[str] = []
    params: List[Any] = []

    if username is not None:
        u = _normalize_username(username)
        if not u:
            raise ValueError("username cannot be empty")
        fields.append("username = ?")
        params.append(u)

    if role is not None:
        if role == "owner":
            role = "super_admin"
        if role == "admin":
            role = "manager"
        if role not in ALLOWED_ROLES:
            raise ValueError("invalid role")
        fields.append("role = ?")
        params.append(role)

    if tg_id is not None:
        fields.append("tg_id = ?")
        params.append(int(tg_id))

    if is_active is not None:
        fields.append("is_active = ?")
        params.append(1 if is_active else 0)

    if password is not None:
        pwd = str(password or "")
        if len(pwd) < 8:
            raise ValueError("password too short (min 8)")
        password_hash = bcrypt.hashpw(pwd.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")
        fields.append("password_hash = ?")
        params.append(password_hash)

    if not fields:
        existing = get_user_by_id(db_path, user_id)
        if not existing:
            raise KeyError("user not found")
        return existing

    params.append(user_id)

    with _LOCK:
        conn = _connect(db_path)
        try:
            # RBAC invariant: exactly one active super_admin at most, and at least one active super_admin.
            current = conn.execute(
                "SELECT id, role, is_active FROM panel_users WHERE id = ? LIMIT 1;",
                (user_id,),
            ).fetchone()
            if not current:
                raise KeyError("user not found")

            current_role = str(current["role"] or "")
            current_active = bool(current["is_active"])

            next_role = current_role
            next_active = current_active
            if role is not None:
                next_role = str(role)
            if is_active is not None:
                next_active = bool(is_active)

            # If we are turning THIS user into an active super_admin -> must be the only active one.
            if next_role in ("super_admin", "owner") and next_active:
                row = conn.execute(
                    "SELECT COUNT(*) AS c FROM panel_users WHERE id != ? AND role IN ('super_admin','owner') AND is_active=1;",
                    (user_id,),
                ).fetchone()
                others = int(row["c"] or 0) if row else 0
                if others >= 1:
                    raise ValueError("only one active super_admin is allowed")

            # If we are disabling/removing active super_admin -> must not be the last active one.
            was_super = current_role in ("super_admin", "owner")
            will_be_super_active = (next_role in ("super_admin", "owner")) and next_active
            if was_super and current_active and not will_be_super_active:
                row = conn.execute(
                    "SELECT COUNT(*) AS c FROM panel_users WHERE id != ? AND role IN ('super_admin','owner') AND is_active=1;",
                    (user_id,),
                ).fetchone()
                others = int(row["c"] or 0) if row else 0
                if others <= 0:
                    raise ValueError("cannot remove/disable the last active super_admin")

            res = conn.execute(
                f"UPDATE panel_users SET {', '.join(fields)} WHERE id = ?;",
                tuple(params),
            )
            if res.rowcount <= 0:
                raise KeyError("user not found")
            conn.commit()
        finally:
            conn.close()

    u = get_user_by_id(db_path, user_id)
    if not u:
        raise KeyError("user not found")
    return u


def _count_owners(conn: sqlite3.Connection) -> int:
    row = conn.execute(
        "SELECT COUNT(*) AS c FROM panel_users WHERE role IN ('super_admin','owner') AND is_active=1;"
    ).fetchone()
    return int(row["c"] or 0) if row else 0


def delete_user(db_path: Path, user_id: str) -> bool:
    user_id = str(user_id)
    with _LOCK:
        conn = _connect(db_path)
        try:
            row = conn.execute("SELECT id, role, is_active FROM panel_users WHERE id = ? LIMIT 1;", (user_id,)).fetchone()
            if not row:
                return False
            role = str(row["role"] or "")
            is_active = bool(row["is_active"])
            if role in ("super_admin", "owner") and is_active:
                owners = _count_owners(conn)
                if owners <= 1:
                    raise ValueError("cannot delete the last active super_admin")
            res = conn.execute("DELETE FROM panel_users WHERE id = ?;", (user_id,))
            conn.commit()
            return res.rowcount > 0
        finally:
            conn.close()


def verify_login(db_path: Path, username: str, password: str) -> Optional[Dict[str, Any]]:
    row = _get_user_row_by_username(db_path, username)
    if not row:
        return None
    if not bool(row["is_active"]):
        return None
    password_hash = str(row["password_hash"] or "")
    if not password_hash:
        return None
    ok = bcrypt.checkpw(str(password or "").encode("utf-8"), password_hash.encode("utf-8"))
    if not ok:
        return None

    # Update last_login_at best-effort.
    with _LOCK:
        conn = _connect(db_path)
        try:
            conn.execute("UPDATE panel_users SET last_login_at = ? WHERE id = ?;", (float(_now()), str(row["id"])))
            conn.commit()
        finally:
            conn.close()

    return _row_to_public_dict(row)


def bootstrap_owner_from_credentials_file(
    db_path: Path,
    *,
    credentials: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    """
    If DB has no users, create a 'super_admin' using existing auth_credentials.json
    (keeps backwards compatibility on updates).
    """
    if count_users(db_path) > 0:
        return None
    username = _normalize_username(str(credentials.get("username") or ""))
    password_hash = str(credentials.get("password_hash") or "")
    if not username or not password_hash:
        return None

    user_id = uuid.uuid4().hex
    now = _now()
    with _LOCK:
        conn = _connect(db_path)
        try:
            conn.execute(
                """
                INSERT INTO panel_users (id, username, password_hash, role, tg_id, is_active, created_at, last_login_at)
                VALUES (?, ?, ?, 'super_admin', NULL, 1, ?, NULL);
                """,
                (user_id, username, password_hash, float(now)),
            )
            conn.commit()
        finally:
            conn.close()

    return get_user_by_id(db_path, user_id)


# ---------------------------------------------------------------------------
# TOTP (2FA) functions
# ---------------------------------------------------------------------------

_BACKUP_CODES_COUNT = 8


def generate_totp_secret(db_path: Path, user_id: str) -> str:
    """Генерировать новый TOTP secret и сохранить (disabled). Вернуть secret."""
    if not _HAS_PYOTP:
        raise RuntimeError("pyotp not installed")
    secret = _pyotp.random_base32()
    with _LOCK:
        conn = _connect(db_path)
        try:
            conn.execute(
                "INSERT INTO panel_user_totp (user_id, secret, enabled) VALUES (?, ?, 0) "
                "ON CONFLICT(user_id) DO UPDATE SET secret=excluded.secret, enabled=0, backup_codes_json=NULL;",
                (str(user_id), secret),
            )
            conn.commit()
        finally:
            conn.close()
    return secret


def get_totp_info(db_path: Path, user_id: str) -> Optional[Dict[str, Any]]:
    """Вернуть {secret, enabled, has_backup_codes} или None."""
    with _LOCK:
        conn = _connect(db_path)
        try:
            row = conn.execute(
                "SELECT secret, enabled, backup_codes_json FROM panel_user_totp WHERE user_id=?;",
                (str(user_id),),
            ).fetchone()
        finally:
            conn.close()
    if not row:
        return None
    return {
        "secret": row["secret"],
        "enabled": bool(row["enabled"]),
        "has_backup_codes": bool(row["backup_codes_json"]),
    }


def enable_totp(db_path: Path, user_id: str, code: str) -> List[str]:
    """Верифицировать код, включить TOTP. Вернуть список backup кодов (plain)."""
    if not _HAS_PYOTP:
        raise RuntimeError("pyotp not installed")
    info = get_totp_info(db_path, user_id)
    if not info:
        raise ValueError("TOTP secret not generated")
    totp = _pyotp.TOTP(info["secret"])
    if not totp.verify(str(code or ""), valid_window=1):
        raise ValueError("Неверный код")

    plain_codes = [secrets.token_hex(4).upper() for _ in range(_BACKUP_CODES_COUNT)]
    hashed_codes = [
        bcrypt.hashpw(c.encode(), bcrypt.gensalt(rounds=10)).decode()
        for c in plain_codes
    ]
    codes_json = json.dumps(hashed_codes)

    with _LOCK:
        conn = _connect(db_path)
        try:
            conn.execute(
                "UPDATE panel_user_totp SET enabled=1, backup_codes_json=? WHERE user_id=?;",
                (codes_json, str(user_id)),
            )
            conn.commit()
        finally:
            conn.close()
    return plain_codes


def disable_totp(db_path: Path, user_id: str) -> None:
    """Отключить TOTP."""
    with _LOCK:
        conn = _connect(db_path)
        try:
            conn.execute(
                "UPDATE panel_user_totp SET enabled=0, backup_codes_json=NULL WHERE user_id=?;",
                (str(user_id),),
            )
            conn.commit()
        finally:
            conn.close()


def verify_totp_code(db_path: Path, user_id: str, code: str) -> bool:
    """Проверить TOTP код или backup код. Backup код используется один раз."""
    if not _HAS_PYOTP:
        return False
    info = get_totp_info(db_path, user_id)
    if not info or not info["enabled"]:
        return False

    code_str = str(code or "").strip().upper()

    totp = _pyotp.TOTP(info["secret"])
    if totp.verify(code_str, valid_window=1):
        return True

    if not info["has_backup_codes"]:
        return False
    with _LOCK:
        conn = _connect(db_path)
        try:
            row = conn.execute(
                "SELECT backup_codes_json FROM panel_user_totp WHERE user_id=?;",
                (str(user_id),),
            ).fetchone()
            if not row or not row["backup_codes_json"]:
                return False
            hashed_codes: List[str] = json.loads(row["backup_codes_json"])
            matched_idx = None
            for i, hashed in enumerate(hashed_codes):
                if bcrypt.checkpw(code_str.encode(), hashed.encode()):
                    matched_idx = i
                    break
            if matched_idx is None:
                return False
            hashed_codes.pop(matched_idx)
            new_json = json.dumps(hashed_codes) if hashed_codes else None
            conn.execute(
                "UPDATE panel_user_totp SET backup_codes_json=? WHERE user_id=?;",
                (new_json, str(user_id)),
            )
            conn.commit()
            return True
        finally:
            conn.close()


def is_totp_enabled(db_path: Path, user_id: str) -> bool:
    info = get_totp_info(db_path, user_id)
    return bool(info and info["enabled"])
