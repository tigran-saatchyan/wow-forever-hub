"""A character's dungeons and raids: which ones Forever has (ForeverDB: levels, bosses, the new Forever
dungeons), how often the character has killed their last boss (Blizzard's statistics: the encounter lists of
the profile API are empty on Forever, the "Dungeons & Raids / Boss kills" statistics are not), and what in each
would be an upgrade over what the character wears (the original game's loot tables, ForeverDB's notable loot for
the dungeons Forever added).
"""

from __future__ import annotations

import json
import logging
import re
from functools import lru_cache

from . import bis, item_sources
from .foreverdb import client as fdb

log = logging.getLogger("uvicorn.error")
KILLS = re.compile(r"^(.*?) kills \((.*)\)$", re.I)  # "Bazzalan kills (Ragefire Chasm)"
KILLS_RU = re.compile(r"^Убийства (.*?) \((.*)\)$")


def norm(s: str | None) -> str:
    return re.sub(r"^the\s+", "", re.sub(r"[^a-z0-9' ]", "", (s or "").lower())).strip()


@lru_cache(maxsize=1)
def snapshot() -> list[dict]:
    """The list the hub ships (tools/build_dungeons.py): ForeverDB's dungeons with level ranges, bosses and notable
    loot, Russian names and the dungeons only Forever's files hold. The tab stands on it when ForeverDB can't answer."""
    p = item_sources.DATA / "dungeons.json"
    xs = json.loads(p.read_text("utf-8"))["dungeons"] if p.is_file() else []
    return [{**x, "id": x["id"] if x.get("id") is not None else -(n + 1)} for n, x in enumerate(xs)]


async def catalog() -> list[dict]:
    """The shipped list, brought up to date by ForeverDB's live answers when it gives them (cached a month by
    build): new level ranges, bosses, notable loot, a dungeon announced since."""
    base = [dict(x) for x in snapshot()]
    c = fdb()
    if not c.configured:
        return base
    by_id = {x["id"]: x for x in base}
    for x in await c.pages("dungeons", ttl_days=30):
        if x.get("status") == "other":
            continue
        try:
            d = (await c.get(f"dungeons/{x['id']}", ttl_days=30)).get("data") or x
        except Exception:  # noqa: BLE001 - the shipped copy of this one stays
            log.exception("foreverdb dungeon %s", x.get("id"))
            continue
        row = by_id.get(d["id"])
        if row is None:
            row = {"id": d["id"], "en": d["name"], "ru": d["name"], "kind": d.get("kind") or "dungeon", "new": True}
            base.append(row)
            by_id[d["id"]] = row
        row.update({"players": d.get("players"), "levels": d.get("levelRange") or row.get("levels"),
                    "new": bool(d.get("newInForever")), "open": bool(d.get("announced")),
                    "bosses": d.get("bosses") or row.get("bosses") or [],
                    "notableLoot": d.get("notableLoot") or row.get("notableLoot") or [], "url": d.get("url") or row.get("url")})
    return base


def kills(stats_en: dict, stats_local: dict) -> list[dict]:
    """Boss kills from the statistics: boss and instance, in English (to match) and the page's language."""
    local = {}
    for g in stats_local.get("categories") or []:
        for st in _all_stats(g):
            local[st.get("id")] = st.get("name")
    out = []
    for g in stats_en.get("categories") or []:
        for st in _all_stats(g):
            m = KILLS.match(st.get("name") or "")
            if not m:
                continue
            ml = KILLS_RU.match(local.get(st.get("id")) or "") or None
            out.append({"boss": m.group(1), "instance": m.group(2), "kills": int(st.get("quantity") or 0),
                        "bossLocal": ml.group(1) if ml else None, "instanceLocal": ml.group(2) if ml else None})
    return out


def _all_stats(c: dict):
    yield from (x for x in c.get("statistics") or [] if isinstance(x, dict))
    for sc in c.get("sub_categories") or []:
        yield from _all_stats(sc)


def stat_value(stats: dict, name_en: str) -> int | None:
    for g in stats.get("categories") or []:
        for st in _all_stats(g):
            if st.get("name") == name_en:
                return int(st.get("quantity") or 0)
    return None


