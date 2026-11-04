"""Blizzard's class notes, split by class and talent tree, checked against the client.

Blizzard announces talent changes in forum posts ("WoW Forever Beta Development
Notes – Updated November 2") before they reach the client files the calculator is
built from. This module finds the latest such post, splits its "Classes" section
into class / tree / item, and for every item that names a talent decides whether
the current client already has it:

    done     the client matches the note (new talent exists, removed one is gone,
             row / rank count / numbers match)
    pending  the client still has the old state
    unknown  the note is not about a talent we can check (spells, bug fixes, wording)

    python -m collector notes        -> web/data/notes.json
"""
from __future__ import annotations

import html
import logging
import re
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser

from . import config, forums, net, ribbit

log = logging.getLogger(__name__)

CLASS_TOKENS = {
    "warrior": "WARRIOR", "paladin": "PALADIN", "hunter": "HUNTER", "rogue": "ROGUE", "priest": "PRIEST",
    "shaman": "SHAMAN", "mage": "MAGE", "warlock": "WARLOCK", "druid": "DRUID",
}
# How Blizzard titles the posts that carry class changes.
NOTES_TITLE = re.compile(r"development notes|patch notes|class (?:changes|tuning)|hotfix", re.I)


# ---------------------------------------------------------------- HTML -> tree of list items
class _ListTree(HTMLParser):
    """Turns nested <ul><li> markup into {text, head, kids} nodes ('head' = the <strong> label)."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = {"text": "", "head": "", "kids": []}
        self.stack = [self.root]
        self.in_strong = 0

    def handle_starttag(self, tag, attrs):
        if tag == "li":
            node = {"text": "", "head": "", "kids": []}
            self.stack[-1]["kids"].append(node)
            self.stack.append(node)
        elif tag == "strong":
            self.in_strong += 1

    def handle_endtag(self, tag):
        if tag == "li" and len(self.stack) > 1:
            n = self.stack.pop()
            n["text"] = _clean(n["text"])
            n["head"] = _clean(n["head"])
        elif tag == "strong":
            self.in_strong = max(0, self.in_strong - 1)

    def handle_data(self, data):
        if len(self.stack) == 1:
            return
        top = self.stack[-1]
        # only text that belongs to this <li> itself, not to a nested list
        top["text"] += data
        if self.in_strong:
            top["head"] += data


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def parse_classes(cooked: str) -> dict:
    """{TOKEN: {"general": [text], "tabs": {tree name: [text]}}} from a post's HTML."""
    p = _ListTree()
    p.feed(cooked)
    out: dict = {}

    def walk(nodes):
        for n in nodes:
            tok = CLASS_TOKENS.get(n["head"].strip().lower())
            if tok and n["kids"]:
                cls = out.setdefault(tok, {"general": [], "tabs": {}})
                for it in n["kids"]:
                    if it["kids"] and it["head"]:          # a talent tree: "Assassination"
                        cls["tabs"].setdefault(it["head"], []).extend(_flatten(it["kids"]))
                    else:
                        cls["general"].extend(_flatten([it]))
            else:
                walk(n["kids"])

    walk(p.root["kids"])
    return out


def _flatten(nodes) -> list[str]:
    out = []
    for n in nodes:
        own = n["text"]
        # the text of a node includes its children's text only if markup was odd; keep own text short
        if own:
            out.append(own)
        if n["kids"] and not n["head"]:
            out.extend(_flatten(n["kids"]))
    return out


