"""Where to get an item: sold by, dropped by, quest reward (Everloot), names from the Blizzard API.

One answer per item and language is kept for 6 hours (memory and database), so the panel opens at
once the second time and Everloot is asked rarely.
"""

import asyncio
import logging
import time
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from .. import everloot
from ..auth import CurrentUser
from ..bnet import BnetError, client, name_of
from ..db import SessionLocal, Setting, get_session, utcnow
from .items import get_item

router = APIRouter(prefix="/api/sources", tags=["sources"])
log = logging.getLogger("uvicorn.error")
Session = Annotated[AsyncSession, Depends(get_session)]
TTL = 24 * 3600  # an answer older than this is refreshed in the background
RETRY = 15 * 60  # an answer Everloot failed in part: asked again this soon
_cache: dict[tuple[int, str], tuple[float, dict]] = {}
_http: httpx.AsyncClient | None = None


def http() -> httpx.AsyncClient:
    global _http
    if _http is None:
        _http = httpx.AsyncClient(headers={"User-Agent": "ForeverHub/0.2"})
    return _http


async def npc_names(ids: list[int], lang: str) -> dict[int, str]:
    """Creature names from the Blizzard API (static), cached; unknown ones stay out."""
    out: dict[int, str] = {}
    todo = []
    async with SessionLocal() as s:
        for i in ids:
            row = await s.get(Setting, f"npc:{i}")
            if row:
                if row.value.get(lang):
                    out[i] = row.value[lang]
            else:
                todo.append(i)
    if not todo or not client().configured:
        return out
    sem = asyncio.Semaphore(4)

    async def one(i: int):
        async with sem:
            try:
                return i, await client().get(f"/data/wow/creature/{i}", "static")
            except BnetError:
                return i, None

    got = await asyncio.gather(*(one(i) for i in todo))
    async with SessionLocal() as s:
        for i, d in got:
            names = {lg: name_of(d.get("name"), lg) for lg in ("ru", "en")} if d else {}
            await s.merge(Setting(key=f"npc:{i}", value=names))
            if names.get(lang):
                out[i] = names[lang]
        await s.commit()
    return out


async def build(item_id: int, lang: str, session: AsyncSession) -> dict:
    try:
        info = await get_item(session, item_id, lang)
        info_en = await get_item(session, item_id, "en") if lang != "en" else info
    except BnetError:
        info = info_en = None
    name_en = (info_en or {}).get("name") or ""
    h = http()

    async def safe(tool: str, args: dict):
        try:
            return await everloot.call(h, tool, args)
        except (everloot.EverlootError, httpx.HTTPError, ValueError) as e:
            return {"error": str(e), "data": {}, "text": ""}

    rel, page, lore = await asyncio.gather(
        safe("entity_relations", {"kind": "item", "id": item_id, "limit": 60}),
        safe("item_page", {"itemId": item_id}),
        safe("answer_sources", {"question": f"Where to get {name_en}?", "limit": 6}) if name_en
        else asyncio.sleep(0, {"data": {}}),
    )
    rels = everloot.relations(rel["data"])
    sellers = rels.get("sold_by", [])[:6]
    drops = everloot.drops(page["data"])
    quests = rels.get("reward_from", [])[:6]
    # vendor prices for this item from each seller's page
    vendor_pages = await asyncio.gather(*(safe("vendor_page", {"vendorNpcId": e["toId"]}) for e in sellers))
    quest_pages = await asyncio.gather(*(safe("quest_page", {"questId": e["toId"]}) for e in quests))
    names = await npc_names(list(dict.fromkeys([e["toId"] for e in sellers] + [d["sourceNpcId"] for d in drops])), lang)

    def price(vp: dict) -> dict:
        offer = next((o for o in ((vp.get("data") or {}).get("page") or {}).get("offers") or []
                      if o.get("itemId") == item_id), {})
        return {"copper": offer.get("priceCopper"), "limited": offer.get("limitedStock"),
                "unlimited": offer.get("unlimited")}

    def chained(qp: dict) -> bool:
        """Whether the quest is part of a chain: it needs an earlier quest, when Everloot's page says so."""
        pg = (qp.get("data") or {}).get("page") or {}
        return any(pg.get(k) for k in ("prevQuestId", "previousQuestId", "requiresQuestIds", "prevQuestIds", "chain"))

    def quest_title(qp: dict) -> str | None:
        pg = (qp.get("data") or {}).get("page") or {}
        return pg.get("title") or pg.get("name")

    return {
        "item": info,
        "sold": [{"npc": e["toId"], "name": names.get(e["toId"]), "installs": e.get("installs"),
                  "lastSeen": e.get("lastSeen"), **price(vp)} for e, vp in zip(sellers, vendor_pages, strict=True)],
        "drops": [{"npc": d["sourceNpcId"], "name": names.get(d["sourceNpcId"]), "rate": d.get("rate"),
                   "kills": d.get("kills"), "reporters": d.get("reporters"),
                   # where the creature is, when Everloot says (its field names vary between tools)
                   "where": next((d[k] for k in ("instanceName", "dungeonName", "zoneName", "zone", "areaName")
                                  if isinstance(d.get(k), str) and d.get(k)), None)} for d in drops],
        "dropCount": len(everloot.drops(page["data"], limit=1000)),
        "quests": [{"quest": e["toId"], "title": quest_title(qp), "installs": e.get("installs"),
                    "chain": chained(qp)} for e, qp in zip(quests, quest_pages, strict=True)],
        "wiki": everloot.wiki(lore["data"], name_en) if name_en else [],
        "everloot": (rel["data"] or {}).get("url") or f"https://everloot.app/database/items/{item_id}",
        "dataAsOf": (page["data"] or {}).get("dataAsOf") or (rel["data"] or {}).get("dataAsOf"),
        "errors": [x["error"] for x in (rel, page) if x.get("error")],
        "at": utcnow().isoformat(),
    }


