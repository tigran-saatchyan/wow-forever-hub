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
}
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
    dmg, speed = d.get("damage") or {}, d.get("speed")
    dps = round((dmg["min"] + dmg["max"]) / 2 / speed, 1) if dmg.get("min") is not None and speed else None
    return {
        "en": d["name"], "ru": d["name"], "q": d.get("qualityId") or 1, "ilvl": d.get("itemLevel") or 0,
        "req": d.get("requiredLevel") or 0, "slot": d.get("inventoryTypeId") or 0, "cls": d.get("classId") or 0,
        "sub": d.get("subclassId") or 0, "classes": -1, "set": 0, "bind": BIND.get(d.get("bonding") or "", 0),
        "races": -1, "pvp": 0, "rep": 0, "skill": 0, "flags": 0, "stats": stats, "armor": None, "dps": dps,
        "speed": round(speed * 1000) if speed else None, "spells": [e.get("text") for e in d.get("effects") or [] if e.get("text")],
        "unique": bool(d.get("unique")), "src": "foreverdb",
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
                if i not in have and i not in items and x.get("inventoryTypeId") in WEARABLE:
                    todo.append(i)
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
    await load()
    while True:
        try:
            await sync()
        except Exception:  # noqa: BLE001 - the loop must survive anything
            log.exception("ForeverDB gear sync")
        await asyncio.sleep(6 * 3600)
