from __future__ import annotations

import time
from typing import Any, Awaitable, Callable, Dict, Optional

import httpx
from bot_api_base import get_bot_api_base_url


ReadJsonFn = Callable[[Any, Any], Any]
WriteJsonFn = Callable[[Any, Any], None]
CheckNodesStatusFn = Callable[[str, str, str], Awaitable[Dict[str, Any]]]
GetNodeStateKeyFn = Callable[[str, str], str]
GetNodeStatusFn = Callable[[Dict[str, Any]], str]


async def refresh_bot_api_status_now_impl(
    profile: Dict[str, Any],
    *,
    read_json: ReadJsonFn,
    write_json: WriteJsonFn,
    monitoring_state_file: Any,
) -> None:
    """
    Immediate BOT API status refresh for a single bot profile.
    Used after create/update/set-active so UI doesn't wait for the background loop.
    """
    try:
        bot_profile_id = str(profile.get("id") or "").strip()
        bot_profile_name = str(profile.get("name") or bot_profile_id)
        bot_url = get_bot_api_base_url(profile)
        bot_token = str(profile.get("token") or "").strip()
        bot_admin_id = str(profile.get("adminId") or "").strip()
        if not bot_profile_id or not bot_url:
            return

        bot_status_key = f"bot_api_status:{bot_profile_id}"
        now_iso = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime())
        current_bot_status = "offline"
        err = ""
        ping_ms: Optional[int] = None
        try:
            import time as _time

            t0 = _time.time()
            timeout = httpx.Timeout(connect=5.0, read=10.0, write=10.0, pool=5.0)
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                headers = {"Accept": "application/json"}
                if bot_token:
                    headers["X-Token"] = bot_token
                params: Dict[str, Any] = {}
                if bot_admin_id:
                    params["tg_id"] = bot_admin_id
                # Use lightweight module endpoint for status checks (avoid hitting heavy /users list).
                # This endpoint is provided by the bot's api-module server.
                r = await client.get(f"{bot_url}/status", headers=headers, params=params)
                last_status: Optional[int] = r.status_code
            ping_ms = int((_time.time() - t0) * 1000)
            if last_status is None:
                current_bot_status = "offline"
                err = "BOT API недоступен"
            elif last_status >= 500:
                current_bot_status = "offline"
                err = f"BOT API недоступен (HTTP {last_status})"
            elif last_status >= 400:
                current_bot_status = "warning"
                err = f"Проблема авторизации/доступа (HTTP {last_status})"
            else:
                current_bot_status = "online"
                err = ""
        except Exception as e:
            current_bot_status = "offline"
            err = str(e).strip() or type(e).__name__

        state = read_json(monitoring_state_file, {})
        if not isinstance(state, dict):
            state = {}
        state[bot_status_key] = {
            "status": current_bot_status,
            "timestamp": now_iso,
            "error": err,
            "profile_name": bot_profile_name,
            "url": bot_url,
            "ping_ms": ping_ms,
        }
        write_json(monitoring_state_file, state)
    except Exception:
        return