async def refresh(item_id: int, lang: str) -> dict | None:
    """Ask Everloot again and store the answer; None when Everloot gave nothing usable."""
    async with SessionLocal() as session:
        out = await build(item_id, lang, session)
        if out["errors"] and not (out["sold"] or out["drops"] or out["quests"] or out["wiki"]):
            return None
        # a partial answer (Everloot failed in part): add what the hub knows, and ask again in a quarter of an hour
        stamp, ttl = time.time(), TTL
        if out["errors"]:
            out["local"] = (await local(item_id, lang, session))["local"]
            stamp, ttl = time.time() - TTL + RETRY, RETRY
        await session.merge(Setting(key=f"src:{item_id}:{lang}", value={"_t": stamp, "data": out}))
        await session.commit()
    _cache[(item_id, lang)] = (time.time() + ttl, out)
    return out


_refreshing: set[tuple[int, str]] = set()


async def _refresh_quietly(item_id: int, lang: str) -> None:
    try:
        await refresh(item_id, lang)
    except Exception:  # noqa: BLE001 - a background refresh must not take anything down
        log.exception("sources refresh %s", item_id)
    finally:
        _refreshing.discard((item_id, lang))


def with_fdb(out: dict, item_id: int) -> dict:
    """ForeverDB's word added to any answer: who sells it (where, for how much, seen in Forever or not) and which
    recipe makes it (app/fdb_sources.py)."""
    from .. import fdb_sources

    from .. import item_sources

    lang = "ru" if (out.get("_lang") or "ru") == "ru" else "en"
    return {**out, "fdb": {"sold": fdb_sources.sold_by(item_id)[:8], "made": fdb_sources.made_by(item_id)[:4]},
            "own": {"quests": item_sources.quests(item_id, lang), "drops": item_sources.drops(item_id, lang)}}


@router.get("/item/{item_id}")
async def item_sources(item_id: int, _: CurrentUser, session: Session, lang: str = "ru"):
    lang = "ru" if lang == "ru" else "en"
    if known_here(item_id):  # the hub's own references know it: Everloot (often down) is not asked at all
        try:
            info = await get_item(session, item_id, lang)
        except BnetError:
            info = None
        base = {"item": info, "sold": [], "drops": [], "quests": [], "wiki": [], "errors": [], "dataAsOf": None,
                "everloot": f"https://everloot.app/database/items/{item_id}", "at": utcnow().isoformat()}
        return with_fdb({**base, "_lang": lang}, item_id)
    return with_fdb({**await _item_sources(item_id, session, lang), "_lang": lang}, item_id)


def known_here(item_id: int) -> bool:
    """Whether the hub's own references (quests, drops, ForeverDB's vendors and recipes) say where the item comes from."""
    from .. import fdb_sources, item_sources

    return bool(item_sources.quests(item_id, "en") or item_sources.drops(item_id, "en")
                or fdb_sources.sold_by(item_id) or fdb_sources.made_by(item_id))


