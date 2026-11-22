"""Items from static-forever, cached in the database (both languages from one request)."""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from .. import wow
from ..auth import CurrentUser
from ..bnet import BnetError, client, name_of
from ..db import Item, get_session

router = APIRouter(prefix="/api/items", tags=["items"])
Session = Annotated[AsyncSession, Depends(get_session)]
LANGS = ("ru", "en")
log = logging.getLogger("uvicorn.error")


ITEM_V = 2  # bump when wow.item() changes shape: older cached rows are fetched again


async def get_item(session: AsyncSession, item_id: int, lang: str) -> dict | None:
    """Cached item, or fetched once from Blizzard (None if Blizzard knows neither the item nor its icon).

    The icon is asked separately: when the item itself is refused, its icon may still come, and the
    card shows that (not cached, so a later call tries the item again).
    """
    lang = lang if lang in LANGS else "en"
    row = await session.get(Item, (item_id, lang))
    if row and row.data.get("v") == ITEM_V:
        if row.data.get("icon"):
            return row.data
        # cached while its icon was not answering: ask for the icon again, keep the rest
        try:
            icon = wow.media_url(await client().get(f"/data/wow/media/item/{item_id}", "static"), "icon")
        except BnetError:
            return row.data
        if not icon:
            return row.data
        for lg in LANGS:
            r = await session.get(Item, (item_id, lg))
            if r:
                r.data = {**r.data, "icon": icon}
        await session.commit()
        return {**row.data, "icon": icon}
    try:
        raw = await client().get(f"/data/wow/item/{item_id}", "static")
    except BnetError as e:
        raw, err = None, e
    try:
        media = await client().get(f"/data/wow/media/item/{item_id}", "static")
    except BnetError:
        media = None
    if raw is None:
        log.warning("item %s: %s", item_id, err)
        if media is None:
            if err.status == 404:
                return from_reference(item_id, lang)  # hidden in Forever: what ForeverDB says of it
            raise err
        part = {**wow.item({"id": item_id}, media, lang), "partial": True}
        ref = from_reference(item_id, lang)  # the icon from Blizzard, the rest from ForeverDB's item
        return {**ref, "icon": part.get("icon") or ref.get("icon"), "partial": True} if ref else part
    out = None
    for lg in LANGS:
        data = {**wow.item(raw, media, lg), "v": ITEM_V}
        await session.merge(Item(id=item_id, lang=lg, data=data))
        if lg == lang:
            out = data
    await session.commit()
    return out


# names for a tooltip built from the hub's reference (ForeverDB's items: English names only)
_Q = {0: "POOR", 1: "COMMON", 2: "UNCOMMON", 3: "RARE", 4: "EPIC", 5: "LEGENDARY"}
_PRIMARY = {"STRENGTH": ("Strength", "к силе"), "AGILITY": ("Agility", "к ловкости"), "STAMINA": ("Stamina", "к выносливости"),
            "INTELLECT": ("Intellect", "к интеллекту"), "SPIRIT": ("Spirit", "к духу")}
_SLOT = {1: ("Head", "Голова"), 2: ("Neck", "Шея"), 3: ("Shoulder", "Плечи"), 5: ("Chest", "Грудь"), 20: ("Chest", "Грудь"),
         6: ("Waist", "Пояс"), 7: ("Legs", "Ноги"), 8: ("Feet", "Ступни"), 9: ("Wrist", "Запястья"), 10: ("Hands", "Кисти рук"),
         11: ("Finger", "Палец"), 12: ("Trinket", "Аксессуар"), 16: ("Back", "Спина"), 13: ("One-Hand", "Одноручное"),
         17: ("Two-Hand", "Двуручное"), 21: ("Main Hand", "Правая рука"), 22: ("Off Hand", "Левая рука"),
         23: ("Held In Off-hand", "Левая рука"), 14: ("Shield", "Щит"), 15: ("Ranged", "Дальний бой"), 26: ("Ranged", "Дальний бой")}
_ARMOR = {1: ("Cloth", "Ткань"), 2: ("Leather", "Кожа"), 3: ("Mail", "Кольчуга"), 4: ("Plate", "Латы")}
_BIND = {1: ("Binds when picked up", "Становится персональным при получении"), 2: ("Binds when equipped", "Становится персональным при надевании"),
         3: ("Binds when used", "Становится персональным при использовании"), 4: ("Quest Item", "Предмет, необходимый для задания")}


def from_reference(item_id: int, lang: str) -> dict | None:
    """The tooltip of an item Blizzard does not know (hidden in Forever) from the hub's reference, where ForeverDB's
    items are kept: name, quality, level, slot, the primary stats and the effects' texts as ForeverDB gives them."""
    from .bis import gear

    g = gear().get(str(item_id))
    if not g:
        return None
    ru = lang == "ru"
    pick = (lambda pair: pair[1] if ru else pair[0])
    icon = g.get("icon")
    if icon and not str(icon).startswith("http"):
        icon = f"https://wow.zamimg.com/images/wow/icons/large/{str(icon).lower()}.jpg"
    stats = [f"+{v} {pick(_PRIMARY[k]) if ru else _PRIMARY[k][0]}" for k, v in (g.get("stats") or {}).items() if k in _PRIMARY and v]
    return {
        "id": item_id, "name": g.get(lang) or g.get("en") or "", "quality": _Q.get(g.get("q") or 1), "level": g.get("ilvl"),
        "required": g.get("req") or None, "class": ("Доспехи" if ru else "Armor") if g.get("cls") == 4 else ("Оружие" if ru else "Weapon") if g.get("cls") == 2 else "",
        "subclass": pick(_ARMOR[g["sub"]]) if g.get("cls") == 4 and g.get("sub") in _ARMOR else "",
        "slot": pick(_SLOT[g["slot"]]) if g.get("slot") in _SLOT else "", "binding": pick(_BIND[g["bind"]]) if g.get("bind") in _BIND else None,
        "stats": stats, "spells": g.get("spells") or [], "armor": (f"{g['armorValue']} {'брони' if ru else 'Armor'}" if g.get("armorValue") else None),
        "damage": None, "speed": None, "sell": None, "description": None, "icon": icon, "source": "foreverdb",
    }


def _err(e: BnetError) -> HTTPException:
    return HTTPException(503 if e.status in (0, 503) else 502, f"Blizzard API: {e}")


@router.get("/search")
async def search(_: CurrentUser, q: Annotated[str, Query(min_length=2, max_length=60)], lang: str = "ru"):
    """Item search by name via Blizzard's search API, or a plain item id."""
    if q.strip().isdigit():
        return [{"id": int(q), "name": "", "quality": None}]
    loc = "ru_RU" if lang == "ru" else "en_US"
    try:
        r = await client().get(
            f"/data/wow/search/item?name.{loc}={q.strip()}&orderby=id&_pageSize=20", "static"
        )
    except BnetError as e:
        raise _err(e) from e
    out = []
    for x in r.get("results") or []:
        d = x.get("data") or {}
        if "id" in d:
            quality = (d.get("quality") or {}).get("type")
            out.append({"id": d["id"], "name": name_of(d.get("name"), lang), "quality": quality})
    return out


@router.get("/{item_id}")
async def item(item_id: int, _: CurrentUser, session: Session, lang: str = "ru"):
    try:
        data = await get_item(session, item_id, lang)
    except BnetError as e:
        raise _err(e) from e
    if data is None:
        raise HTTPException(404, "no such item")
    return data