async def refresh_remnawave_status_now_impl(
    profile: Dict[str, Any],
    *,
    check_nodes_status: CheckNodesStatusFn,
    get_node_state_key: GetNodeStateKeyFn,
    get_node_status: GetNodeStatusFn,
    read_json: ReadJsonFn,
    write_json: WriteJsonFn,
    monitoring_state_file: Any,
) -> None:
    """
    Immediate Remnawave API + nodes refresh for a single Remnawave profile.
    Writes api_status:<remProfileId> and api_status:<botProfileId>, plus node keys, to monitoring_state.json.
    """
    try:
        from datetime import datetime

        def _extract_node_online_users(node: Any) -> Optional[int]:
            """
            Best-effort extract "online users" count per node from Remnawave node payload.
            Avoid treating booleans as ints (since some APIs use `online: true/false`).
            """
            if node is None:
                return None
            if isinstance(node, bool):
                return None
            if isinstance(node, (int, float)):
                n = int(node)
                return n if n >= 0 else None
            if isinstance(node, dict):
                candidates = (
                    "onlineUsers",
                    "usersOnline",
                    "online_users",
                    "users_online",
                    "onlineCount",
                    "online_count",
                    "usersOnlineCount",
                    "online_users_count",
                )
                for k in candidates:
                    if k not in node:
                        continue
                    v = node.get(k)
                    if isinstance(v, bool):
                        continue
                    if isinstance(v, (int, float)):
                        n = int(v)
                        return n if n >= 0 else None
                    if isinstance(v, str):
                        try:
                            n = int(v)
                            return n if n >= 0 else None
                        except Exception:
                            pass
                for k in ("stats", "usage", "users", "system", "data", "result", "response"):
                    if k in node:
                        found = _extract_node_online_users(node.get(k))
                        if found is not None:
                            return found
            return None

        def _extract_node_country_code(node: Any) -> Optional[str]:
            """Extract ISO-like 2-letter country code from Remnawave node payload if present."""
            try:
                if not isinstance(node, dict):
                    return None
                raw = (
                    node.get("countryCode")
                    or node.get("country_code")
                    or node.get("country")
                    or node.get("countryName")
                    or node.get("country_name")
                )
                if raw is None:
                    return None
                if isinstance(raw, str):
                    s = raw.strip()
                    if len(s) == 2 and s.isalpha():
                        return s.upper()
                    l = s.lower()
                    if "russia" in l or "росси" in l:
                        return "RU"
                    if "germany" in l or "deutsch" in l or "герман" in l or "немец" in l:
                        return "DE"
                    if "poland" in l or "polska" in l or "польш" in l:
                        return "PL"
                    if "kazakh" in l or "казах" in l:
                        return "KZ"
                    if "united states" in l or l in ("usa", "us") or "america" in l or "америк" in l or "сша" in l:
                        return "US"
                    if l in ("uk",) or "united kingdom" in l or "brit" in l or "англи" in l:
                        return "GB"
                    if "nether" in l or "holland" in l or "нидер" in l or "голлан" in l:
                        return "NL"
                return None
            except Exception:
                return None

        profile_id = str(profile.get("id") or "").strip()
        profile_name = str(profile.get("name") or profile_id)
        bot_profile_ids = profile.get("botProfileIds") or []
        bot_profile_ids = [str(x) for x in bot_profile_ids if x]
        settings = profile.get("settings") or {}
        base_url = str(settings.get("base_url") or "").strip()
        token = str(settings.get("token") or "").strip()
        if not profile_id or not base_url:
            return

        result = await check_nodes_status(profile_id, base_url, token)
        nodes = result.get("nodes", []) or []
        api_error = result.get("error")
        api_ping_ms = result.get("responseTime")
        current_api_status = "offline" if api_error else "online"
        now = datetime.now()

        state = read_json(monitoring_state_file, {})
        if not isinstance(state, dict):
            state = {}

        # API status by remnawave profile id
        state[f"api_status:{profile_id}"] = {
            "status": current_api_status,
            "timestamp": now.isoformat(),
            "error": api_error or "",
            "profile_name": profile_name,
            "url": base_url,
            "ping_ms": api_ping_ms,
        }
        # Also by bound bot profile ids (frontend reads by activeProfileId)
        for bpid in bot_profile_ids:
            state[f"api_status:{bpid}"] = {
                "status": current_api_status,
                "timestamp": now.isoformat(),
                "error": api_error or "",
                "profile_name": profile_name,
                "url": base_url,
                "ping_ms": api_ping_ms,
            }

        # Nodes (only if API online and nodes returned)
        if not api_error and isinstance(nodes, list):
            # Prune stale node keys (nodes can be removed/renamed in Remnawave).
            # Without pruning, monitoring_state.json can accumulate old keys and UI will show wrong totals.
            current_node_ids = set()
            for node in nodes:
                if not isinstance(node, dict):
                    continue
                node_id = str(node.get("id", node.get("name", "unknown")))
                if node_id:
                    current_node_ids.add(node_id)

            # Remove any previous node keys for this remnawave profile id and bound bot profile ids
            for pid in [profile_id, *bot_profile_ids]:
                prefix = f"{pid}:"
                for k in list(state.keys()):
                    if not isinstance(k, str):
                        continue
                    if not k.startswith(prefix):
                        continue
                    node_id = k[len(prefix):]
                    if node_id and node_id not in current_node_ids:
                        state.pop(k, None)

            for node in nodes:
                if not isinstance(node, dict):
                    continue
                node_id = str(node.get("id", node.get("name", "unknown")))
                current_status = get_node_status(node)
                online_users = _extract_node_online_users(node)
                country_code = _extract_node_country_code(node)

                # Save under remnawave profile id
                state_key = get_node_state_key(profile_id, node_id)
                rec = {"status": current_status, "timestamp": now.isoformat(), "node_name": node.get("name", node_id)}
                if online_users is not None:
                    rec["online_users"] = int(online_users)
                if country_code:
                    rec["country_code"] = str(country_code)
                state[state_key] = rec

                # Duplicate under bot profile ids (frontend aggregates by activeProfileId)
                for bpid in bot_profile_ids:
                    bpid_state_key = get_node_state_key(str(bpid), node_id)
                    state[bpid_state_key] = dict(rec)

        write_json(monitoring_state_file, state)
    except Exception:
        return

