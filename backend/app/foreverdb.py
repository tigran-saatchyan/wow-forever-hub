"""ForeverDB's API (https://foreverdb.net/developers): WoW Forever's data as JSON — items (with the ones the client
keeps hidden), quests with who gives them and where, vendors and their goods, professions and where recipes are
learned, dungeons, disenchanting, Blizzard's posts.

Terms: read-only, with a key sent in X-API-Key; the free tier allows 5000 requests a day and 30 a minute for the
whole account, so the hub keeps under FH_FOREVERDB_PER_MINUTE and FH_FOREVERDB_PER_DAY. Every page that shows the
data must credit ForeverDB.net with a visible link (the frontend's <FdbCredit>). The key stays on the server.

Answers are kept in the database (fdb_cache) with the game build they came from: an answer is asked again only when
ForeverDB reports a new build or the answer is older than its time to live.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import date, timedelta
from typing import Any

import httpx

from .config import get_settings
from .db import FdbCache, SessionLocal, Setting, utcnow

log = logging.getLogger("uvicorn.error")
BASE = "https://foreverdb.net/api/v1/"
UA = "ForeverHub/0.3 (+https://wow-forever-hub-production.up.railway.app)"
CREDIT = "https://foreverdb.net"


class FdbError(Exception):
    def __init__(self, status: int, path: str, detail: str = ""):
        super().__init__(f"ForeverDB {status} {path}: {detail[:160]}")
        self.status = status


class Client:
    def __init__(self) -> None:
        self.s = get_settings()
        self.http = httpx.AsyncClient(timeout=30, headers={"User-Agent": UA})
        self._lock = asyncio.Lock()
        self._sent: list[float] = []  # times of the requests in the last minute
        self._build: tuple[float, str | None] = (0.0, None)

    @property
    def configured(self) -> bool:
        return bool(self.s.foreverdb_key)

    async def _day_count(self, add: int = 0) -> int:
        """Requests sent today (UTC), kept in the database so a restart doesn't reset the daily limit."""
        key = f"fdb_day:{date.today().isoformat()}"
        async with SessionLocal() as s:
            row = await s.get(Setting, key)
            n = (row.value.get("n", 0) if row else 0) + add
            if add:
                await s.merge(Setting(key=key, value={"n": n}))
                await s.commit()
        return n

    async def _slot(self) -> None:
        """Wait for room under the per-minute limit; refuse when the day's share is spent."""
        async with self._lock:
            if await self._day_count() >= self.s.foreverdb_per_day:
                raise FdbError(429, "-", "the hub's daily share of ForeverDB requests is spent")
            while True:
                now = time.monotonic()
                self._sent = [t for t in self._sent if now - t < 60]
                if len(self._sent) < self.s.foreverdb_per_minute:
                    break
                await asyncio.sleep(60 - (now - self._sent[0]) + 0.1)
            self._sent.append(time.monotonic())
            await self._day_count(1)

    async def fetch(self, path: str, params: dict[str, Any] | None = None) -> dict:
        """One request, straight to ForeverDB (no cache): {"data": …, "meta": …}."""
        if not self.configured:
            raise FdbError(503, path, "no ForeverDB key")
        for attempt in range(3):
            await self._slot()
            r = await self.http.get(BASE + path, params=params, headers={"X-API-Key": self.s.foreverdb_key})
            if r.status_code == 429:
                await asyncio.sleep(min(120, float(r.headers.get("Retry-After") or 30)))
                continue
            if r.status_code >= 500 and attempt < 2:
                await asyncio.sleep(3 * (attempt + 1))
                continue
            if r.status_code != 200:
                raise FdbError(r.status_code, path, r.text)
            return r.json()
        raise FdbError(429, path, "rate limited")

    async def build(self) -> str | None:
        """The game build ForeverDB's data comes from (asked at most once an hour)."""
        at, b = self._build
        if time.time() - at < 3600 and b:
            return b
        try:
            b = (await self.fetch("meta"))["data"].get("build")
        except (FdbError, httpx.HTTPError) as e:
            log.warning("ForeverDB meta: %s", e)
        self._build = (time.time(), b)
        return b

    async def get(self, path: str, params: dict[str, Any] | None = None, ttl_days: float = 30) -> dict:
        """An answer from the cache when it is from the current build and younger than ttl_days, else asked."""
        key = path + ("?" + "&".join(f"{k}={v}" for k, v in sorted(params.items())) if params else "")
        build = await self.build()
        async with SessionLocal() as s:
            row = await s.get(FdbCache, key)
            fresh = row and (build is None or row.build == build) and \
                utcnow() - _aware(row.at) < timedelta(days=ttl_days)
            if fresh:
                return row.value
        try:
            out = await self.fetch(path, params)
        except (FdbError, httpx.HTTPError):
            if row:  # stale beats nothing when ForeverDB can't answer now
                return row.value
            raise
        async with SessionLocal() as s:
            await s.merge(FdbCache(path=key, build=build, at=utcnow(), value=out))
            await s.commit()
        return out

    async def pages(self, path: str, params: dict[str, Any] | None = None, ttl_days: float = 30) -> list[dict]:
        """Every page of a list (100 at a time)."""
        out, offset = [], 0
        while True:
            r = await self.get(path, {**(params or {}), "limit": 100, "offset": offset}, ttl_days)
            out += r.get("data") or []
            if not (r.get("meta") or {}).get("next"):
                return out
            offset += 100


def _aware(d):
    from datetime import UTC
    return d if d.tzinfo else d.replace(tzinfo=UTC)


_client: Client | None = None


def client() -> Client:
    global _client
    if _client is None:
        _client = Client()
    return _client
