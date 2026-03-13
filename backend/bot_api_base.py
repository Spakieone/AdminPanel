from __future__ import annotations

import os
from typing import Any, Mapping, Optional

ENV_BOT_API_BASE_URL = "BOT_API_BASE_URL"


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
            return per_profile.rstrip("/")
    env = str(os.environ.get(ENV_BOT_API_BASE_URL) or "").strip()
    if env:
        return env.rstrip("/")
    return ""

