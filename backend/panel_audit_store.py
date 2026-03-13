import json
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass
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


def init_panel_audit_db(db_path: Path) -> None:
    with _LOCK:
        conn = _connect(db_path)
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS panel_audit_log (
                    id TEXT PRIMARY KEY,
                    ts REAL NOT NULL,
                    actor TEXT NOT NULL,
                    action TEXT NOT NULL,
                    target_type TEXT NULL,
                    target_id TEXT NULL,
                    meta_json TEXT NULL,
                    ip_address TEXT NULL,
                    user_agent TEXT NULL,
                    status TEXT NOT NULL DEFAULT 'success'
                );
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_panel_audit_ts ON panel_audit_log(ts);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_panel_audit_actor ON panel_audit_log(actor);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_panel_audit_action ON panel_audit_log(action);")
            # Migrations: add new columns if not present
            cols = {row[1] for row in conn.execute("PRAGMA table_info(panel_audit_log);").fetchall()}
            for col, defn in [
                ("ip_address", "TEXT NULL"),
                ("user_agent", "TEXT NULL"),
                ("status", "TEXT NOT NULL DEFAULT 'success'"),
            ]:
                if col not in cols:
                    conn.execute(f"ALTER TABLE panel_audit_log ADD COLUMN {col} {defn};")
            conn.commit()
        finally:
            conn.close()
    try:
        # Best-effort: keep same permissions as panel_users DB.
        import os

        os.chmod(db_path, 0o600)
    except Exception:
        pass


def append_audit(
    db_path: Path,
    *,
    actor: str,
    action: str,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    status: str = "success",
) -> str:
    actor = str(actor or "").strip() or "unknown"
    action = str(action or "").strip() or "unknown"
    target_type = str(target_type or "").strip() or None
    target_id = str(target_id or "").strip() or None
    ip_address = str(ip_address or "").strip() or None
    user_agent = str(user_agent or "").strip()[:512] or None
    status = str(status or "success").strip() or "success"
    meta_json = None
    if meta is not None:
        try:
            meta_json = json.dumps(meta, ensure_ascii=False, separators=(",", ":"))
        except Exception:
            meta_json = None

    log_id = uuid.uuid4().hex
    ts = float(_now())
    with _LOCK:
        conn = _connect(db_path)
        try:
            conn.execute(
                """
                INSERT INTO panel_audit_log (id, ts, actor, action, target_type, target_id, meta_json, ip_address, user_agent, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                """,
                (log_id, ts, actor, action, target_type, target_id, meta_json, ip_address, user_agent, status),
            )
            conn.commit()
        finally:
            conn.close()
    return log_id


def list_audit(
    db_path: Path,
    *,
    limit: int = 100,
    offset: int = 0,
    actor: Optional[str] = None,
    action: Optional[str] = None,
) -> Tuple[List[Dict[str, Any]], int]:
    limit = int(limit or 100)
    if limit < 1:
        limit = 1
    if limit > 200:
        limit = 200
    offset = int(offset or 0)
    if offset < 0:
        offset = 0

    where: List[str] = []
    params: List[Any] = []
    if actor:
        where.append("lower(actor) = lower(?)")
        params.append(str(actor))
    if action:
        where.append("lower(action) = lower(?)")
        params.append(str(action))
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""

    with _LOCK:
        conn = _connect(db_path)
        try:
            row = conn.execute(f"SELECT COUNT(*) AS c FROM panel_audit_log {where_sql};", tuple(params)).fetchone()
            total = int(row["c"] or 0) if row else 0
            rows = conn.execute(
                f"""
                SELECT id, ts, actor, action, target_type, target_id, meta_json
                FROM panel_audit_log
                {where_sql}
                ORDER BY ts DESC
                LIMIT ? OFFSET ?;
                """,
                tuple(params + [limit, offset]),
            ).fetchall()
        finally:
            conn.close()

    items: List[Dict[str, Any]] = []
    for r in rows or []:
        meta_obj = None
        mj = r["meta_json"]
        if mj:
            try:
                meta_obj = json.loads(mj)
            except Exception:
                meta_obj = None
        items.append(
            {
                "id": r["id"],
                "ts": r["ts"],
                "actor": r["actor"],
                "action": r["action"],
                "target_type": r["target_type"],
                "target_id": r["target_id"],
                "meta": meta_obj,
                "ip_address": r["ip_address"] if "ip_address" in r.keys() else None,
                "user_agent": r["user_agent"] if "user_agent" in r.keys() else None,
                "status": r["status"] if "status" in r.keys() else "success",
            }
        )
    return items, total