# ---------------------------------------------------------------- finding the post
def latest_post(topics: list[dict], max_age_days: int = 30) -> dict | None:
    """The newest Blizzard post with a Classes section among recent notes topics."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=max_age_days)).isoformat()
    cands = [t for t in topics if NOTES_TITLE.search(t["title"]) and (t.get("last") or "") >= cutoff]
    best = None
    for t in sorted(cands, key=lambda x: x.get("last") or "", reverse=True)[:4]:
        try:
            posts = thread_posts(t["url"])
        except Exception as e:  # noqa: BLE001
            log.warning("notes: %s: %s", t["url"], e)
            continue
        for p in posts:
            if not p.get("staff") and p.get("user_title") != "Blizzard" and not p.get("admin") and not p.get("moderator"):
                continue
            if "<strong>Classes</strong>" not in p["cooked"] and not re.search(r"<strong>(Rogue|Mage|Warrior|Druid)</strong>", p["cooked"]):
                continue
            stamp = p.get("updated_at") or p["created_at"]
            if best is None or p["created_at"] > best["created_at"]:
                topic = re.sub(r"/\d+$", "", t["url"].rstrip("/")) if re.search(r"/t/[^/]+/\d+/\d+$", t["url"]) else t["url"].rstrip("/")
                best = {**p, "topic_title": t["title"], "url": f"{topic}/{p['post_number']}", "stamp": stamp}
    return best


def thread_posts(url: str) -> list[dict]:
    m = re.match(r"(https://[^/]+/[^/]+/[^/]+)/t/(?:[^/]+/)?(\d+)", url)
    base = f"{m.group(1)}/t/{m.group(2)}"
    t = net.get(base + ".json").json()
    ids = t["post_stream"]["stream"]
    posts = []
    for i in range(0, len(ids), 20):
        chunk = ids[i:i + 20]
        q = "&".join(f"post_ids[]={x}" for x in chunk)
        posts += net.get(f"{base}/posts.json?{q}").json()["post_stream"]["posts"]
    return posts


# ---------------------------------------------------------------- checking against the client
_WAS = re.compile(r"\((?:was|Was)[^)]*\)")
_NUM = re.compile(r"\d+(?:\.\d+)?")


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.replace("’", "'").replace("‘", "'")).strip().lower()


def _talents(cls: dict) -> dict[str, dict]:
    out = {}
    for ti, tb in enumerate(cls["tabs"]):
        for x in tb["talents"]:
            out[_norm(x["name"])] = {**x, "tab": ti}
    return out


def _find(name: str, M: dict) -> dict | None:
    return M.get(_norm(name.strip(" .:\"“”")))


def _mentioned(text: str, M: dict) -> dict | None:
    """The talent a note is about: the longest talent name the note starts with, else contains."""
    low = _norm(text)
    best = None
    for nm, x in M.items():
        if low.startswith(nm) and (best is None or len(nm) > len(best[0])):
            best = (nm, x)
    if best:
        return best[1]
    for nm, x in sorted(M.items(), key=lambda kv: -len(kv[0])):
        if len(nm) > 5 and re.search(r"\b" + re.escape(nm) + r"\b", low):
            return x
    return None


def check(text: str, M: dict) -> dict:
    """Status of one note against the client's talents of that class."""
    t = text.replace("’", "'")
    # "Name: Renamed New." / "Old renamed to New"
    m = re.match(r"(.+?):\s*(?i:renamed)\s+(?:to\s+)?([A-Z][\w']*(?:\s(?:[A-Z][\w']*|of|the|de|and(?=\s[A-Z])))*)", t)
    if m:
        new, old = _find(m.group(2), M), _find(m.group(1), M)
        if new:
            return {"s": "done", "id": new["id"]}
        return {"s": "pending", "id": old["id"], "why": "name"} if old else {"s": "unknown"}
    m = (re.search(r"new talent(?: in [^:]*)?:\s*([^.]+?)\.(?:\s|$)", t, re.I)
         or re.search(r"new talent added to row \d+,\s*([A-Z][\w' ]+?)\s+-", t, re.I)
         or re.search(r"new talent\s+([A-Z][\w' ]+?)\s+(?:added to|in) row", t, re.I))
    if m:
        x = _find(m.group(1), M)
        row = re.search(r"row (\d+)", t, re.I)
        if not x:
            return {"s": "pending", "why": "missing"}
        if row and x["row"] + 1 != int(row.group(1)):
            return {"s": "pending", "id": x["id"], "why": "row"}
        return {"s": "done", "id": x["id"]}
    m = re.match(r"(?:new talent in [^:]+:\s*)?(.+?) (?:has been |have been |is |)removed\b", t, re.I)
    if m and len(m.group(1)) < 50:
        x = _find(m.group(1), M)
        return {"s": "pending", "id": x["id"], "why": "still"} if x else {"s": "done"}
    m = (re.match(r"(.+?) (?:has been |have been |)(?:moved|move) to row (\d+)", t, re.I)
         or re.match(r"(.+?) (?:has been |have been |)(?:moved|move) to (?:the )?(\d)(?:st|nd|rd|th) row", t, re.I))
    if m:
        x = _find(m.group(1), M)
        if not x:
            return {"s": "unknown"}
        return {"s": "done" if x["row"] + 1 == int(m.group(2)) else "pending", "id": x["id"], **({} if x["row"] + 1 == int(m.group(2)) else {"why": "row"})}
    m = re.match(r"(.+?) (?:has been |)renamed\s+(?:to\s+)?([A-Z][\w']*(?:\s(?:[A-Z][\w']*|of|the|de|and(?=\s[A-Z])))*)", t)
    if m:
        new, old = _find(m.group(2), M), _find(m.group(1), M)
        if new:
            return {"s": "done", "id": new["id"]}
        return {"s": "pending", "id": old["id"], "why": "name"} if old else {"s": "unknown"}
    x = _mentioned(t, M)
    if not x:
        return {"s": "unknown"}
    m = (re.search(r"chang(?:ed|es|e) to (?:a |an )?(\d+)[- ]point talent", t, re.I)
         or re.search(r"(?:maximum of|up to) (\d+) talent points", t, re.I))
    if m:
        ok = x["max"] == int(m.group(1))
        return {"s": "done" if ok else "pending", "id": x["id"], **({} if ok else {"why": "ranks"})}
    # Numbers: the note's new values vs the "(was ...)" values, looked up in the talent's text.
    def nums(part):
        return {n for n in _NUM.findall(part) if not re.search(r"row\s*" + re.escape(n) + r"\b", part, re.I)}
    was = nums(" ".join(_WAS.findall(t)))
    new = nums(_WAS.sub("", t))
    meta = " ".join(str(v) for v in (x.get("meta") or {}).values() if isinstance(v, (str, int, float)))
    have = set(_NUM.findall(" ".join(x["ranks"]) + " " + meta))
    only_new, only_was = new - was, was - new
    if only_new:
        miss = [n for n in only_new if n not in have]
        weak = not was and "%" not in t and all(float(n) < 10 for n in only_new)
        if not miss:
            # a lone small number ("within 7 seconds") is too likely to be in the old text already
            return {"s": "unknown" if weak else "done", "id": x["id"]}
        if not only_was or any(n in have for n in only_was) or len(miss) == len(only_new):
            return {"s": "pending", "id": x["id"], "why": "numbers"}
    elif only_was and any(n in have for n in only_was):
        return {"s": "pending", "id": x["id"], "why": "numbers"}
    return {"s": "unknown", "id": x["id"]}


