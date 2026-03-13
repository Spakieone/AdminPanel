from __future__ import annotations

from typing import Any, Callable, Dict, Optional

import httpx
from fastapi import Request, Response
from fastapi.responses import JSONResponse


ErrorFn = Callable[[int, str], Response]

_BOT_PROXY_CLIENT: httpx.AsyncClient | None = None


def _get_bot_proxy_client() -> httpx.AsyncClient:
    """
    Reuse a single AsyncClient per worker to keep connection pooling (TCP/TLS keep-alive).
    This reduces latency and avoids per-request client creation overhead.
    """
    global _BOT_PROXY_CLIENT
    if _BOT_PROXY_CLIENT is None:
        timeout = httpx.Timeout(connect=10.0, read=30.0, write=30.0, pool=10.0)
        limits = httpx.Limits(max_connections=100, max_keepalive_connections=20, keepalive_expiry=30.0)
        _BOT_PROXY_CLIENT = httpx.AsyncClient(timeout=timeout, follow_redirects=True, limits=limits)
    return _BOT_PROXY_CLIENT


async def proxy_to_bot_impl(
    request: Request,
    upstream_path: str,
    *,
    base_url: str,
    token: str,
    admin_id: str,
    add_admin_tg_id: bool = False,
    method_override: Optional[str] = None,
    error_fn: Optional[ErrorFn] = None,
    body_override: Optional[bytes] = None,
) -> Response:
    """
    Proxy request to BOT API.
    Kept isolated so main.py can stay lean; behavior is intended to match the previous inlined implementation.
    """
    base_url = str(base_url or "").strip()
    token = str(token or "").strip()
    admin_id = str(admin_id or "").strip()

    if not base_url:
        if error_fn:
            return error_fn(400, 'Bot API base URL не настроен (укажите env "BOT_API_BASE_URL")')
        return JSONResponse(
            status_code=400,
            content={"detail": 'Bot API base URL не настроен (укажите env "BOT_API_BASE_URL")'},
        )

    url = base_url.rstrip("/") + "/" + upstream_path.lstrip("/")
    params: Dict[str, Any] = dict(request.query_params)
    if add_admin_tg_id and admin_id and "tg_id" not in params:
        params["tg_id"] = admin_id

    headers: Dict[str, str] = {"Accept": "application/json"}
    if token:
        headers["X-Token"] = token

    ct = request.headers.get("content-type")
    if ct:
        headers["Content-Type"] = ct

    body = body_override if body_override is not None else await request.body()
    method = (method_override or request.method).upper()

    client = _get_bot_proxy_client()
    try:
        upstream = await client.request(method, url, params=params, content=body, headers=headers)
    except httpx.RequestError as e:
        if error_fn:
            return error_fn(502, f"Bot API недоступен: {e.__class__.__name__}")
        return JSONResponse(status_code=502, content={"detail": f"Bot API недоступен: {e.__class__.__name__}"})

    content_type = upstream.headers.get("content-type", "")
    if "application/json" in content_type:
        try:
            response_data = upstream.json()
            return JSONResponse(status_code=upstream.status_code, content=response_data)
        except Exception:
            return Response(status_code=upstream.status_code, content=upstream.content, media_type=content_type)

    return Response(status_code=upstream.status_code, content=upstream.content, media_type=content_type or None)

