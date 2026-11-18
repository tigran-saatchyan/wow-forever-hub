"""Where items come from, by ForeverDB: who sells each item (with the price, where the vendor stands, the side and
whether players saw it in Forever) and which recipe makes it. Built in the background from ForeverDB's vendors and
professions (a thousand requests or so, once per game build) and kept in the database ("sources:index").

ForeverDB has no "who drops it" for creatures nor quest rewards: those stay with Everloot (app/everloot.py).
"""

from __future__ import annotations

import logging

import httpx

from . import foreverdb
from .db import FdbCache, SessionLocal, utcnow

log = logging.getLogger("uvicorn.error")
KEY = "sources:index"
PROFESSIONS = ["alchemy", "blacksmithing", "enchanting", "engineering", "leatherworking", "tailoring", "cooking",
               "first-aid", "mining", "fishing"]
_index: dict = {"sold": {}, "made": {}, "learn": {}, "disenchant": []}


def sold_by(item_id: int) -> list[dict]:
    return _index["sold"].get(str(item_id), [])


def made_by(item_id: int) -> list[dict]:
    return _index["made"].get(str(item_id), [])


def learn(spell_id: int) -> dict | None:
    """Where a recipe is learned (by its spell): the ways, the skill, the recipe item, the vendors of each side."""
    return (_index.get("learn") or {}).get(str(spell_id))


def vendor_price(item_id: int) -> int | None:
    """One item's price at the cheapest vendor players saw sell it in Forever (else the original game's data)."""
    xs = [v for v in sold_by(item_id) if v.get("price")]
    if not xs:
        return None
    seen = [v for v in xs if v["seen"]] or xs
    return min(round(v["price"] / max(1, v.get("stack") or 1)) for v in seen)


def disenchant(q: int, ilvl: int, kind: str) -> list[dict]:
    """What an uncommon, rare or epic piece of armor or a weapon disenchants into: Forever's results where players
    saw them, else the original game's table."""
    for row in _index.get("disenchant") or []:
        if row.get("qualityId") == q and row.get("kind") == kind and \
                (row.get("itemLevelMin") or 0) <= ilvl <= (row.get("itemLevelMax") or 999):
            seen = row.get("seenInForever")
            src = seen if isinstance(seen, dict) and seen.get("results") else row.get("classic") or {}
            return src.get("results") or []
    return []


async def load() -> None:
    global _index
    async with SessionLocal() as s:
        row = await s.get(FdbCache, KEY)
    if row and row.value.get("sold") is not None:
        _index = row.value


async def sync() -> None:
    """Vendors' goods and professions' products into one index (each answer cached per build: a repeat pass on the
    same build asks nothing)."""
    global _index
    c = foreverdb.client()
    if not c.configured:
        return
    sold: dict[str, list] = {}
    made: dict[str, list] = {}
    learn_: dict[str, dict] = {}
    vendors = await c.pages("vendors", ttl_days=30)
    for v in vendors:
        try:
            d = (await c.get(f"vendors/{v['id']}", ttl_days=30))["data"]
        except foreverdb.FdbError as e:
            if e.status == 429:
                log.info("ForeverDB sources: the day's share is spent at vendor %s", v["id"])
                return  # keep the old index; the rest on the next pass
            continue
        except httpx.HTTPError:
            continue
        for it in d.get("sells") or []:
            sold.setdefault(str(it["itemId"]), []).append({
                "npc": d["id"], "name": d.get("name"), "title": d.get("title"), "side": d.get("side"),
                "zone": d.get("zone"), "map": d.get("mapId"), "x": d.get("x"), "y": d.get("y"),
                "price": it.get("price"), "stack": it.get("stack"), "limited": it.get("limited"),
                "seen": bool(it.get("seenInForever") or d.get("seenInForever")),
                "rep": (d.get("reputationFaction") or {}).get("name"),
            })
    for slug in PROFESSIONS:
        try:
            p = await c.get(f"professions/{slug}", {"limit": 100, "offset": 0}, ttl_days=30)
        except (foreverdb.FdbError, httpx.HTTPError):
            continue
        recipes = list((p.get("data") or {}).get("recipes") or [])
        total = ((p.get("meta") or {}).get("total")) or len(recipes)
        offset = 100
        while offset < total:
            try:
                more = await c.get(f"professions/{slug}", {"limit": 100, "offset": offset}, ttl_days=30)
            except (foreverdb.FdbError, httpx.HTTPError):
                break
            recipes += (more.get("data") or {}).get("recipes") or []
            offset += 100
        name = (p.get("data") or {}).get("name") or slug
        for r in recipes:
            lf = r.get("learnedFrom") or {}
            src = lf.get("sources") or {}
            if r.get("spellId"):
                vend = src.get("vendors") or {}
                learn_[str(r["spellId"])] = {
                    "ways": src.get("ways") or [], "skill": src.get("learnAtSkill"),
                    "item": (src.get("recipeItem") or {}).get("itemId"),
                    "vendors": {side: [{"npc": v.get("npcId"), "name": v.get("name"), "zone": v.get("zone"), "map": v.get("mapId"),
                                        "x": v.get("x"), "y": v.get("y"), "price": v.get("price"), "seen": v.get("seenInForever"),
                                        "costs": [{"name": c.get("name"), "amount": c.get("amount")} for c in v.get("costs") or []]}
                                       for v in (vend.get(side) or [])[:3]] for side in ("horde", "alliance")},
                }
            mk = r.get("makes") or {}
            if mk.get("itemId"):
                made.setdefault(str(mk["itemId"]), []).append({
                    "profession": name, "slug": slug, "recipe": r.get("name"), "skill": (r.get("skill") or {}).get("orange"),
                    "ways": ((r.get("learnedFrom") or {}).get("sources") or {}).get("ways") or [],
                })
    for xs in sold.values():
        xs.sort(key=lambda v: (not v["seen"], v["price"] or 0))  # seen in Forever first, then the cheapest
    try:
        de = (await c.get("disenchant", ttl_days=30)).get("data") or []
    except (foreverdb.FdbError, httpx.HTTPError):
        de = _index.get("disenchant") or []
    _index = {"sold": sold, "made": made, "learn": learn_, "disenchant": de, "at": utcnow().isoformat()}
    async with SessionLocal() as s:
        await s.merge(FdbCache(path=KEY, build=None, at=utcnow(), value=_index))
        await s.commit()
    log.info("ForeverDB sources: %d items sold, %d made", len(sold), len(made))