_ROW = re.compile(r"\brow (\d+)|\b(\d)(?:st|nd|rd|th) row", re.I)
_POINTS = re.compile(r"(\d+)[- ]point talent|maximum of (\d+) talent points|up to (\d+) talent points", re.I)
_RENAME = re.compile(r"(?i:renamed)\s+(?:(?i:to)\s+)?([A-Z][\w']*(?:\s(?:[A-Z][\w']*|of|the|de|and(?=\s[A-Z])))*)")


def _first_int(m: re.Match | None) -> int | None:
    return next((int(g) for g in m.groups() if g), None) if m else None


def preview_ops(text: str, res: dict, M: dict) -> list[dict]:
    """How the tree would change if this (pending) note were applied: the input for the
    calculator's "preview by the notes" mode. Positions/ranks only where the note states them."""
    if res.get("s") != "pending":
        return []
    t = text.replace("’", "'")
    if res.get("why") == "missing":
        m = (re.search(r"new talent(?: in [^:]*)?:\s*([^.]+?)\.(?:\s|$)", t, re.I)
             or re.search(r"new talent added to row \d+,\s*([A-Z][\w' ]+?)\s+-", t, re.I)
             or re.search(r"new talent\s+([A-Z][\w' ]+?)\s+(?:added to|in) row", t, re.I))
        if not m:
            return []
        name = m.group(1).strip()
        op = {"k": "add", "name": name, "row": _first_int(_ROW.search(t)), "max": _first_int(_POINTS.search(t)) or 1,
              "passive": bool(re.search(r"\bpassive\b", t, re.I))}
        slot = re.search(r"in (.+?)'s slot", t, re.I)
        if slot and _find(slot.group(1), M):
            sx = _find(slot.group(1), M)
            op.update(row=op["row"] or sx["row"] + 1, slot=sx["id"])
        # the effect: what follows the "New Talent: X. Passive. 2-point talent in Row 4." header
        desc = t[m.end():] if m.re.pattern.startswith("new talent(?: in") else t
        desc = re.sub(r"^\s*(?:(?:Passive|Active)\s*[.-]\s*|\d+[- ]point talent in row \d+\.\s*|in row \d+\.\s*|added to row \d+[.,]?\s*)+", "", desc, flags=re.I)
        op["desc"] = desc.strip() or t
        return [op] if op["row"] else []
    if not res.get("id"):
        return []
    x = next((v for v in M.values() if v["id"] == res["id"]), None)
    if not x:
        return []
    if res.get("why") == "still":
        return [{"k": "remove", "id": x["id"]}]
    ops = []
    mv = re.search(r"mov(?:ed|e)\s+to\s+(?:the\s+)?(?:row (\d+)|(\d)(?:st|nd|rd|th) row)", t, re.I)
    row = _first_int(mv) or (_first_int(_ROW.search(t)) if res.get("why") == "row" else None)
    if row and row != x["row"] + 1 and not re.search(r"of the \w+ tree|to \w+\.$", t):
        ops.append({"k": "move", "id": x["id"], "row": row})
    pts = _first_int(_POINTS.search(_WAS.sub("", t)))
    if pts and pts != x["max"]:
        ops.append({"k": "ranks", "id": x["id"], "max": pts})
    rn = _RENAME.search(t)
    if rn and _norm(rn.group(1)) != _norm(x["name"]):
        ops.append({"k": "rename", "id": x["id"], "name": rn.group(1).strip()})
    if res.get("why") in ("numbers", "ranks") or not ops:
        ops.append({"k": "text", "id": x["id"]})
    return ops


