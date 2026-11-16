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
                return None
            raise err
        return {**wow.item({"id": item_id}, media, lang), "partial": True}
    out = None
    for lg in LANGS:
        data = {**wow.item(raw, media, lg), "v": ITEM_V}
        await session.merge(Item(id=item_id, lang=lg, data=data))
        if lg == lang:
            out = data
    await session.commit()
    return out


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
