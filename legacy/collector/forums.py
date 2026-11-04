"""Blue posts from the official forums (Discourse) for WoW: Forever categories.

Uses the public Blizzard Tracker group feed. Classifies each topic into
maintenance / hotfix / patch-notes / known-issues / news, and extracts
maintenance windows for the status page.
"""
from __future__ import annotations

import html
import re
from datetime import datetime, timedelta, timezone

from . import config, net

KINDS = [
    ("maintenance", re.compile(r"maintenance|restart|realms? (?:are )?(?:down|offline|up)|downtime", re.I)),
    ("hotfix", re.compile(r"hotfix", re.I)),
    ("patch", re.compile(r"patch notes|beta (?:update|build)|build notes|development notes|class (?:changes|tuning)|tuning", re.I)),
    ("issues", re.compile(r"known issues|bug|issue", re.I)),
]


def classify(title: str) -> str:
    for kind, rx in KINDS:
        if rx.search(title):
            return kind
    return "news"


def _strip(excerpt: str) -> str:
    s = re.sub(r"<[^>]+>", " ", excerpt or "")
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


_CATS: dict[str, dict[int, dict]] = {}
# Fallback if categories.json is unreachable (ids verified 2026-10-22).
_STATIC = {
    "us": {346: ("WoW: Forever", False), 347: ("General Discussion", False), 348: ("Community Connections", False),
           349: ("Beta Discussion", True)},
    "eu": {359: ("WoW: Forever", False), 360: ("General Discussion", False), 361: ("Community Connections", False),
           362: ("Beta Discussion", True)},
}


def forever_categories(region: str) -> dict[int, dict]:
    """All Forever forum categories of a region: {id: {name, beta}}.

    Discovered by slug so categories Blizzard adds at launch (bug reports,
    tech support, ...) are picked up without a code change.
    """
    if region in _CATS:
        return _CATS[region]
    out: dict[int, dict] = {}
    try:
        d = net.get(config.FORUM_BASE.format(region=region) + "/categories.json",
                    params={"include_subcategories": "true"}, timeout=20, retries=2).json()
        for c in d.get("category_list", {}).get("categories", []):
            subs = c.get("subcategory_list") or []
            if "forever" in c.get("slug", ""):
                out[c["id"]] = {"name": c["name"], "beta": "beta" in c["slug"]}
                for sc in subs:
                    out[sc["id"]] = {"name": sc["name"], "beta": "beta" in sc.get("slug", "")}
            else:
                for sc in subs:
                    if "forever" in sc.get("slug", ""):
                        out[sc["id"]] = {"name": sc["name"], "beta": "beta" in sc.get("slug", "")}
    except (RuntimeError, ValueError):
        out = {}
    if not out:
        out = {k: {"name": n, "beta": b} for k, (n, b) in _STATIC[region].items()}
    for c in out.values():  # "World of Warcraft: Forever General Discussion" -> "General Discussion"
        c["name"] = re.sub(r"^(?:World of Warcraft:?|WoW:?)\s*Forever\s*", "", c["name"]).strip() or c["name"]
    _CATS[region] = out
    return out


def fetch_tracker(region: str = "us", days: int | None = None) -> list[dict]:
    """Blue posts in Forever categories, newest first, across pages."""
    days = days or config.FORUM_HISTORY_DAYS
    base = config.FORUM_BASE.format(region=region)
    url = config.FORUM_TRACKER.format(region=region)
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    posts: list[dict] = []
    cats = forever_categories(region)
    before = None
    for _ in range(40):  # 20 posts per page
        params = {"before_post_id": before} if before else None
        page = net.get(url, params=params, timeout=30).json().get("posts", [])
        if not page:
            break
        for p in page:
            created = datetime.fromisoformat(p["created_at"].replace("Z", "+00:00"))
            if p.get("category_id") in cats:
                posts.append({
                    "id": p["id"],
                    "topic": p["topic_id"],
                    "title": html.unescape(p.get("topic_title") or ""),
                    "author": p.get("name") or p.get("username"),
                    "category": cats[p["category_id"]]["name"],
                    "beta": cats[p["category_id"]]["beta"],
                    "categoryId": p["category_id"],
                    "created": p["created_at"],
                    "excerpt": _strip(p.get("excerpt", ""))[:600],
                    "url": f"{base}/t/{p.get('topic_slug', 'topic')}/{p['topic_id']}/{p.get('post_number', 1)}",
                    "region": region,
                })
        before = page[-1]["id"]
        if datetime.fromisoformat(page[-1]["created_at"].replace("Z", "+00:00")) < cutoff:
            break
    return posts