async def _item_sources(item_id: int, session: AsyncSession, lang: str) -> dict:
    """Stored answer at once (prefetched in the background), refreshed behind the scenes when old."""
    lang = "ru" if lang == "ru" else "en"
    key = (item_id, lang)
    hit = _cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    row = await session.get(Setting, f"src:{item_id}:{lang}")
    if row:
        if time.time() - row.value.get("_t", 0) >= TTL and key not in _refreshing:
            _refreshing.add(key)
            asyncio.get_running_loop().create_task(_refresh_quietly(item_id, lang))
        return row.value["data"]
    out = await refresh(item_id, lang)
    if out is None:
        # Everloot is down: what the hub knows itself, and Everloot again later
        return await local(item_id, lang, session)
    return out


BIND = {1: "pickup", 2: "equip", 3: "use", 4: "quest"}


async def local(item_id: int, lang: str, session: AsyncSession) -> dict:
    """Where to get an item from the hub's own data, for when Everloot does not answer: the recipes that make it,
    what it costs on the auction house now, and how it binds (only items that bind on equip can be bought)."""
    from . import bis as bis_routes
    from . import professions
    from .craft import _prices

    try:
        info = await get_item(session, item_id, lang)
    except BnetError:
        info = None
    crafted = []
    try:
        ds = await professions._load(professions._build())
    except HTTPException:
        ds = None
    for p in (ds or {}).get("professions", {}).values():
        for r in p["recipes"]:
            if r.get("item") == item_id:
                crafted.append({"profession": (p.get("name") or {}).get(lang) or (p.get("name") or {}).get("en"),
                                "recipe": r["name"].get(lang) or r["name"]["en"], "skill": r.get("skill") or r.get("yellow")})
    prices, market = await _prices(session)
    ah = prices.get(item_id)
    g = bis_routes.gear().get(str(item_id)) or {}
    return {
        "item": info, "sold": [], "drops": [], "quests": [], "wiki": [],
        "everloot": f"https://everloot.app/database/items/{item_id}", "dataAsOf": None,
        "errors": ["everloot"], "at": utcnow().isoformat(),
        "local": {"crafted": crafted, "bind": BIND.get(g.get("bind")),
                  "auction": {"min": ah["ah"], "qty": ah["qty"], "at": market.get("at")} if ah else None},
    }


# ---------- prefetch: every recipe-related item, so the panel opens without waiting ----------

PREFETCH_DELAY = 4.0  # seconds between items: Everloot is a free community service, ask gently


async def _recipe_items() -> list[int]:
    """Recipe items first (where to get a recipe is the usual question), then reagents, then products."""
    from . import professions

    try:
        ds = await professions._load(professions._build())
    except HTTPException:
        return []
    if not ds:
        return []
    first, second, third = [], [], []
    for p in ds["professions"].values():
        for r in p["recipes"]:
            if r.get("recipeItem"):
                first.append(r["recipeItem"])
            second += [x[0] for x in r.get("reagents") or []]
            if r.get("item"):
                third.append(r["item"])
    return list(dict.fromkeys(first + second + third))


async def prefetcher(lang: str = "ru") -> None:
    """Walk the items forever: fetch the missing and the stale ones, one every few seconds. The BiS lists of every
    character for their level and the next go first (a level up brings the next level's into the next round),
    then every recipe item."""
    from . import bis as bis_routes

    while True:
        # Everloot only for what the hub's own references don't know (it is the last resort, and often down)
        ids = [i for i in dict.fromkeys(await bis_routes.upcoming_items() + await _recipe_items()) if not known_here(i)]
        if not ids:
            await asyncio.sleep(300)  # the recipe reference is not built yet
            continue
        done = 0
        for i, item_id in enumerate(ids):
            async with SessionLocal() as s:
                row = await s.get(Setting, f"src:{item_id}:{lang}")
            if not row or time.time() - row.value.get("_t", 0) >= TTL:
                try:
                    await refresh(item_id, lang)
                except Exception:  # noqa: BLE001
                    log.exception("prefetch %s", item_id)
                await asyncio.sleep(PREFETCH_DELAY)
            done += 1
            if i % 25 == 0 or i == len(ids) - 1:
                async with SessionLocal() as s:
                    state = {"done": done, "total": len(ids), "at": utcnow().isoformat()}
                    await s.merge(Setting(key="prefetch", value=state))
                    await s.commit()
        await asyncio.sleep(3600)


@router.get("/prefetch")
async def prefetch_state(_: CurrentUser, session: Session):
    row = await session.get(Setting, "prefetch")
    return row.value if row else None