@lru_cache(maxsize=1)
def _by_instance() -> dict[int, list[tuple[int, int, float]]]:
    """Map id -> (item, creature, chance) of the items its creatures drop (no world drops)."""
    loot = item_sources._loot()
    out: dict[int, list] = {}
    for item, x in loot["items"].items():
        if x.get("world"):
            continue
        for entry, chance in x["d"]:
            mp = (loot["creatures"].get(str(entry)) or {}).get("map")
            if mp in item_sources.INSTANCES:
                out.setdefault(mp, []).append((int(item), entry, chance))
    return out


def upgrades(instance_id: int, notable: list[dict], gear: dict, cls: int, level: int, faction: str | None,
             w: dict, worn: dict[str, float], lang: str, ahead: int = 5, spec: str = "") -> list[dict]:
    """Items of the instance better than what is worn (by the specialization's weights), best first: usable now
    or within `ahead` levels."""
    seen: dict[int, dict] = {}
    cands = [(i, e, ch) for i, e, ch in _by_instance().get(instance_id, [])]
    cands += [(int(n["itemId"]), None, None) for n in notable or [] if n.get("itemId")]
    for item, entry, chance in cands:
        it = gear.get(str(item))
        if not it or item in seen or not bis.usable(it, cls, level + ahead, faction):
            continue
        best = None
        for slot in bis.SLOTS:
            if not bis.fits(it, slot, cls, spec):
                continue
            base = worn.get(slot, 0.0)
            if it["slot"] == 17:  # a two-hander takes the off hand's place too
                base += worn.get("OFF_HAND", 0.0)
            sc = bis.score(it, w, slot)
            gain = (sc - base) / base * 100 if base > 0 else (float("inf") if sc > 0 else 0)
            if sc > base and (best is None or gain > best[1]):
                best = (slot, gain)
        if not best:
            continue
        boss = (item_sources._loot()["creatures"].get(str(entry)) or {}) if entry else {}
        seen[item] = {"id": item, "name": it.get(lang) or it["en"], "q": it["q"], "req": it["req"], "slot": best[0],
                      "gain": None if best[1] == float("inf") else round(best[1], 1),
                      "boss": (boss.get("ru") if lang == "ru" else boss.get("en")) if boss else None,
                      "bossEn": boss.get("en") if boss else None,
                      "chance": chance}
    return sorted(seen.values(), key=lambda x: -(x["gain"] if x["gain"] is not None else 1e9))


@lru_cache(maxsize=1)
def _creature_names() -> dict[str, str]:
    """English creature name -> Russian, from the loot tables' creatures (bosses among them)."""
    return {norm(c["en"]): c.get("ru") or c["en"] for c in item_sources._loot()["creatures"].values() if c.get("en")}


def boss_name(en: str, lang: str) -> str:
    if lang != "ru":
        return en
    return (_models().get(norm(en)) or {}).get("ru") or _creature_names().get(norm(en), en)


@lru_cache(maxsize=1)
def _models() -> dict[str, dict]:
    p = item_sources.DATA / "boss_models.json"
    return json.loads(p.read_text("utf-8")) if p.is_file() else {}


def boss_model(en: str) -> int | None:
    """The display id of a boss's model (tools/build_boss_models.py), for its portrait; none for Forever's new bosses."""
    return (_models().get(norm(en)) or {}).get("m")


def bis_here(instance_id: int, notable: list[dict], bis_ids: dict[int, tuple], gear: dict, lang: str) -> list[dict]:
    """The character's BiS items (top three of a slot for its level) that drop in the instance, with the boss."""
    out, seen = [], set()
    cands = [(i, e) for i, e, _ in _by_instance().get(instance_id, [])] + [(int(n["itemId"]), None) for n in notable or [] if n.get("itemId")]
    for item, entry in cands:
        if item in seen or item not in bis_ids:
            continue
        seen.add(item)
        slot, rank, worn = bis_ids[item]
        it = gear.get(str(item)) or {}
        boss = (item_sources._loot()["creatures"].get(str(entry)) or {}) if entry else {}
        out.append({"id": item, "name": it.get(lang) or it.get("en") or f"#{item}", "q": it.get("q", 3), "slot": slot,
                    "rank": rank, "worn": worn, "bossEn": boss.get("en"),
                    "boss": (boss.get("ru") if lang == "ru" else boss.get("en")) if boss else None})
    return sorted(out, key=lambda x: (x["worn"], x["rank"]))