def topics(posts: list[dict]) -> list[dict]:
    """Group blue posts by topic -> one feed entry per topic."""
    by: dict[int, dict] = {}
    for p in sorted(posts, key=lambda p: p["created"]):
        t = by.get(p["topic"])
        if t is None:
            t = by[p["topic"]] = {
                "topic": p["topic"], "title": p["title"], "kind": classify(p["title"]),
                "category": p["category"], "beta": p.get("beta", False), "first": p["created"], "last": p["created"],
                "authors": [], "excerpt": p["excerpt"], "url": p["url"].rsplit("/", 1)[0], "posts": 0,
                "region": p["region"],
            }
        t["last"] = p["created"]
        t["posts"] += 1
        t.setdefault("blue", []).append({"created": p["created"], "text": p["excerpt"]})
        if p["author"] not in t["authors"]:
            t["authors"].append(p["author"])
        if not t["excerpt"] and p["excerpt"]:
            t["excerpt"] = p["excerpt"]
    return sorted(by.values(), key=lambda t: t["last"], reverse=True)


_TIME = re.compile(
    r"(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\s*(PDT|PST|PT|CEST|CET|UTC)?", re.I)
_TZ = {"PDT": -7, "PT": -7, "PST": -8, "CEST": 2, "CET": 1, "UTC": 0}
_RELATIVE = re.compile(r"(?:in|about)\s+(\d+|a few|one|an)\s+(minutes?|hours?)", re.I)


def _to_utc(m: re.Match, ann: datetime, text: str) -> datetime:
    hour = int(m.group(1)) % 12 + (12 if m.group(3).lower().startswith("p") else 0)
    minute = int(m.group(2) or 0)
    tz = _TZ.get((m.group(4) or "PDT").upper(), -7)
    local_ann = ann + timedelta(hours=tz)
    t = local_ann.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if "tomorrow" in text.lower()[max(0, m.start() - 80): m.start() + 40]:
        t += timedelta(days=1)
    elif t < local_ann - timedelta(hours=2):
        t += timedelta(days=1)
    return t - timedelta(hours=tz)


def _iso(d: datetime) -> str:
    return d.strftime("%Y-%m-%dT%H:%M:%SZ")


_END_CTX = re.compile(r"(?:back online|back up|reopen|re-open|available again|online)\s+(?:by|at|around|until)\s+(?:approximately\s+)?$", re.I)
# A post that says realms ARE back (confirmation) vs. WILL BE back soon (promise).
_PROMISE = re.compile(
    r"(coming back|will be back|should be back|be back (?:up|online)|bring(?:ing)? .{0,30}back|"
    r"(?:imminently|shortly|soon|in a few minutes|momentarily)|expect)", re.I)
_REOPENED = re.compile(
    r"(realms? (?:are|is) (?:now )?(?:back )?(?:up|open|online|available)|(?:is|are) (?:now )?back (?:up|online)|"
    r"beta is (?:now )?(?:open|available|back)|maintenance (?:is |has )?(?:now )?(?:complete|over|finished|ended)|"
    r"should (?:now )?be able to (?:log ?in|connect|play))", re.I)


def _start_time(text: str, announced: str) -> str | None:
    """Best-effort UTC start time of a maintenance from its announcement text."""
    ann = datetime.fromisoformat(announced.replace("Z", "+00:00"))
    for m in _TIME.finditer(text):
        if _END_CTX.search(text[max(0, m.start() - 60): m.start()]):
            continue  # that time is the expected end, not the start
        return _iso(_to_utc(m, ann, text))
    r = _RELATIVE.search(text)
    if r:
        n = {"a few": 5, "one": 1, "an": 1}.get(r.group(1).lower(), None) or int(r.group(1))
        delta = timedelta(hours=n) if r.group(2).lower().startswith("hour") else timedelta(minutes=n)
        return _iso(ann + delta)
    if re.search(r"(?:in|within) (?:the next )?a? ?few minutes|shortly|underway|now", text, re.I):
        return _iso(ann + timedelta(minutes=10))
    return None


