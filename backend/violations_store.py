"""Violations store: SQLite DB for anti-abuse system."""
import json
import sqlite3
import threading
import time
from datetime import datetime, timedelta
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


def init_violations_db(db_path: Path) -> None:
    with _LOCK:
        conn = _connect(db_path)
        try:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS violations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_email TEXT NOT NULL,
                    user_uuid TEXT,
                    node_uuid TEXT NOT NULL DEFAULT '',
                    score REAL NOT NULL DEFAULT 0,
                    severity TEXT NOT NULL DEFAULT 'low',
                    recommended_action TEXT NOT NULL DEFAULT 'no_action',
                    confidence REAL NOT NULL DEFAULT 0,
                    action_taken TEXT NULL,
                    action_taken_at REAL NULL,
                    action_taken_by TEXT NULL,
                    detected_at REAL NOT NULL,
                    reasons_json TEXT NOT NULL DEFAULT '[]',
                    countries_json TEXT NOT NULL DEFAULT '[]',
                    ips_json TEXT NOT NULL DEFAULT '[]',
                    asn_types_json TEXT NOT NULL DEFAULT '[]',
                    temporal_score REAL NOT NULL DEFAULT 0,
                    geo_score REAL NOT NULL DEFAULT 0,
                    asn_score REAL NOT NULL DEFAULT 0,
                    profile_score REAL NOT NULL DEFAULT 0,
                    device_score REAL NOT NULL DEFAULT 0,
                    notified_at REAL NULL
                );

                CREATE INDEX IF NOT EXISTS idx_violations_email ON violations(user_email);
                CREATE INDEX IF NOT EXISTS idx_violations_detected ON violations(detected_at);
                CREATE INDEX IF NOT EXISTS idx_violations_score ON violations(score);

                CREATE TABLE IF NOT EXISTS connection_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_email TEXT NOT NULL,
                    ip_address TEXT NOT NULL,
                    node_uuid TEXT NOT NULL,
                    connected_at REAL NOT NULL,
                    disconnected_at REAL NULL,
                    bytes_sent INTEGER NOT NULL DEFAULT 0,
                    bytes_received INTEGER NOT NULL DEFAULT 0
                );

                CREATE INDEX IF NOT EXISTS idx_conn_email ON connection_history(user_email);
                CREATE INDEX IF NOT EXISTS idx_conn_connected ON connection_history(connected_at);

                CREATE TABLE IF NOT EXISTS ip_metadata (
                    ip TEXT PRIMARY KEY,
                    asn_org TEXT NULL,
                    country TEXT NULL,
                    city TEXT NULL,
                    connection_type TEXT NULL,
                    is_vpn INTEGER NOT NULL DEFAULT 0,
                    is_proxy INTEGER NOT NULL DEFAULT 0,
                    is_hosting INTEGER NOT NULL DEFAULT 0,
                    is_mobile INTEGER NOT NULL DEFAULT 0,
                    updated_at REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS violation_whitelist (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_email TEXT NOT NULL UNIQUE,
                    reason TEXT NULL,
                    added_by TEXT NULL,
                    added_at REAL NOT NULL,
                    expires_at REAL NULL,
                    excluded_analyzers_json TEXT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_whitelist_email ON violation_whitelist(user_email);
            """)
            conn.commit()
        finally:
            conn.close()


def _v_row(r) -> Dict[str, Any]:
    return {
        "id": r["id"],
        "user_email": r["user_email"],
        "user_uuid": r["user_uuid"],
        "node_uuid": r["node_uuid"],
        "score": r["score"],
        "severity": r["severity"],
        "recommended_action": r["recommended_action"],
        "confidence": r["confidence"],
        "action_taken": r["action_taken"],
        "action_taken_at": r["action_taken_at"],
        "action_taken_by": r["action_taken_by"],
        "detected_at": r["detected_at"],
        "reasons": _json(r["reasons_json"]) or [],
        "countries": _json(r["countries_json"]) or [],
        "ips": _json(r["ips_json"]) or [],
        "asn_types": _json(r["asn_types_json"]) or [],
        "temporal_score": r["temporal_score"],
        "geo_score": r["geo_score"],
        "asn_score": r["asn_score"],
        "profile_score": r["profile_score"],
        "device_score": r["device_score"],
        "notified_at": r["notified_at"],
    }


def _json(s) -> Any:
    if not s:
        return None
    try:
        return json.loads(s)
    except Exception:
        return None


def _severity(score: float) -> str:
    if score >= 80:
        return "critical"
    if score >= 60:
        return "high"
    if score >= 40:
        return "medium"
    return "low"


# ── Violations ────────────────────────────────────────────────────────────────

def create_violation(
    db_path: Path,
    user_email: str,
    node_uuid: str,
    score: float,
    recommended_action: str,
    confidence: float,
    reasons: List[str],
    countries: List[str],
    ips: List[str],
    asn_types: List[str],
    temporal_score: float = 0,
    geo_score: float = 0,
    asn_score: float = 0,
    profile_score: float = 0,
    device_score: float = 0,
    user_uuid: Optional[str] = None,
) -> int:
    now = time.time()
    severity = _severity(score)
    with _LOCK:
        conn = _connect(db_path)
        try:
            cur = conn.execute(
                """INSERT INTO violations
                (user_email, user_uuid, node_uuid, score, severity, recommended_action, confidence,
                 detected_at, reasons_json, countries_json, ips_json, asn_types_json,
                 temporal_score, geo_score, asn_score, profile_score, device_score)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    user_email, user_uuid, node_uuid, score, severity, recommended_action, confidence,
                    now,
                    json.dumps(reasons, ensure_ascii=False),
                    json.dumps(countries, ensure_ascii=False),
                    json.dumps(ips, ensure_ascii=False),
                    json.dumps(asn_types, ensure_ascii=False),
                    temporal_score, geo_score, asn_score, profile_score, device_score,
                ),
            )
            conn.commit()
            return cur.lastrowid
        finally:
            conn.close()


