"""The BiS reference's second half, from ForeverDB: the wearable items Blizzard's item API does not know (the
client keeps them hidden, the server sends them to the game: thousands of greens and blues), and ForeverDB's word
on which items are really in the game (`speculation`, `betaEvent`).

A background job (sync) walks ForeverDB's item lists (weapons and armor, uncommon to epic), asks for the details of
the items the reference lacks, a few a minute within the hub's ForeverDB share, and keeps the result in the
database ("gear:extra"). Everything is cached per game build (app/foreverdb.py), so a restart or the next day
picks up where it stopped, and a new build refreshes it. bis.gear() merges it with backend/app/data/gear.json.
"""

from __future__ import annotations

import asyncio
import logging
import re

import httpx

from . import foreverdb
from .db import FdbCache, SessionLocal, utcnow

log = logging.getLogger("uvicorn.error")
KEY = "gear:extra"
WEARABLE = {1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 20, 21, 22, 23, 25, 26}
# ForeverDB's statId (the game's item stat types) -> the names the reference uses (Blizzard API's)
STATS = {
    3: "AGILITY", 4: "STRENGTH", 5: "INTELLECT", 6: "SPIRIT", 7: "STAMINA", 12: "DEFENSE_SKILL_RATING",
    13: "DODGE_RATING", 14: "PARRY_RATING", 15: "BLOCK_RATING", 16: "HIT_RATING", 17: "HIT_RATING", 18: "HIT_RATING",
    19: "CRIT_RATING", 20: "CRIT_RATING", 21: "CRIT_RATING", 28: "HASTE_RATING", 29: "HASTE_RATING", 30: "HASTE_RATING",
    31: "HIT_RATING", 32: "CRIT_RATING", 36: "HASTE_RATING", 37: "EXPERTISE_RATING", 38: "ATTACK_POWER",
    39: "RANGED_ATTACK_POWER", 41: "SPELL_HEALING_DONE", 42: "SPELL_DAMAGE_DONE", 43: "MANA_REGENERATION",
    45: "SPELL_POWER", 47: "SPELL_PENETRATION", 48: "BLOCK_VALUE", 50: "EXTRA_ARMOR", 51: "FIRE_RESISTANCE",
    52: "FROST_RESISTANCE", 53: "HOLY_RESISTANCE", 54: "SHADOW_RESISTANCE", 55: "NATURE_RESISTANCE",
    56: "ARCANE_RESISTANCE",
    # damage done by one school: 86 Nature, 87 Frost and 88 Shadow seen on items; the rest follow the game's school
    # order (holy, fire, nature, frost, shadow, arcane) from the same base
    84: "BONUS_STAT_HOLY_DAMAGE_DONE", 85: "BONUS_STAT_FIRE_DAMAGE_DONE", 86: "BONUS_STAT_NATURE_DAMAGE_DONE",
    87: "BONUS_STAT_FROST_DAMAGE_DONE", 88: "BONUS_STAT_SHADOW_DAMAGE_DONE", 89: "BONUS_STAT_ARCANE_DAMAGE_DONE",
}
VERSION = 3  # 3: the icon kept for tooltips; bump when convert() learns something: the items already kept are converted again from the cache

INVISIBLE = re.compile("[\u200b-\u200f\u2060-\u2064\ufeff]")
SCHOOL = {"holy": "BONUS_STAT_HOLY_DAMAGE_DONE", "fire": "BONUS_STAT_FIRE_DAMAGE_DONE",
          "nature": "BONUS_STAT_NATURE_DAMAGE_DONE", "frost": "BONUS_STAT_FROST_DAMAGE_DONE",
          "shadow": "BONUS_STAT_SHADOW_DAMAGE_DONE", "arcane": "BONUS_STAT_ARCANE_DAMAGE_DONE"}
# an equip effect's words -> the stat it is (ForeverDB lists some items' spell power only as such a text)
EQUIP = [
    (re.compile(r"Increases damage and healing done by magical spells and effects by up to (\d+)", re.I), "SPELL_POWER", 1),
    (re.compile(r"Increases healing done by (?:magical )?spells and effects by up to (\d+)", re.I), "SPELL_HEALING_DONE", 1),
    (re.compile(r"Increases damage done by (\w+) spells and effects by up to (\d+)", re.I), "school", 1),
    (re.compile(r"Improves your chance to hit(?: with spells)? by (\d+(?:\.\d+)?)%", re.I), "HIT_RATING", 10),
    (re.compile(r"Improves your chance to get a critical strike(?: with spells)? by (\d+(?:\.\d+)?)%", re.I), "CRIT_RATING", 14),
    (re.compile(r"Restores (\d+) mana per 5 sec", re.I), "MANA_REGENERATION", 1),
]


def equip_stats(texts: list[str]) -> dict[str, int]:
    """Stats an item's equip effects give, read from their words (the invisible marks ForeverDB adds are only
    stepped over here, the texts kept are left as they are)."""
    out: dict[str, int] = {}
    for raw in texts:
        t = INVISIBLE.sub("", raw or "")
        for rx, key, per in EQUIP:
            m = rx.search(t)
            if not m:
                continue
            if key == "school":
                k = SCHOOL.get(m.group(1).lower())
                if k:
                    out[k] = out.get(k, 0) + int(m.group(2))
            else:
                out[key] = out.get(key, 0) + round(float(m.group(1)) * per)
    return out