def brief(d: dict | None, item_id: int | None = None, lang: str = "ru") -> dict | None:
    """One line of where an item comes from, for the BiS comparison. The hub's own references first — a quest
    (Blizzard's data, "chain" when it has quests around it), then a drop (a boss or rare in its dungeon or zone, or a
    world drop with its likeliest creature and how many kinds drop it; the original game's data) —, then ForeverDB's
    vendors and recipes, and Everloot's stored answer only when none of these knows the item."""
    from .. import fdb_sources, item_sources

    if item_id:
        own = item_sources.brief(item_id, lang)
        if own:
            return own
        fdb_sold = fdb_sources.sold_by(item_id)
        if fdb_sold:  # ForeverDB's vendors: seen in Forever first
            v = fdb_sold[0]
            return {"kind": "vendor", "name": v.get("name") or f"NPC #{v['npc']}", "where": v.get("zone"),
                    "copper": v.get("price"), "more": len(fdb_sold) - 1}
        own_made = _crafted.get(item_id)  # the client's recipe reference: names in the page's language, the skill
        if own_made:
            m = own_made[0]
            return {"kind": "craft", "name": m["name"].get(lang) or m["name"]["en"], "where": m["prof"].get(lang) or m["prof"]["en"],
                    "skill": m["skill"], "more": len(own_made) - 1}
        made = fdb_sources.made_by(item_id)
        if made:
            m = made[0]
            return {"kind": "craft", "name": m["recipe"], "where": PROF_RU.get(m.get("slug", ""), m["profession"]) if lang == "ru" else m["profession"],
                    "skill": m.get("skill"), "more": len(made) - 1}
    d = d or {}  # Everloot, the last resort
    if d.get("quests"):
        q = d["quests"][0]
        return {"kind": "quest", "name": q.get("title") or f"#{q['quest']}", "chain": bool(q.get("chain")),
                "more": len(d["quests"]) - 1}
    if d.get("drops"):
        top = max(d["drops"], key=lambda x: x.get("rate") or 0)
        n = d.get("dropCount") or len(d["drops"])
        world = n >= 8 and (top.get("rate") or 0) < 0.01
        return {"kind": "world" if world else "drop", "name": top.get("name") or f"NPC #{top['npc']}",
                "where": top.get("where"), "rate": top.get("rate"), "more": n - 1}
    if d.get("sold"):
        v = d["sold"][0]
        return {"kind": "vendor", "name": v.get("name") or f"NPC #{v['npc']}", "copper": v.get("copper"),
                "more": len(d["sold"]) - 1}
    loc = d.get("local") or {}
    if loc.get("crafted"):
        c = loc["crafted"][0]
        return {"kind": "craft", "name": c["recipe"], "where": c["profession"], "more": len(loc["crafted"]) - 1}
    return None


PROF_RU = {"alchemy": "Алхимия", "blacksmithing": "Кузнечное дело", "enchanting": "Наложение чар", "engineering": "Инженерное дело",
           "leatherworking": "Кожевничество", "tailoring": "Портняжное дело", "cooking": "Кулинария", "first-aid": "Первая помощь",
           "mining": "Горное дело", "fishing": "Рыбная ловля"}
_crafted: dict[int, list[dict]] = {}  # item -> recipes making it (from the recipe reference), filled by briefs()


async def _load_crafted() -> None:
    from . import professions

    if _crafted:
        return
    try:
        ds = await professions._load(professions._build())
    except HTTPException:
        return
    for p in (ds or {}).get("professions", {}).values():
        for r in p["recipes"]:
            if r.get("item"):
                _crafted.setdefault(r["item"], []).append(
                    {"name": r["name"], "prof": p["name"], "skill": r.get("skill") or r.get("yellow")})


async def briefs(session: AsyncSession, ids: list[int], lang: str) -> dict[int, dict]:
    """brief() for many items at once, from the stored answers only (nothing is asked here)."""
    from sqlalchemy import select

    await _load_crafted()
    keys = [f"src:{i}:{lang}" for i in ids]
    rows = (await session.execute(select(Setting).where(Setting.key.in_(keys)))).scalars().all()
    stored = {int(r.key.split(":")[1]): (r.value or {}).get("data") for r in rows}
    out = {}
    for i in ids:  # ForeverDB's index answers even for items Everloot was never asked about
        b = brief(stored.get(i), i, lang)
        if b:
            out[i] = b
    return out