def list_violations(
    db_path: Path,
    days: int = 7,
    page: int = 1,
    per_page: int = 20,
    severity: Optional[str] = None,
    min_score: float = 0,
    resolved: Optional[bool] = None,
    user_email: Optional[str] = None,
    country: Optional[str] = None,
    recommended_action: Optional[str] = None,
) -> Dict[str, Any]:
    since = time.time() - days * 86400
    wheres = ["detected_at >= ?"]
    params: List[Any] = [since]
    if severity:
        wheres.append("severity = ?"); params.append(severity)
    if min_score > 0:
        wheres.append("score >= ?"); params.append(min_score)
    if resolved is not None:
        if resolved:
            wheres.append("action_taken IS NOT NULL")
        else:
            wheres.append("action_taken IS NULL")
    if user_email:
        wheres.append("user_email LIKE ?"); params.append(f"%{user_email}%")
    if country:
        wheres.append("countries_json LIKE ?"); params.append(f'%"{country}"%')
    if recommended_action:
        wheres.append("recommended_action = ?"); params.append(recommended_action)

    where_sql = " AND ".join(wheres)
    offset = (page - 1) * per_page

    with _LOCK:
        conn = _connect(db_path)
        try:
            total = conn.execute(f"SELECT COUNT(*) FROM violations WHERE {where_sql}", params).fetchone()[0]
            rows = conn.execute(
                f"SELECT * FROM violations WHERE {where_sql} ORDER BY detected_at DESC LIMIT ? OFFSET ?",
                params + [per_page, offset],
            ).fetchall()
        finally:
            conn.close()

    items = [_v_row(r) for r in rows]
    pages = max(1, (total + per_page - 1) // per_page)
    return {"items": items, "total": total, "page": page, "per_page": per_page, "pages": pages}


def get_violation(db_path: Path, vid: int) -> Optional[Dict[str, Any]]:
    with _LOCK:
        conn = _connect(db_path)
        try:
            r = conn.execute("SELECT * FROM violations WHERE id=?", (vid,)).fetchone()
        finally:
            conn.close()
    return _v_row(r) if r else None


def resolve_violation(db_path: Path, vid: int, action: str, by: str) -> bool:
    now = time.time()
    with _LOCK:
        conn = _connect(db_path)
        try:
            cur = conn.execute(
                "UPDATE violations SET action_taken=?, action_taken_at=?, action_taken_by=? WHERE id=?",
                (action, now, by, vid),
            )
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()


def annul_violation(db_path: Path, vid: int, by: str) -> bool:
    return resolve_violation(db_path, vid, "annulled", by)


def get_violations_stats(db_path: Path, days: int = 7) -> Dict[str, Any]:
    since = time.time() - days * 86400
    with _LOCK:
        conn = _connect(db_path)
        try:
            rows = conn.execute(
                "SELECT severity, COUNT(*) as cnt FROM violations WHERE detected_at>=? GROUP BY severity",
                (since,),
            ).fetchall()
            total_row = conn.execute(
                "SELECT COUNT(*) as total, COUNT(DISTINCT user_email) as unique_users, AVG(score) as avg_score, MAX(score) as max_score FROM violations WHERE detected_at>=?",
                (since,),
            ).fetchone()
            action_rows = conn.execute(
                "SELECT recommended_action, COUNT(*) as cnt FROM violations WHERE detected_at>=? GROUP BY recommended_action",
                (since,),
            ).fetchall()
        finally:
            conn.close()

    counts = {r["severity"]: r["cnt"] for r in rows}
    by_action = {r["recommended_action"]: r["cnt"] for r in action_rows}
    return {
        "total": total_row["total"] or 0,
        "critical": counts.get("critical", 0),
        "high": counts.get("high", 0),
        "medium": counts.get("medium", 0),
        "low": counts.get("low", 0),
        "unique_users": total_row["unique_users"] or 0,
        "avg_score": round(total_row["avg_score"] or 0, 1),
        "max_score": round(total_row["max_score"] or 0, 1),
        "by_action": by_action,
        "by_country": {},
    }


def get_top_violators(db_path: Path, days: int = 7, limit: int = 15) -> List[Dict[str, Any]]:
    since = time.time() - days * 86400
    with _LOCK:
        conn = _connect(db_path)
        try:
            rows = conn.execute(
                """SELECT user_email, COUNT(*) as violations_count, MAX(score) as max_score,
                   AVG(score) as avg_score, MAX(detected_at) as last_violation_at
                   FROM violations WHERE detected_at>=?
                   GROUP BY user_email ORDER BY violations_count DESC LIMIT ?""",
                (since, limit),
            ).fetchall()
        finally:
            conn.close()
    return [
        {
            "user_email": r["user_email"],
            "violations_count": r["violations_count"],
            "max_score": round(r["max_score"], 1),
            "avg_score": round(r["avg_score"], 1),
            "last_violation_at": r["last_violation_at"],
        }
        for r in rows
    ]


# ── Connection history ────────────────────────────────────────────────────────

def add_connections(db_path: Path, connections: List[Dict[str, Any]]) -> None:
    if not connections:
        return
    now = time.time()
    rows = []
    for c in connections:
        ca = c.get("connected_at")
        if isinstance(ca, str):
            try:
                from datetime import datetime
                ca = datetime.fromisoformat(ca.replace("Z", "+00:00")).timestamp()
            except Exception:
                ca = now
        elif not isinstance(ca, (int, float)):
            ca = now

        da = c.get("disconnected_at")
        if isinstance(da, str):
            try:
                from datetime import datetime
                da = datetime.fromisoformat(da.replace("Z", "+00:00")).timestamp()
            except Exception:
                da = None
        elif not isinstance(da, (int, float)):
            da = None

        rows.append((
            c.get("user_email", ""),
            c.get("ip_address", ""),
            c.get("node_uuid", ""),
            ca,
            da,
            int(c.get("bytes_sent", 0) or 0),
            int(c.get("bytes_received", 0) or 0),
        ))

    with _LOCK:
        conn = _connect(db_path)
        try:
            conn.executemany(
                "INSERT INTO connection_history (user_email, ip_address, node_uuid, connected_at, disconnected_at, bytes_sent, bytes_received) VALUES (?,?,?,?,?,?,?)",
                rows,
            )
            conn.commit()
        finally:
            conn.close()


def get_recent_connections(db_path: Path, user_email: str, hours: int = 24) -> List[Dict[str, Any]]:
    since = time.time() - hours * 3600
    with _LOCK:
        conn = _connect(db_path)
        try:
            rows = conn.execute(
                "SELECT * FROM connection_history WHERE user_email=? AND connected_at>=? ORDER BY connected_at DESC LIMIT 200",
                (user_email, since),
            ).fetchall()
        finally:
            conn.close()
    return [dict(r) for r in rows]


def cleanup_old_data(db_path: Path, retention_days: int = 30) -> None:
    cutoff = time.time() - retention_days * 86400
    with _LOCK:
        conn = _connect(db_path)
        try:
            conn.execute("DELETE FROM connection_history WHERE connected_at < ?", (cutoff,))
            conn.execute("DELETE FROM violations WHERE detected_at < ? AND action_taken IS NOT NULL", (cutoff,))
            conn.commit()
        finally:
            conn.close()


# ── IP metadata ───────────────────────────────────────────────────────────────

def get_ip_info(db_path: Path, ip: str) -> Optional[Dict[str, Any]]:
    with _LOCK:
        conn = _connect(db_path)
        try:
            r = conn.execute("SELECT * FROM ip_metadata WHERE ip=?", (ip,)).fetchone()
        finally:
            conn.close()
    return dict(r) if r else None


def upsert_ip_info(db_path: Path, ip: str, info: Dict[str, Any]) -> None:
    now = time.time()
    with _LOCK:
        conn = _connect(db_path)
        try:
            conn.execute(
                """INSERT INTO ip_metadata (ip, asn_org, country, city, connection_type, is_vpn, is_proxy, is_hosting, is_mobile, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(ip) DO UPDATE SET
                   asn_org=excluded.asn_org, country=excluded.country, city=excluded.city,
                   connection_type=excluded.connection_type, is_vpn=excluded.is_vpn,
                   is_proxy=excluded.is_proxy, is_hosting=excluded.is_hosting,
                   is_mobile=excluded.is_mobile, updated_at=excluded.updated_at""",
                (
                    ip,
                    info.get("asn_org"),
                    info.get("country"),
                    info.get("city"),
                    info.get("connection_type"),
                    1 if info.get("is_vpn") else 0,
                    1 if info.get("is_proxy") else 0,
                    1 if info.get("is_hosting") else 0,
                    1 if info.get("is_mobile") else 0,
                    now,
                ),
            )
            conn.commit()
        finally:
            conn.close()


# ── Whitelist ─────────────────────────────────────────────────────────────────

def list_whitelist(db_path: Path, limit: int = 50, offset: int = 0) -> Dict[str, Any]:
    with _LOCK:
        conn = _connect(db_path)
        try:
            total = conn.execute("SELECT COUNT(*) FROM violation_whitelist").fetchone()[0]
            rows = conn.execute(
                "SELECT * FROM violation_whitelist ORDER BY added_at DESC LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()
        finally:
            conn.close()
    items = [
        {
            "id": r["id"],
            "user_email": r["user_email"],
            "reason": r["reason"],
            "added_by": r["added_by"],
            "added_at": r["added_at"],
            "expires_at": r["expires_at"],
            "excluded_analyzers": _json(r["excluded_analyzers_json"]) or [],
        }
        for r in rows
    ]
    return {"items": items, "total": total}


def is_whitelisted(db_path: Path, user_email: str) -> bool:
    now = time.time()
    with _LOCK:
        conn = _connect(db_path)
        try:
            r = conn.execute(
                "SELECT id, expires_at FROM violation_whitelist WHERE user_email=?",
                (user_email,),
            ).fetchone()
        finally:
            conn.close()
    if not r:
        return False
    if r["expires_at"] and r["expires_at"] < now:
        return False
    return True


def add_to_whitelist(db_path: Path, user_email: str, reason: Optional[str], added_by: str, expires_at: Optional[float] = None) -> bool:
    now = time.time()
    with _LOCK:
        conn = _connect(db_path)
        try:
            conn.execute(
                "INSERT OR REPLACE INTO violation_whitelist (user_email, reason, added_by, added_at, expires_at) VALUES (?,?,?,?,?)",
                (user_email, reason, added_by, now, expires_at),
            )
            conn.commit()
            return True
        except Exception:
            return False
        finally:
            conn.close()


def remove_from_whitelist(db_path: Path, user_email: str) -> bool:
    with _LOCK:
        conn = _connect(db_path)
        try:
            cur = conn.execute("DELETE FROM violation_whitelist WHERE user_email=?", (user_email,))
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()


# ── Analytics ─────────────────────────────────────────────────────────────────

def get_violations_trend(db_path: Path, days: int = 30) -> List[Dict[str, Any]]:
    """Daily violation count for the last N days."""
    since = time.time() - days * 86400
    with _LOCK:
        conn = _connect(db_path)
        try:
            rows = conn.execute(
                """SELECT date(detected_at, 'unixepoch') as day, COUNT(*) as count
                   FROM violations WHERE detected_at>=?
                   GROUP BY day ORDER BY day""",
                (since,),
            ).fetchall()
        finally:
            conn.close()
    return [{"date": r["day"], "count": r["count"]} for r in rows]


def get_connection_stats(db_path: Path, days: int = 7) -> Dict[str, Any]:
    """Connection stats: unique users, total connections, top IPs."""
    since = time.time() - days * 86400
    with _LOCK:
        conn = _connect(db_path)
        try:
            overview = conn.execute(
                """SELECT COUNT(*) as total, COUNT(DISTINCT user_email) as unique_users,
                   COUNT(DISTINCT ip_address) as unique_ips
                   FROM connection_history WHERE connected_at>=?""",
                (since,),
            ).fetchone()
            top_nodes = conn.execute(
                """SELECT node_uuid, COUNT(*) as cnt FROM connection_history
                   WHERE connected_at>=? GROUP BY node_uuid ORDER BY cnt DESC LIMIT 10""",
                (since,),
            ).fetchall()
        finally:
            conn.close()
    return {
        "total_connections": overview["total"] or 0,
        "unique_users": overview["unique_users"] or 0,
        "unique_ips": overview["unique_ips"] or 0,
        "top_nodes": [{"node_uuid": r["node_uuid"], "count": r["cnt"]} for r in top_nodes],
    }
