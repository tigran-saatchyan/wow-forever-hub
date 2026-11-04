"""Error-code lookup data: curated knowledge base + live forum activity per code.

For every code we know (plus codes discovered in recent forum posts) we count
player reports per day on the US and EU forums since the beta started, and keep
the freshest threads. The site uses the daily counts to show whether a code is
spiking right now and whether spikes line up with maintenance windows.
"""
from __future__ import annotations

import json
import logging
import re
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import config, net

log = logging.getLogger(__name__)
KB_PATH = Path(__file__).with_name("errors_kb.json")
CODE_RX = re.compile(r"\b((?:BLZ|WOW)5\d{7})\b", re.I)
DISCOVERY_QUERIES = ["BLZ5", "WOW5", "error code", "disconnected"]


def load_kb() -> dict:
    return json.loads(KB_PATH.read_text(encoding="utf-8"))


class SearchFailed(Exception):
    pass


PACE = 1.5  # seconds between forum searches; Discourse rate-limits anonymous search


SEARCH_RETRIES = 4  # lowered to 1 in budgeted (scheduled) runs: a 429 costs a run, not minutes


def _search(region: str, q: str, page: int = 1) -> dict:
    base = config.FORUM_BASE.format(region=region)
    time.sleep(PACE)
    try:
        return net.get(f"{base}/search.json", params={"q": q, "page": page}, timeout=20, retries=SEARCH_RETRIES).json()
    except (RuntimeError, ValueError) as e:
        log.warning("forum search %s %r: %s", region, q, e)
        raise SearchFailed(str(e)) from e


def discover_codes(since: str, deadline: float | None = None) -> Counter | None:
    """Codes mentioned in recent forum posts; None if the deadline cut it short."""
    found: Counter = Counter()
    for region in ("us", "eu"):
        for q in DISCOVERY_QUERIES:
            for page in (1, 2):
                if deadline and time.monotonic() > deadline:
                    return None
                try:
                    d = _search(region, f"{q} after:{since}", page)
                except SearchFailed:
                    break
                for t in d.get("topics", []):
                    found.update(c.upper() for c in CODE_RX.findall(t.get("title", "")))
                for p in d.get("posts", []):
                    found.update(c.upper() for c in CODE_RX.findall(p.get("blurb", "")))
    return found


def code_activity(code: str, since: str) -> dict:
    """Posts mentioning `code` per UTC day + freshest threads (US + EU)."""
    per_day: Counter = Counter()
    threads: dict[tuple[str, int], dict] = {}
    seen_posts: set[tuple[str, int]] = set()
    for region in ("us", "eu"):
        base = config.FORUM_BASE.format(region=region)
        for page in (1, 2, 3):
            d = _search(region, f"{code} after:{since}", page)
            topics = {t["id"]: t for t in d.get("topics", [])}
            posts = d.get("posts", [])
            for p in posts:
                key = (region, p["id"])
                if key in seen_posts:
                    continue
                seen_posts.add(key)
                per_day[p["created_at"][:10]] += 1
                t = topics.get(p["topic_id"])
                if t:
                    th = threads.setdefault((region, t["id"]), {
                        "title": t["title"], "region": region, "url": f"{base}/t/{t.get('slug', 'topic')}/{t['id']}",
                        "created": t["created_at"], "last": p["created_at"], "posts": t.get("posts_count", 1),
                        "forever": t.get("category_id") in config.FOREVER_CATEGORIES or "forever" in t["title"].lower(),
                    })
                    th["last"] = max(th["last"], p["created_at"])
            if len(posts) < 20:
                break
    top = sorted(threads.values(), key=lambda t: t["last"], reverse=True)[:6]
    return {"perDay": dict(sorted(per_day.items())), "reports": sum(per_day.values()), "threads": top}


def build_errors(since: str | None = None, previous: dict | None = None, budget_s: float | None = None) -> dict:
    """Refresh per-code forum activity.

    With `budget_s`, work incrementally: refresh the codes refreshed longest ago
    until the time budget runs out and keep the previous numbers for the rest, so
    one scheduled run never takes minutes (forum search is rate-limited).
    New codes are discovered at most every 12 h.
    """
    t0 = time.monotonic()
    since = since or config.KEY_DATES["beta_start"]
    kb = load_kb()
    previous = previous or {}
    prev_codes = previous.get("codes", {})
    now = datetime.now(timezone.utc)
    codes = set(kb["codes"]) | set(prev_codes)
    discovered_at = previous.get("discoveredAt")
    stale_discovery = not discovered_at or now - datetime.fromisoformat(discovered_at.replace("Z", "+00:00")) > timedelta(hours=12)
    global SEARCH_RETRIES
    if budget_s is not None:
        SEARCH_RETRIES = 1
    # Discovery is spread over runs: in a budgeted run it gets a third of the
    # budget and only counts as done when it finishes.
    if stale_discovery and (budget_s is None or budget_s >= 30):
        found = discover_codes(since, deadline=None if budget_s is None else t0 + budget_s / 3)
        if found is not None:
            codes |= {c for c, n in found.items() if n >= 2}
            discovered_at = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    order = sorted(codes, key=lambda c: prev_codes.get(c, {}).get("refreshed") or "")
    out = {}
    refreshed = 0
    for code in order:
        old = prev_codes.get(code, {})
        act = None
        if budget_s is None or time.monotonic() - t0 < budget_s:
            try:
                act = code_activity(code, since)
                act["refreshed"] = now.strftime("%Y-%m-%dT%H:%M:%SZ")
                refreshed += 1
            except SearchFailed:
                act = None
        if act is None:  # keep the last good numbers instead of zeroing them
            act = {k: old.get(k, d) for k, d in (("perDay", {}), ("reports", 0), ("threads", []), ("refreshed", None))}
        entry = {"code": code, **act}
        if code in kb["codes"]:
            entry.update(kb["codes"][code])
        out[code] = entry
    log.info("error codes refreshed: %d/%d", refreshed, len(out))
    return {
        "generated": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "discoveredAt": discovered_at,
        "since": since,
        "codes": out,
        "generic": kb["generic"],
    }