BIND = {"Binds when picked up": 1, "Binds when equipped": 2, "Binds when used": 3, "Quest item": 4}
_extra: dict[str, dict] = {}
_flags: dict[str, bool] = {}  # item id -> doubtful (speculation or a beta event copy)


def extra() -> dict[str, dict]:
    return _extra


def doubtful(item_id: int | str) -> bool:
    return _flags.get(str(item_id), False)


def convert(d: dict) -> dict:
    """A ForeverDB item in the reference's shape (names in English only: ForeverDB has no other language)."""
    stats: dict[str, int] = {}
    for s in d.get("stats") or []:
        k = STATS.get(s.get("statId"))
        if k:
            stats[k] = stats.get(k, 0) + (s.get("value") or 0)
    texts = [e.get("text") for e in d.get("effects") or [] if e.get("text")]
    for k, v in equip_stats(texts).items():  # only what the stats don't already say
        stats.setdefault(k, v)
    dmg, speed = d.get("damage") or {}, d.get("speed")
    dps = round((dmg["min"] + dmg["max"]) / 2 / speed, 1) if dmg.get("min") is not None and speed else None
    return {
        "en": d["name"], "ru": d["name"], "q": d.get("qualityId") or 1, "ilvl": d.get("itemLevel") or 0,
        "req": d.get("requiredLevel") or 0, "slot": d.get("inventoryTypeId") or 0, "cls": d.get("classId") or 0,
        "sub": d.get("subclassId") or 0, "classes": -1, "set": 0, "bind": BIND.get(d.get("bonding") or "", 0),
        "races": -1, "pvp": 0, "rep": 0, "skill": 0, "flags": 0, "stats": stats, "armor": None, "dps": dps,
        "speed": round(speed * 1000) if speed else None, "spells": texts,
        "unique": bool(d.get("unique")), "src": "foreverdb", "v": VERSION,
        # for the tooltip of an item Blizzard does not know (hidden in Forever): its icon and armor as ForeverDB has them
        "icon": d.get("icon") or d.get("iconName") or d.get("iconFile"), "armorValue": d.get("armor"),
    }


async def load() -> None:
    """What the last sync left in the database, into memory."""
    global _extra, _flags
    async with SessionLocal() as s:
        row = await s.get(FdbCache, KEY)
    if row:
        _extra = row.value.get("items") or {}
        _flags = row.value.get("doubtful") or {}


async def _save(items: dict, flags: dict) -> None:
    async with SessionLocal() as s:
        await s.merge(FdbCache(path=KEY, build=None, at=utcnow(), value={"items": items, "doubtful": flags}))
        await s.commit()


async def sync() -> None:
    """One pass: the lists (flags for every item), then the details of the wearable items the reference lacks."""
    from .routers.bis import base_gear

    c = foreverdb.client()
    if not c.configured:
        return
    await load()
    have = base_gear()
    items, flags = dict(_extra), dict(_flags)
    todo = []
    for cls in (2, 4):
        for q in (2, 3, 4):
            for x in await c.pages("items", {"class": cls, "quality": q}, ttl_days=30):
                i = str(x["id"])
                bad = bool(x.get("speculation") or x.get("betaEvent"))
                if bad:
                    flags[i] = True
                else:
                    flags.pop(i, None)
                if i not in have and x.get("inventoryTypeId") in WEARABLE and \
                        (i not in items or (items[i].get("v") or 1) < VERSION):
                    todo.append(i)  # new, or kept by an older convert(): its details come back from the cache
    await _save(items, flags)
    _flags.update(flags)
    log.info("ForeverDB gear: %d to ask", len(todo))
    for n, i in enumerate(todo):
        try:
            d = (await c.get(f"items/{i}", ttl_days=60))["data"]
        except foreverdb.FdbError as e:
            if e.status == 429:
                break  # the day's share is spent: the rest tomorrow
            continue
        except httpx.HTTPError:
            continue
        items[i] = convert(d)
        if n % 50 == 0:
            await _save(items, flags)
            _extra.update(items)
    await _save(items, flags)
    _extra.update(items)


async def worker() -> None:
    """Sync at start and then every six hours (most passes find nothing new and cost only the lists' cache)."""
    from . import fdb_sources

    await load()
    await fdb_sources.load()
    while True:
        try:  # the dungeon list first: thirty requests, and the characters' dungeon tab waits for it
            from . import instances
            await instances.catalog()
        except Exception:  # noqa: BLE001
            log.exception("ForeverDB dungeons")
        try:  # where items come from first (a thousand requests), then the gear details (the rest of the day's share)
            await fdb_sources.sync()
        except Exception:  # noqa: BLE001
            log.exception("ForeverDB sources sync")
        try:
            await sync()
        except Exception:  # noqa: BLE001 - the loop must survive anything
            log.exception("ForeverDB gear sync")
        await asyncio.sleep(6 * 3600)