def _end_time(text: str, announced: str) -> str | None:
    """Expected end, e.g. '...bring realms back online by 3:00 p.m. PDT'."""
    ann = datetime.fromisoformat(announced.replace("Z", "+00:00"))
    for m in _TIME.finditer(text):
        if _END_CTX.search(text[max(0, m.start() - 60): m.start()]):
            return _iso(_to_utc(m, ann, text))
    return None


def blue_posts_in_topic(url: str) -> list[dict]:
    """Full text of Blizzard-staff posts in one topic (topic JSON)."""
    try:
        d = net.get(url.rstrip("/") + ".json", timeout=30).json()
    except RuntimeError:
        return []
    out = []
    for p in d.get("post_stream", {}).get("posts", []):
        if p.get("post_number") == 1 or p.get("primary_group_name") or p.get("user_title") in ("Community Manager", "Blizzard"):
            if p.get("post_number") != 1 and not (p.get("primary_group_name") or "").lower().startswith(("community", "blizz")):
                continue
            out.append({"created": p["created_at"], "text": _strip(p.get("cooked", ""))})
    return out


_DATE_WORDS = re.compile(r"\b(?:\d{1,2}(?:st|nd|rd|th)?|jan\w*|feb\w*|mar\w*|apr\w*|may|jun\w*|jul\w*|aug\w*|sep\w*|sept|oct\w*|nov\w*|dec\w*|evening of)\b\.?", re.I)


def same_event_key(title: str) -> str:
    """'Beta Maintenance - October 14' and '... - 14 October' -> same key."""
    return re.sub(r"[^a-z]+", " ", _DATE_WORDS.sub(" ", title.lower())).strip()


def dedupe_regions(items: list[dict], when: str, window_h: float = 3) -> list[dict]:
    """Blizzard posts the same notice on the US and EU forums; keep one (US first)."""
    kept: list[dict] = []
    for it in sorted(items, key=lambda x: (x.get("region", "us") != "us", x.get(when) or "")):
        t = datetime.fromisoformat(it[when].replace("Z", "+00:00")) if it.get(when) else None
        dup = next((k for k in kept if same_event_key(k["title"]) == same_event_key(it["title"]) and t and k.get(when)
                    and abs((datetime.fromisoformat(k[when].replace("Z", "+00:00")) - t).total_seconds()) < window_h * 3600), None)
        if dup is None:
            kept.append(it)
        elif it.get("region") and it["region"] not in dup.setdefault("regions", [dup.get("region", "us")]):
            dup["regions"].append(it["region"])
            # a confirmation seen only in one region still counts
            for f in ("reopened", "reopening", "end"):
                if not dup.get(f) and it.get(f):
                    dup[f] = it[f]
    return sorted(kept, key=lambda x: x.get(when) or "", reverse=True)


def maintenance_windows(topic_list: list[dict], fetch_days: int = 10) -> list[dict]:
    """Maintenance topics with start / expected end / reopened times."""
    out = []
    now = datetime.now(timezone.utc)
    for t in topic_list:
        if t["kind"] != "maintenance":
            continue
        first_text, start, end, reopened, reopening = t["excerpt"], None, None, None, None
        recent = now - datetime.fromisoformat(t["first"].replace("Z", "+00:00")) < timedelta(days=fetch_days)
        # Topic JSON gives the full opening post (but only the first ~20 replies);
        # the tracker feed gives every later blue reply. Merge both.
        posts = {p["created"][:19]: p for p in (blue_posts_in_topic(t["url"]) if recent else [])}
        for p in t.get("blue", []):
            posts.setdefault(p["created"][:19], p)
        posts = sorted(posts.values(), key=lambda p: p["created"])
        announced = posts[0]["created"] if posts else t["first"]
        if posts:
            first_text = posts[0]["text"]
            for p in posts[1:]:
                if _REOPENED.search(p["text"]) and not _PROMISE.search(p["text"]):
                    reopened = p["created"]
                elif re.search(r"back (?:up|online)|coming back|reopen", p["text"], re.I):
                    reopening = p["created"]  # promised, not confirmed
        start = _start_time(first_text, announced)
        end = _end_time(first_text, announced)
        out.append({
            "title": t["title"], "announced": announced, "url": t["url"], "region": t.get("region", "us"),
            "start": start, "end": end, "reopened": reopened, "reopening": reopening,
            "excerpt": first_text[:240],
        })
    return dedupe_regions(out, "announced")
