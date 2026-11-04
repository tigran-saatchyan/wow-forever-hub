"""HTTP helper: one session, retries, polite UA, on-disk cache for immutable data."""
from __future__ import annotations

import hashlib
import time
from pathlib import Path

import requests

from . import config

_session: requests.Session | None = None


def session() -> requests.Session:
    global _session
    if _session is None:
        s = requests.Session()
        s.headers["User-Agent"] = config.USER_AGENT
        _session = s
    return _session


def get(url: str, *, timeout: int = 60, retries: int = 3, **kw) -> requests.Response:
    last: Exception | None = None
    for attempt in range(retries):
        try:
            r = session().get(url, timeout=timeout, **kw)
            if r.status_code == 429:  # rate limited: honour Retry-After, then retry
                wait = r.headers.get("Retry-After", "")
                time.sleep(min(60, int(wait)) if wait.isdigit() else 8 * (attempt + 1))
                raise requests.HTTPError(f"429 for {url}")
            if r.status_code in (500, 502, 503, 504):
                raise requests.HTTPError(f"{r.status_code} for {url}")
            r.raise_for_status()
            return r
        except (requests.RequestException,) as e:  # noqa: PERF203
            last = e
            time.sleep(2 ** attempt)
    raise RuntimeError(f"GET failed after {retries} tries: {url}: {last}")


def cached_text(url: str, cache_path: Path, *, timeout: int = 120) -> str:
    """Fetch once and keep forever. Use only for data addressed by build number."""
    if cache_path.exists() and cache_path.stat().st_size > 0:
        return cache_path.read_text(encoding="utf-8")
    text = get(url, timeout=timeout).text
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(text, encoding="utf-8")
    return text


def cached_bytes(url: str, cache_dir: Path) -> bytes | None:
    key = hashlib.sha1(url.encode()).hexdigest()
    p = cache_dir / key
    if p.exists():
        return p.read_bytes() or None
    try:
        data = get(url, timeout=30, retries=2).content
    except RuntimeError:
        data = b""
    cache_dir.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
    return data or None
