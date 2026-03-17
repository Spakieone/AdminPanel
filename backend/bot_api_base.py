from __future__ import annotations

import os
from typing import Any, Mapping, Optional

ENV_BOT_API_BASE_URL = "BOT_API_BASE_URL"

# Running inside Docker? If so, 127.0.0.1 won't reach the host — use host.docker.internal.
_IN_DOCKER = os.path.isfile("/.dockerenv") or os.environ.get("ADMINPANEL_DATA_DIR") == "/data"


def _fix_localhost(url: str) -> str:
    """Replace 127.0.0.1 / localhost with host.docker.internal when running in Docker."""
    if not _IN_DOCKER or not url:
        return url
    for local in ("http://127.0.0.1", "http://localhost", "https://127.0.0.1", "https://localhost"):
        if url.lower().startswith(local):
            return "http://host.docker.internal" + url[len(local):]
    return url


def get_bot_api_base_url(profile: Optional[Mapping[str, Any]] = None) -> str:
    """
    Return base URL for Bot API calls.

    Priority:
    1) Per-profile field: profile["botApiUrl"] (recommended for distributable builds / multi-bot).
    2) Environment variable BOT_API_BASE_URL (optional default, convenient for single-bot installs).
       Example: https://bot-gw.example.com/adminpanel/api
    """
    if profile:
        per_profile = str(profile.get("botApiUrl") or "").strip()
        if per_profile:
            return _fix_localhost(per_profile.rstrip("/"))
    env = str(os.environ.get(ENV_BOT_API_BASE_URL) or "").strip()
    if env:
        return _fix_localhost(env.rstrip("/"))
    return ""

