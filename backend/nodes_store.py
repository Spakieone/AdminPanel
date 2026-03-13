"""Nodes store: хранит только данные агента (токен, метрики).
UUID берётся из remnawave — ноды не создаются вручную."""
import json
import secrets
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

_LOCK = threading.Lock()


def _connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), check_same_thread=False, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    return conn


def init_nodes_db(db_path: Path) -> None:
    with _LOCK:
        conn = _connect(db_path)
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS nodes (
                    uuid TEXT PRIMARY KEY,
                    agent_token TEXT NOT NULL DEFAULT '',
                    last_seen REAL NULL,
                    metrics_json TEXT NULL,
                    connection_count INTEGER NOT NULL DEFAULT 0
                );
            """)
            # Миграция старой схемы: пересоздаём таблицу без лишних колонок
            cols = {row[1] for row in conn.execute("PRAGMA table_info(nodes)").fetchall()}
            old_cols = {'name', 'is_active', 'created_at', 'address'}
            if cols & old_cols:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS nodes_new (
                        uuid TEXT PRIMARY KEY,
                        agent_token TEXT NOT NULL DEFAULT '',
                        last_seen REAL NULL,
                        metrics_json TEXT NULL,
                        connection_count INTEGER NOT NULL DEFAULT 0
                    )
                """)
                conn.execute("""
                    INSERT OR IGNORE INTO nodes_new (uuid, agent_token, last_seen, metrics_json, connection_count)
                    SELECT uuid, COALESCE(agent_token,''), last_seen, metrics_json, connection_count FROM nodes
                """)
                conn.execute("DROP TABLE nodes")
                conn.execute("ALTER TABLE nodes_new RENAME TO nodes")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_nodes_token ON nodes(agent_token) WHERE agent_token != '';")
            conn.commit()
        finally:
            conn.close()


def _row_to_dict(r) -> Dict[str, Any]:
    metrics = None
    mj = r["metrics_json"]
    if mj:
        try:
            metrics = json.loads(mj)
        except Exception:
            pass
    return {
        "uuid": r["uuid"],
        "agent_token": r["agent_token"] or "",
        "last_seen": r["last_seen"],
        "metrics": metrics,
        "connection_count": r["connection_count"],
    }


def list_nodes(db_path: Path) -> List[Dict[str, Any]]:
    with _LOCK:
        conn = _connect(db_path)
        try:
            rows = conn.execute("SELECT * FROM nodes").fetchall()
        finally:
            conn.close()
    return [_row_to_dict(r) for r in rows]


def get_node(db_path: Path, node_uuid: str) -> Optional[Dict[str, Any]]:
    with _LOCK:
        conn = _connect(db_path)
        try:
            r = conn.execute("SELECT * FROM nodes WHERE uuid=?", (node_uuid,)).fetchone()
        finally:
            conn.close()
    return _row_to_dict(r) if r else None


def get_node_by_token(db_path: Path, token: str) -> Optional[Dict[str, Any]]:
    if not token:
        return None
    with _LOCK:
        conn = _connect(db_path)
        try:
            r = conn.execute("SELECT * FROM nodes WHERE agent_token=?", (token,)).fetchone()
        finally:
            conn.close()
    return _row_to_dict(r) if r else None


def ensure_node(db_path: Path, node_uuid: str) -> Dict[str, Any]:
    """Создать запись агента если не существует, иначе вернуть существующую."""
    with _LOCK:
        conn = _connect(db_path)
        try:
            conn.execute(
                "INSERT OR IGNORE INTO nodes (uuid, agent_token) VALUES (?, '')",
                (node_uuid,),
            )
            conn.commit()
            r = conn.execute("SELECT * FROM nodes WHERE uuid=?", (node_uuid,)).fetchone()
        finally:
            conn.close()
    return _row_to_dict(r)


def regenerate_token(db_path: Path, node_uuid: str) -> str:
    """Сгенерировать новый токен. Создаёт запись если не существует."""
    token = secrets.token_hex(32)
    with _LOCK:
        conn = _connect(db_path)
        try:
            conn.execute(
                "INSERT INTO nodes (uuid, agent_token) VALUES (?, ?) "
                "ON CONFLICT(uuid) DO UPDATE SET agent_token=excluded.agent_token",
                (node_uuid, token),
            )
            conn.commit()
        finally:
            conn.close()
    return token


def revoke_token(db_path: Path, node_uuid: str) -> None:
    """Отозвать токен агента."""
    with _LOCK:
        conn = _connect(db_path)
        try:
            conn.execute("UPDATE nodes SET agent_token='' WHERE uuid=?", (node_uuid,))
            conn.commit()
        finally:
            conn.close()


def update_heartbeat(db_path: Path, node_uuid: str, metrics: Optional[Dict] = None) -> None:
    now = time.time()
    metrics_json = json.dumps(metrics, ensure_ascii=False) if metrics else None
    with _LOCK:
        conn = _connect(db_path)
        try:
            if metrics_json:
                conn.execute(
                    "INSERT INTO nodes (uuid, agent_token, last_seen, metrics_json) VALUES (?,'',$now,$m) "
                    "ON CONFLICT(uuid) DO UPDATE SET last_seen=$now, metrics_json=$m",
                    {"uuid": node_uuid, "now": now, "m": metrics_json},
                )
            else:
                conn.execute(
                    "INSERT INTO nodes (uuid, agent_token, last_seen) VALUES (?,'',?) "
                    "ON CONFLICT(uuid) DO UPDATE SET last_seen=excluded.last_seen",
                    (node_uuid, now),
                )
            conn.commit()
        finally:
            conn.close()


def increment_connections(db_path: Path, node_uuid: str, count: int) -> None:
    if count <= 0:
        return
    with _LOCK:
        conn = _connect(db_path)
        try:
            conn.execute(
                "INSERT INTO nodes (uuid, agent_token, connection_count) VALUES (?,'',$c) "
                "ON CONFLICT(uuid) DO UPDATE SET connection_count=connection_count+$c",
                {"uuid": node_uuid, "c": count},
            )
            conn.commit()
        finally:
            conn.close()
