"""Crowd signal: are players reporting the game as down right now?

Blizzard does not announce every outage, and "coming back imminently" does not
mean it is back. New player topics in the Forever and tech-support forums whose
titles say "down / can't log in / BLZ5..." are an independent, fast signal.
"""
from __future__ import annotations

import html
import re
from datetime import datetime, timedelta, timezone

from . import config, forums, net

SUPPORT = {"us": {12, 13, 15, 16, 17, 18, 19}, "eu": {10, 11, 13}}


def categories() -> dict[str, set[int]]:
    """Forever categories (beta ones only while the beta runs) + tech support."""
    in_beta = config.phase() == "beta"
    return {r: {i for i, c in forums.forever_categories(r).items() if in_beta or not c["beta"]} | SUPPORT[r]
            for r in ("us", "eu")}
DOWN = re.compile(
    r"((?:server|realm|beta|game|wow|forever|it|everything)s?\s+(?:is\s+|are\s+)?(?:still\s+)?(?:down|offline)|"
    r"\bdown\s*\?|downtime|offline\?|can'?t (?:log|connect|get in|play)|cannot (?:log|connect)|unable to (?:log|connect)|"
    r"disconnect|\bBLZ5\d{7}\b|\bWOW5\d{7}\b|not working|is (?:the )?(?:beta|game|server) (?:up|down|back))", re.I)
OFFICIAL = re.compile(r"^(?:beta )?(?:realm )?(?:maintenance|restarts?)\b|maintenance\s*-\s*\d|- (?:october|september|november) \d", re.I)
WINDOW_MIN = 120


def fetch(window_min: int = WINDOW_MIN) -> dict:
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=window_min)
    topics = []
    for region, cats in categories().items():
        base = config.FORUM_BASE.format(region=region)
        for page in range(3):
            try:
                d = net.get(f"{base}/latest.json", params={"order": "created", "page": page}, timeout=20, retries=2).json()
            except (RuntimeError, ValueError):
                break
            rows = d.get("topic_list", {}).get("topics", [])
            if not rows:
                break
            for t in rows:
                created = datetime.fromisoformat(t["created_at"].replace("Z", "+00:00"))
                if created < cutoff:
                    continue
                title = html.unescape(t.get("title", ""))
                if t.get("category_id") in cats and DOWN.search(title) and not OFFICIAL.search(title):
                    topics.append({"title": title, "region": region, "created": t["created_at"],
                                   "posts": t.get("posts_count", 1), "url": f"{base}/t/{t.get('slug', 'topic')}/{t['id']}"})
            oldest = min(datetime.fromisoformat(t["created_at"].replace("Z", "+00:00")) for t in rows)
            if oldest < cutoff:
                break
    topics.sort(key=lambda t: t["created"], reverse=True)
    return {"windowMin": window_min, "checked": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "topics": topics[:12]}
