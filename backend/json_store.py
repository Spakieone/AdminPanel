import json
import os
import time
import threading
from pathlib import Path
from typing import Any, Dict, Tuple

# Кеш для JSON файлов с TTL
_json_cache: Dict[str, Tuple[Any, float]] = {}
_cache_lock = threading.Lock()

# Per-file write locks to prevent concurrent writes corrupting files
_file_write_locks: Dict[str, threading.Lock] = {}
_file_write_locks_lock = threading.Lock()


def _get_file_write_lock(path: Path) -> threading.Lock:
    key = str(path)
    with _file_write_locks_lock:
        if key not in _file_write_locks:
            _file_write_locks[key] = threading.Lock()
        return _file_write_locks[key]


def _cached_read_json(path: Path, default: Any, ttl_seconds: int = 30) -> Any:
    """Кешированное чтение JSON файла с TTL."""
    cache_key = str(path)
    now = time.time()

    with _cache_lock:
        if cache_key in _json_cache:
            cached_data, cache_time = _json_cache[cache_key]
            if now - cache_time < ttl_seconds:
                return cached_data

    # Читаем из файла
    data = _read_json(path, default)

    # Кешируем
    with _cache_lock:
        _json_cache[cache_key] = (data, now)

    return data


def _invalidate_json_cache(path: Path) -> None:
    """Инвалидация кеша для файла."""
    cache_key = str(path)
    with _cache_lock:
        _json_cache.pop(cache_key, None)


def _read_json(path: Path, default: Any) -> Any:
    try:
        if not path.exists():
            return default
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _write_json(path: Path, data: Any) -> None:
    file_lock = _get_file_write_lock(path)
    with file_lock:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        tmp.replace(path)
        try:
            os.chmod(path, 0o600)
        except Exception:
            pass

    # Инвалидируем кеш при записи
    _invalidate_json_cache(path)

