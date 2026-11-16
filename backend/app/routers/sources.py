"""Where to get an item: sold by, dropped by, quest reward (Everloot), names from the Blizzard API.

One answer per item and language is kept for 6 hours (memory and database), so the panel opens at
once the second time and Everloot is asked rarely.
"""

import asyncio
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
Session = Annotated[AsyncSession, Depends(get_session)]
TTL = 6 * 3600
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

    def quest_title(qp: dict) -> str | None:
        pg = (qp.get("data") or {}).get("page") or {}
        return pg.get("title") or pg.get("name")

    return {
        "item": info,
        "sold": [{"npc": e["toId"], "name": names.get(e["toId"]), "installs": e.get("installs"),
                  "lastSeen": e.get("lastSeen"), **price(vp)} for e, vp in zip(sellers, vendor_pages, strict=True)],
        "drops": [{"npc": d["sourceNpcId"], "name": names.get(d["sourceNpcId"]), "rate": d.get("rate"),
                   "kills": d.get("kills"), "reporters": d.get("reporters")} for d in drops],
        "quests": [{"quest": e["toId"], "title": quest_title(qp), "installs": e.get("installs")}
                   for e, qp in zip(quests, quest_pages, strict=True)],
        "wiki": everloot.wiki(lore["data"], name_en) if name_en else [],
        "everloot": (rel["data"] or {}).get("url") or f"https://everloot.app/database/items/{item_id}",
        "dataAsOf": (page["data"] or {}).get("dataAsOf") or (rel["data"] or {}).get("dataAsOf"),
        "errors": [x["error"] for x in (rel, page) if x.get("error")],
        "at": utcnow().isoformat(),
    }


@router.get("/item/{item_id}")
async def item_sources(item_id: int, _: CurrentUser, session: Session, lang: str = "ru"):
    lang = "ru" if lang == "ru" else "en"
    key = (item_id, lang)
    hit = _cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    row = await session.get(Setting, f"src:{item_id}:{lang}")
    if row and time.time() - row.value.get("_t", 0) < TTL:
        _cache[key] = (row.value["_t"] + TTL, row.value["data"])
        return row.value["data"]
    out = await build(item_id, lang, session)
    if out["errors"] and not (out["sold"] or out["drops"] or out["quests"] or out["wiki"]):
        if row:  # Everloot is down: the last good answer is better than nothing
            return row.value["data"]
        raise HTTPException(502, "Everloot: " + "; ".join(out["errors"]))
    await session.merge(Setting(key=f"src:{item_id}:{lang}", value={"_t": time.time(), "data": out}))
    await session.commit()
    _cache[key] = (time.time() + TTL, out)
    return out
