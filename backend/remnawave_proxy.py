from __future__ import annotations

import json
import logging
from typing import Any, Dict

import httpx
from fastapi import HTTPException, Request, Response
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


async def proxy_to_remnawave_impl(
    request: Request,
    upstream_path: str,
    *,
    base_url: str,
    token: str,
    strip_profile_id_param: bool = True,
    debug_log: bool = False,
) -> Response:
    """Проксирование запросов к Remnawave API (сетевое + формат ответов)."""
    base_url = str(base_url or "").strip()
    token = str(token or "").strip()
    if not base_url:
        raise HTTPException(status_code=400, detail="Remnawave не настроен для этого профиля")

    url = base_url.rstrip("/") + "/" + upstream_path.lstrip("/")
    params = dict(request.query_params)
    if strip_profile_id_param:
        params.pop("profile_id", None)

    headers: Dict[str, str] = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    ct = request.headers.get("content-type")
    if ct:
        headers["Content-Type"] = ct

    body = await request.body()
    method = request.method.upper()

    if debug_log:
        # Never log tokens/bodies verbatim in production logs.
        logger.debug("[PROXY] %s %s params=%s body_len=%d", method, url, list(params.keys()), len(body))
        if body:
            try:
                body_json = json.loads(body.decode("utf-8"))
                # Body may contain secrets; keep it short.
                logger.debug("[PROXY] Body keys: %s", list(body_json.keys()) if isinstance(body_json, dict) else type(body_json).__name__)
            except Exception:
                logger.debug("[PROXY] Body (raw, first 200 bytes): %s", body[:200])

    timeout = httpx.Timeout(connect=10.0, read=30.0, write=30.0, pool=10.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        try:
            upstream = await client.request(method, url, params=params, content=body, headers=headers)
            if debug_log:
                logger.debug("[PROXY] Response: %s %s", upstream.status_code, upstream.reason_phrase)
                if upstream.status_code >= 400:
                    try:
                        error_text = upstream.text[:500]
                        logger.debug("[PROXY] Error response: %s", error_text)
                    except Exception:
                        logger.debug("[PROXY] Error response (raw): %s", upstream.content[:500])
        except httpx.RequestError as e:
            if debug_log:
                logger.debug("[PROXY] Request error: %s", e)
            raise HTTPException(status_code=502, detail=f"Remnawave API недоступен: {e.__class__.__name__}")

    content_type = upstream.headers.get("content-type", "")
    if "application/json" in content_type:
        try:
            return JSONResponse(status_code=upstream.status_code, content=upstream.json())
        except Exception:
            return Response(status_code=upstream.status_code, content=upstream.content, media_type=content_type)

    return Response(status_code=upstream.status_code, content=upstream.content, media_type=content_type or None)

