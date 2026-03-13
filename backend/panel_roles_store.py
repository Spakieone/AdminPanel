import json
import os
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


def _now() -> float:
    return time.time()


def _connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), check_same_thread=False, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
    except Exception:
        pass
    return conn


_LOCK = threading.Lock()


# RBAC model: permission is "<resource>:<action>", e.g. "users:view"
RBAC_ACTIONS: Tuple[str, ...] = ("view", "create", "edit", "delete")

# Keep resource keys stable (used by frontend + enforcement).
RBAC_RESOURCES: Tuple[Tuple[str, str], ...] = (
    ("analytics", "Аналитика"),
    ("users", "Пользователи"),
    ("subscriptions", "Подписки"),
    ("payments", "Платежи"),
    ("tariffs", "Тарифы"),
    ("servers", "Серверы"),
    ("nodes", "Ноды"),
    ("hosts", "Хосты"),
    ("settings", "Настройки"),
    ("sender", "Рассылка"),
    ("administrators", "Администраторы"),
    ("roles", "Роли"),
)


def _all_perms() -> List[str]:
    return [f"{r}:{a}" for r, _ in RBAC_RESOURCES for a in RBAC_ACTIONS]


def _ensure_list_of_str(value: Any) -> List[str]:
    if not isinstance(value, list):
        return []
    out: List[str] = []
    for x in value:
        if isinstance(x, str) and x.strip():
            out.append(x.strip())
    return out


def _role_row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    perms_raw = []
    try:
        perms_raw = json.loads(str(row["permissions_json"] or "[]"))
    except Exception:
        perms_raw = []
    return {
        "name": row["name"],
        "title": row["title"],
        "description": row["description"],
        "permissions": _ensure_list_of_str(perms_raw),
        "is_system": bool(row["is_system"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def init_panel_roles_db(db_path: Path) -> None:
    with _LOCK:
        conn = _connect(db_path)
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS panel_roles (
                    name TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    description TEXT NULL,
                    permissions_json TEXT NOT NULL,
                    is_system INTEGER NOT NULL DEFAULT 0,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                );
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_panel_roles_is_system ON panel_roles(is_system);")

            # Bootstrap defaults if empty.
            row = conn.execute("SELECT COUNT(*) AS c FROM panel_roles;").fetchone()
            count = int(row["c"] or 0) if row else 0
            if count <= 0:
                now = float(_now())
                defaults = [
                    {
                        "name": "super_admin",
                        "title": "Super Admin",
                        "description": "Полный доступ включая управление администраторами и ролями",
                        "permissions": _all_perms(),
                        "is_system": 1,
                    },
                    {
                        "name": "manager",
                        "title": "Manager",
                        "description": "Управление пользователями/подписками/нодами/хостами/серверами",
                        "permissions": [
                            "analytics:view",
                            "users:view",
                            "users:create",
                            "users:edit",
                            "users:delete",
                            "subscriptions:view",
                            "subscriptions:create",
                            "subscriptions:edit",
                            "subscriptions:delete",
                            "payments:view",
                            "tariffs:view",
                            "tariffs:create",
                            "tariffs:edit",
                            "tariffs:delete",
                            "servers:view",
                            "servers:create",
                            "servers:edit",
                            "servers:delete",
                            "nodes:view",
                            "hosts:view",
                            "settings:view",
                        ],
                        "is_system": 1,
                    },
                    {
                        "name": "operator",
                        "title": "Operator",
                        "description": "Просмотр всего, создание/редактирование пользователей",
                        "permissions": [
                            "analytics:view",
                            "users:view",
                            "users:create",
                            "users:edit",
                            "subscriptions:view",
                            "payments:view",
                            "tariffs:view",
                            "servers:view",
                            "nodes:view",
                            "hosts:view",
                            "settings:view",
                            "sender:view",
                        ],
                        "is_system": 1,
                    },
                    {
                        "name": "viewer",
                        "title": "Viewer",
                        "description": "Только просмотр",
                        "permissions": [
                            "analytics:view",
                            "users:view",
                            "subscriptions:view",
                            "payments:view",
                            "tariffs:view",
                            "servers:view",
                            "nodes:view",
                            "hosts:view",
                            "settings:view",
                            "sender:view",
                        ],
                        "is_system": 1,
                    },
                ]
                for r in defaults:
                    conn.execute(
                        """
                        INSERT INTO panel_roles (name, title, description, permissions_json, is_system, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?);
                        """,
                        (
                            r["name"],
                            r["title"],
                            r.get("description"),
                            json.dumps(r.get("permissions") or []),
                            int(r.get("is_system") or 0),
                            now,
                            now,
                        ),
                    )

            conn.commit()
        finally:
            conn.close()
        try:
            os.chmod(db_path, 0o600)
        except Exception:
            pass


def list_roles(db_path: Path) -> List[Dict[str, Any]]:
    with _LOCK:
        conn = _connect(db_path)
        try:
            rows = conn.execute("SELECT * FROM panel_roles ORDER BY is_system DESC, created_at ASC;").fetchall()
            return [_role_row_to_dict(r) for r in (rows or [])]
        finally:
            conn.close()


def get_role(db_path: Path, role_name: str) -> Optional[Dict[str, Any]]:
    role_name = str(role_name or "").strip()
    if not role_name:
        return None
    with _LOCK:
        conn = _connect(db_path)
        try:
            row = conn.execute("SELECT * FROM panel_roles WHERE name = ? LIMIT 1;", (role_name,)).fetchone()
            return _role_row_to_dict(row) if row else None
        finally:
            conn.close()


def role_exists(db_path: Path, role_name: str) -> bool:
    return bool(get_role(db_path, role_name))


def update_role_permissions(
    db_path: Path,
    role_name: str,
    *,
    title: Optional[str] = None,
    description: Optional[str] = None,
    permissions: Optional[List[str]] = None,
) -> Dict[str, Any]:
    role_name = str(role_name or "").strip()
    if not role_name:
        raise ValueError("role_name is required")
    role = get_role(db_path, role_name)
    if not role:
        raise KeyError("role not found")
    if role_name == "super_admin":
        # Super admin is always full access.
        raise ValueError("super_admin permissions are fixed")

    updates: List[str] = []
    params: List[Any] = []

    if title is not None:
        t = str(title or "").strip()
        if not t:
            raise ValueError("title cannot be empty")
        updates.append("title = ?")
        params.append(t)

    if description is not None:
        updates.append("description = ?")
        params.append(str(description or "").strip() or None)

    if permissions is not None:
        # Validate: only known resource/action pairs.
        allowed = {f"{r}:{a}" for r, _ in RBAC_RESOURCES for a in RBAC_ACTIONS}
        cleaned: List[str] = []
        for p in permissions:
            if not isinstance(p, str):
                continue
            p2 = p.strip()
            if p2 in allowed:
                cleaned.append(p2)
        updates.append("permissions_json = ?")
        params.append(json.dumps(sorted(set(cleaned))))

    if not updates:
        return get_role(db_path, role_name) or role

    updates.append("updated_at = ?")
    params.append(float(_now()))
    params.append(role_name)

    with _LOCK:
        conn = _connect(db_path)
        try:
            res = conn.execute(
                f"UPDATE panel_roles SET {', '.join(updates)} WHERE name = ?;",
                tuple(params),
            )
            if res.rowcount <= 0:
                raise KeyError("role not found")
            conn.commit()
        finally:
            conn.close()

    updated = get_role(db_path, role_name)
    if not updated:
        raise KeyError("role not found")
    return updated