def build_notes(post: dict, ds_en: dict) -> dict:
    parsed = parse_classes(post["cooked"])
    classes = {c["token"]: c for c in ds_en["classes"]}
    out = {}
    for tok, sec in parsed.items():
        c = classes.get(tok)
        if not c:
            continue
        M = _talents(c)
        tab_of = {_norm(tb["name"]): i for i, tb in enumerate(c["tabs"])}
        entry = {"general": [], "tabs": [[] for _ in c["tabs"]], "other": []}
        def item(text):
            res = check(text, M)
            ops = preview_ops(text, res, M)
            return {"t": text, **res, **({"ops": ops} if ops else {})}
        for text in sec["general"]:
            entry["general"].append(item(text))
        for name, items in sec["tabs"].items():
            ti = tab_of.get(_norm(name))
            if ti is None:  # "Feral" in the notes, "Feral Combat" in the client
                ti = next((i for nm, i in tab_of.items() if nm.startswith(_norm(name)) or _norm(name).startswith(nm)), None)
            rows = [item(text) for text in items]
            if ti is None:
                entry["other"].append({"name": name, "items": rows})
            else:
                entry["tabs"][ti].extend(rows)
        out[tok] = entry
    count = lambda s: sum(1 for e in out.values() for it in e["general"] + [r for tb in e["tabs"] for r in tb] if it["s"] == s)
    return {
        "generated": ribbit.now_iso(),
        "build": ds_en["build"],
        "source": {"title": post["topic_title"], "url": post["url"], "posted": post["created_at"], "updated": post.get("updated_at"),
                   "author": post.get("username")},
        "summary": {"done": count("done"), "pending": count("pending"), "unknown": count("unknown")},
        "classes": out,
    }


def update(ds_en: dict, topics: list[dict] | None = None) -> dict | None:
    if topics is None:
        posts = []
        for region in ("us",):
            try:
                posts += forums.fetch_tracker(region)
            except RuntimeError as e:
                log.warning("notes: tracker %s: %s", region, e)
        topics = forums.topics(posts)
    post = latest_post(topics)
    if not post:
        return None
    return build_notes(post, ds_en)
