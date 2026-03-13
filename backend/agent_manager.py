"""In-memory registry of connected node agents and HMAC signing."""
import hashlib
import hmac
import json
import logging
import time
import threading
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

_LOCK = threading.Lock()
# node_uuid → {"ws": WebSocket, "connected_at": float, "node_uuid": str}
_CONNECTIONS: Dict[str, Any] = {}


def register(node_uuid: str, ws: Any) -> None:
    with _LOCK:
        _CONNECTIONS[node_uuid] = {"ws": ws, "connected_at": time.time(), "node_uuid": node_uuid}
    logger.info("Agent connected: %s", node_uuid)


def unregister(node_uuid: str) -> None:
    with _LOCK:
        _CONNECTIONS.pop(node_uuid, None)
    logger.info("Agent disconnected: %s", node_uuid)


def is_connected(node_uuid: str) -> bool:
    with _LOCK:
        return node_uuid in _CONNECTIONS


def connected_nodes() -> list[str]:
    with _LOCK:
        return list(_CONNECTIONS.keys())


async def send_command(node_uuid: str, payload: dict) -> bool:
    with _LOCK:
        entry = _CONNECTIONS.get(node_uuid)
    if not entry:
        return False
    ws = entry["ws"]
    try:
        await ws.send_text(json.dumps(payload))
        return True
    except Exception as e:
        logger.warning("Failed to send command to %s: %s", node_uuid, e)
        return False


# HMAC signing
def _hmac_key(secret_key: str, agent_token: str) -> bytes:
    return hashlib.sha256(f"{secret_key}:{agent_token}".encode()).digest()


def sign_command(payload: dict, secret_key: str, agent_token: str) -> dict:
    p = {k: v for k, v in payload.items() if k not in ("_sig",)}
    p["_ts"] = int(time.time())
    canonical = json.dumps(p, sort_keys=True, separators=(",", ":"))
    key = _hmac_key(secret_key, agent_token)
    sig = hmac.new(key, canonical.encode(), hashlib.sha256).hexdigest()
    p["_sig"] = sig
    return p
